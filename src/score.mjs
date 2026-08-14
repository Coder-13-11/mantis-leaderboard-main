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
      dayCounts: {}, // day -> { prs, reviews, confirmed_issues, fixed_bonuses, manual, prs_coauthored, issues_closed, review_submissions }
      dayBreakdown: {}, // day -> { pr, review, issue, other } for window explainers
      breakdown: { pr: 0, review: 0, issue: 0, other: 0 },
      counts: {
        prs: 0,
        reviews: 0,
        confirmed_issues: 0,
        fixed_bonuses: 0,
        manual: 0,
        prs_coauthored: 0,
        issues_closed: 0,
        review_submissions: 0,
      },
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
function addCount(user, category, earnedAt, n = 1) {
  user.counts[category] = (user.counts[category] || 0) + n;
  const day = dayKey(earnedAt);
  if (!user.dayCounts[day]) {
    user.dayCounts[day] = {
      prs: 0,
      reviews: 0,
      confirmed_issues: 0,
      fixed_bonuses: 0,
      manual: 0,
      prs_coauthored: 0,
      issues_closed: 0,
      review_submissions: 0,
    };
  }
  user.dayCounts[day][category] = (user.dayCounts[day][category] || 0) + n;
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

// Points for a single review node, or 0 if it doesn't meet the bar.
function reviewPointsFor(state, bodyLen, rv) {
  const min = rv.min_body_length ?? 0;
  const cmin = rv.commented_min_body_length ?? min;
  if (state === "APPROVED" && bodyLen >= min) return rv.approved_points ?? 0;
  if (state === "CHANGES_REQUESTED" && bodyLen >= min) {
    return rv.changes_requested_points ?? 0;
  }
  if (state === "COMMENTED" && (rv.commented_points ?? 0) > 0 && bodyLen >= cmin) {
    return rv.commented_points;
  }
  return 0;
}

// Collect every human who reviewed this PR (submitted review and/or inline
// comments). Scoring still uses quality thresholds; counts do not.
function collectReviewers(p, authorLogin, rv, isExcluded) {
  const comments = p.reviewComments?.nodes || [];
  const inlineByLogin = new Map();
  for (const c of comments) {
    const login = c.author?.login;
    if (!login || isExcluded(login)) continue;
    if (rv.exclude_self_review && login === authorLogin) continue;
    const at = c.createdAt || c.submittedAt;
    const cur = inlineByLogin.get(login) || { bodyLen: 0, submittedAt: at };
    cur.bodyLen += (c.body || "").trim().length;
    if (at && (!cur.submittedAt || at > cur.submittedAt)) cur.submittedAt = at;
    inlineByLogin.set(login, cur);
  }

  const counted = new Map();
  const scoring = new Map();

  for (const r of p.reviews?.nodes || []) {
    const reviewer = r.author?.login;
    if (!reviewer || isExcluded(reviewer)) continue;
    if (rv.exclude_self_review && reviewer === authorLogin) continue;
    if (r.state === "PENDING") continue;
    const inline = inlineByLogin.get(reviewer);
    const bodyLen = (r.body || "").trim().length + (inline?.bodyLen || 0);
    const submittedAt = r.submittedAt || inline?.submittedAt;
    const prevCount = counted.get(reviewer) || { submittedAt, submissions: 0 };
    prevCount.submissions += 1;
    if (submittedAt && (!prevCount.submittedAt || submittedAt > prevCount.submittedAt)) {
      prevCount.submittedAt = submittedAt;
    }
    counted.set(reviewer, prevCount);

    const pts = reviewPointsFor(r.state, bodyLen, rv);
    const prev = scoring.get(reviewer);
    const newer =
      !prev || pts > prev.points || (pts === prev.points && submittedAt > prev.submittedAt);
    if (newer) scoring.set(reviewer, { points: pts, submittedAt, state: r.state });
  }

  for (const [login, inline] of inlineByLogin) {
    if (!counted.has(login)) {
      counted.set(login, { submittedAt: inline.submittedAt, submissions: 1, inlineOnly: true });
    }
    if (!scoring.has(login)) {
      scoring.set(login, {
        points: reviewPointsFor("COMMENTED", inline.bodyLen, rv),
        submittedAt: inline.submittedAt,
        state: "COMMENTED",
      });
    }
  }

  return { scoring, counted };
}

export function score(activity, rules, manual = {}, identities = {}) {
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
  // Points already credited per login|day, for hard daily ceilings.
  const prPtsPerDay = {};
  const reviewPtsPerDay = {};
  const issuePtsPerDay = {};

  // Sort PRs chronologically so "first PR" is deterministic.
  const prs = [...activity.pullRequests]
    .filter((p) => p.mergedAt || p.state === "OPEN" || p.state === "CLOSED" || (p.reviews?.nodes || []).length)
    .sort((a, b) => new Date(a.mergedAt || a.updatedAt || a.createdAt) - new Date(b.mergedAt || b.updatedAt || b.createdAt));

  for (const p of prs) {
    const login = p.author?.login;
    const peers = collectReviewers(p, login, rv, isExcluded);

    const merged = Boolean(p.mergedAt);
    const authorEligible =
      merged &&
      login &&
      !isExcluded(login) &&
      (!pr.count_merges_to || pr.count_merges_to.includes(p.baseRefName));

    if (merged && login && !isExcluded(login)) {
      const u = userOf(users, login);
      addCount(u, "prs", p.mergedAt);
    }

    for (const co of p.coauthors || []) {
      if (!co || isExcluded(co) || co === login || !merged) continue;
      addCount(userOf(users, co), "prs_coauthored", p.mergedAt);
    }

    if (authorEligible) {
      // --- PR base points from size (excluding generated files) ---
      const files = (p.files?.nodes || []).map((f) => ({
        path: typeof f === "string" ? f : f.path,
        additions: typeof f === "string" ? null : f.additions,
        deletions: typeof f === "string" ? null : f.deletions,
      }));
      const excluded = files.filter((f) => pathIsExcluded(f.path, excludeRes));
      const rawLines = (p.additions || 0) + (p.deletions || 0);
      const havePerFileLines = files.some((f) => Number.isFinite(f.additions) || Number.isFinite(f.deletions));
      let meaningful;
      if (havePerFileLines) {
        const excludedLines = excluded.reduce(
          (s, f) => s + (f.additions || 0) + (f.deletions || 0),
          0
        );
        meaningful = Math.max(0, rawLines - excludedLines);
      } else {
        const excludedRatio = files.length ? excluded.length / files.length : 0;
        meaningful = Math.round(rawLines * (1 - excludedRatio));
      }

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

      const knownFirst = identities[login]?.firstMergedAt;
      const isFirst = !seenAuthors.has(login) && (!knownFirst || knownFirst >= p.mergedAt);
      if (isFirst) points *= pr.multipliers.first_pr;
      seenAuthors.add(login);

      // Unreviewed self-merges pay half. Burst dumps almost never have a
      // peer review; a normal reviewed fix does.
      const hasScoringPeer = [...peers.scoring.values()].some((s) => s.points > 0);
      if (!hasScoringPeer) {
        points *= pr.unreviewed_multiplier ?? 1;
      }

      // Diminishing returns for many same-day PRs by the same author
      // (discourages splitting one change into many PRs / AI flood).
      const dk = `${login}|${dayKey(p.mergedAt)}`;
      const nth = (prPerDay[dk] = (prPerDay[dk] || 0) + 1);
      points *= diminishingFactor(nth, pr.daily_diminishing);

      points = Math.round(points);
      const used = prPtsPerDay[dk] || 0;
      points = Math.round(clipToCap(points, used, pr.max_points_per_day));
      prPtsPerDay[dk] = used + points;

      const u = userOf(users, login);
      addPoints(u, "pr", points, p.mergedAt);
      u.sizes[bucket] += 1;
    }

    // --- Reviews: count every human who touched the PR; score the best one ---
    for (const [reviewer, info] of peers.counted) {
      const ru = userOf(users, reviewer);
      addCount(ru, "reviews", info.submittedAt || p.updatedAt || p.mergedAt);
      if (info.submissions) {
        addCount(ru, "review_submissions", info.submittedAt || p.updatedAt, info.submissions);
      }
    }
    for (const [reviewer, best] of peers.scoring) {
      if (!best.submittedAt || !best.points) continue;
      let rpts = best.points;
      const rk = `${reviewer}|${dayKey(best.submittedAt)}`;
      const used = reviewPtsPerDay[rk] || 0;
      rpts = Math.round(clipToCap(rpts, used, rv.max_points_per_day));
      reviewPtsPerDay[rk] = used + rpts;
      addPoints(userOf(users, reviewer), "review", rpts, best.submittedAt);
    }
  }

  // --- Issues (low value + steep volume dampening; hard daily ceiling) ---
  // Sort so "first of the day" is deterministic for diminishing returns.
  const issues = [...activity.issues].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );

  for (const i of issues) {
    const login = i.author?.login;
    const labels = (i.labels?.nodes || []).map((l) => l.name.toLowerCase());
    const openerOk = login && !isExcluded(login);

    if (openerOk) addCount(userOf(users, login), "confirmed_issues", i.createdAt);

    const closerLogin = i.closedBy?.login || (typeof i.closedBy === "string" ? i.closedBy : null);
    const closerOk = Boolean(i.closed && closerLogin && !isExcluded(closerLogin));
    if (closerOk) {
      addCount(userOf(users, closerLogin), "issues_closed", i.closedAt || i.createdAt);
    }

    const isDuplicate =
      (is.duplicate_labels || []).some((d) => labels.includes(d.toLowerCase())) ||
      i.stateReason === "DUPLICATE" ||
      i.stateReason === "NOT_PLANNED";
    if (isDuplicate) continue;

    let rawCreate = is.created_points ?? 0;
    for (const [label, pts] of Object.entries(is.difficulty_points || {})) {
      if (labels.includes(label.toLowerCase())) {
        rawCreate = pts;
        break;
      }
    }

    const cap = is.max_points_per_day;
    const factorLogin = openerOk ? login : closerOk ? closerLogin : null;
    if (!factorLogin) continue;

    const createDay = dayKey(i.createdAt);
    const createKey = `${factorLogin}|${createDay}`;
    const nth = openerOk ? (issuePerDay[createKey] = (issuePerDay[createKey] || 0) + 1) : 1;
    const factor = openerOk ? diminishingFactor(nth, is.daily_diminishing) : 1;

    let createPts = openerOk && rawCreate ? rawCreate * factor : 0;
    let closedPts = 0;
    if (i.closed && i.stateReason !== "NOT_PLANNED" && (is.closed_bonus || 0) > 0) {
      closedPts = (is.closed_bonus || 0) * (openerOk ? factor : 1);
    }

    if (createPts) {
      const usedCreate = issuePtsPerDay[createKey] || 0;
      createPts = clipToCap(createPts, usedCreate, cap);
      issuePtsPerDay[createKey] = usedCreate + createPts;
    }

    const bonusTo = is.closed_bonus_to || "closer";
    let closedRecipient = openerOk ? login : null;
    if (bonusTo === "closer" && closerOk) closedRecipient = closerLogin;
    else if (bonusTo === "closer" && closerLogin && isExcluded(closerLogin) && openerOk) {
      closedRecipient = login;
    }
    if (!closedRecipient) closedPts = 0;

    if (closedPts > 0 && closedRecipient) {
      const closeDay = dayKey(i.closedAt || i.createdAt);
      const closeKey = `${closedRecipient}|${closeDay}`;
      const usedClose = issuePtsPerDay[closeKey] || 0;
      closedPts = clipToCap(closedPts, usedClose, cap);
      issuePtsPerDay[closeKey] = usedClose + closedPts;
    }

    createPts = Math.round(createPts);
    closedPts = Math.round(closedPts);

    if (createPts && openerOk) addPoints(userOf(users, login), "issue", createPts, i.createdAt);

    if (closedPts > 0 && closedRecipient) {
      addPoints(userOf(users, closedRecipient), "issue", closedPts, i.closedAt || i.createdAt);
      addCount(userOf(users, closedRecipient), "fixed_bonuses", i.closedAt || i.createdAt);
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
  const countCategories = [
    "prs",
    "reviews",
    "confirmed_issues",
    "fixed_bonuses",
    "manual",
    "prs_coauthored",
    "issues_closed",
    "review_submissions",
  ];
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
