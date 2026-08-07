// -----------------------------------------------------------------------------
// score.mjs — Pure scoring engine. Config-driven, no hardcoded point values.
//
// Given raw org activity + the rules config, it produces per-user scores with
// a full breakdown. Being a pure function makes it easy to test and to re-run
// against history whenever the rules change.
// -----------------------------------------------------------------------------

// Glob matcher for exclude_paths, gitignore-style semantics:
//   **/foo -> foo at any depth INCLUDING the repo root
//   **     -> any characters, crossing "/" boundaries
//   *      -> any characters except "/"
function globToRegExp(glob) {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape, keep * and /
    .replace(/\*\*\//g, "@@DIR@@")
    .replace(/\*\*/g, "@@ANY@@")
    .replace(/\*/g, "[^/]*")
    .replace(/@@DIR@@/g, "(?:.*/)?") // **/ -> optional leading dirs (root too)
    .replace(/@@ANY@@/g, ".*"); // **  -> anything
  return new RegExp(`^${re}$`);
}

function pathIsExcluded(path, excludeRes) {
  return excludeRes.some((re) => re.test(path));
}

function sizeBucket(lines, buckets) {
  if (lines <= buckets.XS) return "XS";
  if (lines <= buckets.S) return "S";
  if (lines <= buckets.M) return "M";
  if (lines <= buckets.L) return "L";
  return "XL";
}

// Calendar day ("2026-07-21") for a timestamp, so points can be bucketed by
// the day they were earned in -- fine enough grain to build any trailing
// window (7-day, 14-day, ...) without re-touching the raw activity.
function dayKey(dateStr) {
  return new Date(dateStr).toISOString().slice(0, 10);
}

// The `n` most recent day keys, today included.
function recentDays(n) {
  const days = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    days.push(dayKey(d.toISOString()));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return days;
}

// Build a login exclusion checker from config (exact logins + patterns).
// Humans only: listed bots, [bot] suffixes, case-insensitive exact matches.
export function buildLoginExcluder(rules) {
  const exact = new Set(
    (rules.display?.exclude_logins || []).map((l) => String(l).toLowerCase())
  );
  const patterns = (rules.display?.exclude_login_patterns || [])
    .map((p) => {
      try {
        return new RegExp(p, "i");
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return (login) => {
    if (!login) return true;
    const key = String(login).toLowerCase();
    if (exact.has(key)) return true;
    if (key.endsWith("[bot]")) return true;
    return patterns.some((re) => re.test(login));
  };
}

// Create/return a user record in the accumulator.
function userOf(users, login) {
  if (!login) return null;
  if (!users[login]) {
    users[login] = {
      login,
      name: null, // filled later by profile enrichment
      total: 0,
      days: {},
      dayCounts: {}, // day -> { prs, reviews, confirmed_issues, fixed_bonuses, manual }
      dayBreakdown: {}, // day -> { pr, review, issue, other } for window explainers
      breakdown: { pr: 0, review: 0, issue: 0, other: 0 },
      counts: { prs: 0, reviews: 0, confirmed_issues: 0, fixed_bonuses: 0, manual: 0 },
      sizes: { XS: 0, S: 0, M: 0, L: 0, XL: 0 },
      contributions: [], // approved manual/off-GitHub entries, for highlights
    };
  }
  return users[login];
}

// Credit points to a user's lifetime total, category breakdown, and the day
// the points were earned on.
function addPoints(user, category, points, earnedAt) {
  if (!points) return;
  user.total += points;
  user.breakdown[category] += points;
  const day = dayKey(earnedAt);
  user.days[day] = (user.days[day] || 0) + points;
  if (!user.dayBreakdown[day]) {
    user.dayBreakdown[day] = { pr: 0, review: 0, issue: 0, other: 0 };
  }
  user.dayBreakdown[day][category] += points;
}

// Bump a lifetime count AND the same count bucketed by the day it happened,
// so trailing windows (7-day, 14-day, ...) can be computed for counts too --
// not just for points.
function addCount(user, category, earnedAt) {
  user.counts[category] += 1;
  const day = dayKey(earnedAt);
  if (!user.dayCounts[day]) {
    user.dayCounts[day] = { prs: 0, reviews: 0, confirmed_issues: 0, fixed_bonuses: 0, manual: 0 };
  }
  user.dayCounts[day][category] += 1;
}

// Same-day diminishing factor for the n-th event of a category.
function diminishingFactor(nth, cfg) {
  if (!cfg || nth <= cfg.after) return 1;
  return Math.max(cfg.min_factor ?? 0, (cfg.decay ?? 1) ** (nth - cfg.after));
}

// Clip `want` so it does not push `used` above `cap`. Returns the allowed amount.
function clipToCap(want, used, cap) {
  if (!Number.isFinite(cap)) return want;
  const remaining = Math.max(0, cap - used);
  return Math.min(want, remaining);
}

export function score(activity, rules, manual = {}) {
  const users = {};
  const pr = rules.pull_requests;
  const rv = rules.reviews;
  const is = rules.issues;
  const excludeRes = (pr.exclude_paths || []).map(globToRegExp);
  const isExcluded = buildLoginExcluder(rules);

  // Track which login has already been credited a "first PR" bonus.
  const seenAuthors = new Set();
  // Count of a user's events on each calendar day, for diminishing returns.
  const prPerDay = {};
  const issuePerDay = {};
  // Issue points already credited per login|day, for the hard daily ceiling.
  const issuePtsPerDay = {};

  // Sort PRs chronologically so "first PR" is deterministic.
  const prs = [...activity.pullRequests]
    .filter((p) => p.mergedAt)
    .sort((a, b) => new Date(a.mergedAt) - new Date(b.mergedAt));

  for (const p of prs) {
    const login = p.author?.login;
    // `count_merges_to` gates whether the PR's OWN authorship points count
    // (size bonus, first-PR bonus, etc.) -- it says nothing about whether
    // reviewing this PR was valuable. Reviews are scored unconditionally
    // below, in their own block.
    const authorEligible =
      login &&
      !isExcluded(login) &&
      (!pr.count_merges_to || pr.count_merges_to.includes(p.baseRefName));

    if (authorEligible) {
      // --- PR base points from size (excluding generated files) ---
      const files = (p.files?.nodes || []).map((f) => f.path);
      const excludedCount = files.filter((f) => pathIsExcluded(f, excludeRes)).length;
      const excludedRatio = files.length ? excludedCount / files.length : 0;
      // Approximate the meaningful diff by discounting excluded-file share.
      const rawLines = (p.additions || 0) + (p.deletions || 0);
      const meaningful = Math.round(rawLines * (1 - excludedRatio));

      // Bucket label is kept for the dashboard's size breakdown only -- it no
      // longer drives points (see the `points` formula below and its
      // reasoning in config/rules.yml).
      const bucket = sizeBucket(meaningful, pr.size_buckets);

      // Saturating size bonus: grows quickly for the first several dozen
      // lines, then flattens out hard, so a huge PR earns barely more than a
      // solid mid-size one. `base` alone rewards just showing up with a
      // merged PR at all.
      const { base, max_bonus, half_life_lines } = pr.points;
      const bonus = max_bonus * (meaningful / (meaningful + half_life_lines));
      let points = base + bonus;

      // --- Multipliers ---
      const labels = (p.labels?.nodes || []).map((l) => l.name.toLowerCase());
      const isDoc = (pr.documentation_labels || []).some((d) =>
        labels.includes(d.toLowerCase())
      );
      if (isDoc) points *= pr.multipliers.documentation;

      const isHighImpact = (pr.impact_labels || []).some((l) => labels.includes(l.toLowerCase()));
      if (isHighImpact) points *= pr.multipliers.high_impact;

      const isFirst = !seenAuthors.has(login);
      if (isFirst) points *= pr.multipliers.first_pr;
      seenAuthors.add(login);

      // Diminishing returns for many same-day PRs by the same author
      // (discourages splitting one change into many PRs / AI flood).
      const dk = `${login}|${dayKey(p.mergedAt)}`;
      const nth = (prPerDay[dk] = (prPerDay[dk] || 0) + 1);
      points *= diminishingFactor(nth, pr.daily_diminishing);

      points = Math.round(points);

      const u = userOf(users, login);
      addPoints(u, "pr", points, p.mergedAt);
      addCount(u, "prs", p.mergedAt);
      u.sizes[bucket] += 1;
    }

    // --- Reviews on this PR (anti-spam) ---
    const creditedReviewers = new Set();
    for (const r of p.reviews?.nodes || []) {
      const reviewer = r.author?.login;
      if (!reviewer || isExcluded(reviewer)) continue;
      if (rv.exclude_self_review && reviewer === login) continue;
      if (rv.one_per_pr_per_reviewer && creditedReviewers.has(reviewer)) continue;
      const body = (r.body || "").trim();
      if (body.length < rv.min_body_length) continue;

      let rpts = 0;
      if (r.state === "APPROVED") rpts = rv.approved_points;
      else if (r.state === "CHANGES_REQUESTED") rpts = rv.changes_requested_points;
      else continue; // COMMENTED / DISMISSED / PENDING don't score

      creditedReviewers.add(reviewer);
      const ru = userOf(users, reviewer);
      addPoints(ru, "review", rpts, r.submittedAt);
      addCount(ru, "reviews", r.submittedAt);
    }
  }

  // --- Issues (low value + steep volume dampening; hard daily ceiling) ---
  // Sort so "first of the day" is deterministic for diminishing returns.
  const issues = [...activity.issues].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );

  for (const i of issues) {
    const login = i.author?.login;
    if (!login || isExcluded(login)) continue;
    const labels = (i.labels?.nodes || []).map((l) => l.name.toLowerCase());

    // Drop issues that were rejected — those aren't real contributions.
    const isDuplicate =
      (is.duplicate_labels || []).some((d) => labels.includes(d.toLowerCase())) ||
      i.stateReason === "DUPLICATE" ||
      i.stateReason === "NOT_PLANNED";
    if (isDuplicate) continue;

    // A difficulty label's points REPLACE the flat base, when one is present.
    let rawCreate = is.created_points ?? 0;
    for (const [label, pts] of Object.entries(is.difficulty_points || {})) {
      if (labels.includes(label.toLowerCase())) {
        rawCreate = pts;
        break;
      }
    }
    if (!rawCreate) continue;

    const createDay = dayKey(i.createdAt);
    const createKey = `${login}|${createDay}`;
    const nth = (issuePerDay[createKey] = (issuePerDay[createKey] || 0) + 1);
    const factor = diminishingFactor(nth, is.daily_diminishing);

    let createPts = rawCreate * factor;
    let closedPts = 0;
    if (i.closed && i.stateReason !== "NOT_PLANNED" && (is.closed_bonus || 0) > 0) {
      closedPts = (is.closed_bonus || 0) * factor;
    }

    // Hard daily ceiling on issue-category points (create day).
    const cap = is.max_points_per_day;
    const usedCreate = issuePtsPerDay[createKey] || 0;
    createPts = clipToCap(createPts, usedCreate, cap);
    issuePtsPerDay[createKey] = usedCreate + createPts;

    // Closed bonus counts against the close day's budget (often same day).
    if (closedPts > 0) {
      const closeDay = dayKey(i.closedAt || i.createdAt);
      const closeKey = `${login}|${closeDay}`;
      const usedClose = issuePtsPerDay[closeKey] || 0;
      closedPts = clipToCap(closedPts, usedClose, cap);
      issuePtsPerDay[closeKey] = usedClose + closedPts;
    }

    createPts = Math.round(createPts);
    closedPts = Math.round(closedPts);

    const u = userOf(users, login);
    // Activity counts always reflect real issues, even when points are clipped
    // to zero — so the board still shows "opened 40 issues, earned 8 pts max".
    addCount(u, "confirmed_issues", i.createdAt);
    addPoints(u, "issue", createPts, i.createdAt);

    if (closedPts > 0) {
      addPoints(u, "issue", closedPts, i.closedAt || i.createdAt);
      addCount(u, "fixed_bonuses", i.closedAt || i.createdAt);
    }
  }

  // --- Manual / off-GitHub contributions (approval-gated) ---
  const catDefaults = rules.manual_contributions?.categories || {};
  for (const c of manual?.contributions || []) {
    if (!c || c.approved !== true) continue;
    const login = c.login;
    if (!login || isExcluded(login)) continue;
    const pts = Number.isFinite(c.points)
      ? c.points
      : catDefaults[c.type]?.points ?? 0;
    if (!pts) continue;
    const when = c.date ? `${c.date}T12:00:00Z` : new Date().toISOString();

    const u = userOf(users, login);
    addPoints(u, "other", pts, when);
    addCount(u, "manual", when);
    u.contributions.push({
      type: c.type,
      points: pts,
      description: c.description || "",
      date: c.date || when.slice(0, 10),
      source: c.source || null,
    });
  }

  // Rank by the primary trailing window (first entry in windows_days).
  const windowsDays = rules.display?.windows_days || [7, 14];
  const countCategories = ["prs", "reviews", "confirmed_issues", "fixed_bonuses", "manual"];
  const pointCategories = ["pr", "review", "issue", "other"];
  for (const u of Object.values(users)) {
    u.windows = {};
    u.windowCounts = {};
    u.windowBreakdown = {};
    for (const n of windowsDays) {
      const days = recentDays(n);
      u.windows[n] = days.reduce((sum, day) => sum + (u.days[day] || 0), 0);
      u.windowCounts[n] = countCategories.reduce((acc, cat) => {
        acc[cat] = days.reduce((sum, day) => sum + (u.dayCounts[day]?.[cat] || 0), 0);
        return acc;
      }, {});
      u.windowBreakdown[n] = pointCategories.reduce((acc, cat) => {
        acc[cat] = days.reduce((sum, day) => sum + (u.dayBreakdown[day]?.[cat] || 0), 0);
        return acc;
      }, {});
    }
    u.rolling_total = u.windows[windowsDays[0]];
  }

  const ranked = Object.values(users).sort((a, b) => b.rolling_total - a.rolling_total);
  ranked.forEach((u, idx) => (u.rank = idx + 1));
  return ranked;
}
