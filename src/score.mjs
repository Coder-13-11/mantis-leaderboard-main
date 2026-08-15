// -----------------------------------------------------------------------------
// score.mjs — Pure scoring engine. Config-driven, no hardcoded point values.
//
// Given raw org activity + the rules config, it produces per-user scores with
// a full breakdown and an auditable ledger. Being a pure function makes it
// easy to test and to re-run against history whenever the rules change.
// -----------------------------------------------------------------------------

const HOUR_MS = 3600_000;
const DAY_MS = 86400_000;
const POINT_CATEGORIES = ["pr", "review", "issue", "docs", "other"];
const COUNT_CATEGORIES = [
  "prs",
  "reviews",
  "confirmed_issues",
  "fixed_bonuses",
  "manual",
  "prs_coauthored",
  "issues_closed",
  "review_submissions",
  "docs_prs",
  "bug_prs",
];

const BADGE_LABELS = {
  first_pr: "First Contribution",
  first_review: "First Review",
  first_issue: "First Bug Report",
};

const DOC_PATH_RE = /\.(md|mdx|rst|txt|adoc)$/i;
const DOC_DIR_RE = /(^|\/)(docs|documentation)\//;

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

function isDocPath(path) {
  const p = String(path || "").replace(/\\/g, "/");
  return DOC_PATH_RE.test(p) || DOC_DIR_RE.test(p);
}

function sizeBucket(lines, buckets) {
  if (lines <= buckets.XS) return "XS";
  if (lines <= buckets.S) return "S";
  if (lines <= buckets.M) return "M";
  if (lines <= buckets.L) return "L";
  return "XL";
}

function dayKey(dateStr) {
  return new Date(dateStr).toISOString().slice(0, 10);
}

function parseTime(dateStr) {
  const t = Date.parse(dateStr);
  return Number.isFinite(t) ? t : 0;
}

function repoRef(p) {
  const repo = p.repository?.nameWithOwner || p.repo || "";
  return repo && p.number ? `${repo}#${p.number}` : repo || "";
}

function githubUrl(p, kind = "pull") {
  const repo = p.repository?.nameWithOwner || p.repo;
  if (!repo || !p.number) return null;
  return `https://github.com/${repo}/${kind}/${p.number}`;
}

function labelNames(entity) {
  return (entity.labels?.nodes || []).map((l) => (typeof l === "string" ? l : l.name).toLowerCase());
}

function hasAnyLabel(labels, wanted) {
  if (!wanted?.length) return false;
  const set = new Set(labels);
  return wanted.some((d) => set.has(String(d).toLowerCase()));
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

function emptyCounts() {
  return Object.fromEntries(COUNT_CATEGORIES.map((k) => [k, 0]));
}

function emptyBreakdown() {
  return Object.fromEntries(POINT_CATEGORIES.map((k) => [k, 0]));
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
      dayCounts: {}, // day -> counts, for sparklines
      dayBreakdown: {}, // day -> breakdown, for calendar charts
      breakdown: emptyBreakdown(),
      counts: emptyCounts(),
      sizes: { XS: 0, S: 0, M: 0, L: 0, XL: 0 },
      contributions: [], // approved manual/off-GitHub entries, for highlights
      ledger: [], // auditable scored events
      badges: [],
      timed: [], // { t, category, points } — rolling windows
      timedCounts: [], // { t, category, n }
    };
  }
  return users[login];
}

function addBadge(user, id, at) {
  if (!user || user.badges.some((b) => b.id === id)) return;
  user.badges.push({ id, at, label: BADGE_LABELS[id] || id });
}

function addLedger(user, entry) {
  if (!user || !entry?.points) return;
  user.ledger.push(entry);
}

// Credit points to a user's lifetime total, category breakdown, and the day
// the points were earned on. Rolling windows are summed from `timed`.
function addPoints(user, category, points, earnedAt, ledgerEntry) {
  if (!points) return;
  user.total += points;
  user.breakdown[category] = (user.breakdown[category] || 0) + points;
  const day = dayKey(earnedAt);
  user.days[day] = (user.days[day] || 0) + points;
  if (!user.dayBreakdown[day]) user.dayBreakdown[day] = emptyBreakdown();
  user.dayBreakdown[day][category] = (user.dayBreakdown[day][category] || 0) + points;
  user.timed.push({ t: parseTime(earnedAt), category, points });
  if (ledgerEntry) addLedger(user, { at: earnedAt, category, points, ...ledgerEntry });
}

// Bump a lifetime count AND the same count bucketed by the day it happened.
function addCount(user, category, earnedAt, n = 1) {
  user.counts[category] = (user.counts[category] || 0) + n;
  const day = dayKey(earnedAt);
  if (!user.dayCounts[day]) user.dayCounts[day] = emptyCounts();
  user.dayCounts[day][category] = (user.dayCounts[day][category] || 0) + n;
  user.timedCounts.push({ t: parseTime(earnedAt), category, n });
}

// Same-window diminishing factor for the n-th event of a category.
// Prefers an explicit factors table (1st, 2nd, …, last repeats). Falls back
// to the older after/decay/min_factor curve if that's what's configured.
export function diminishingFactor(nth, cfg) {
  if (!cfg) return 1;
  if (Array.isArray(cfg.factors) && cfg.factors.length) {
    const i = Math.max(1, nth) - 1;
    return cfg.factors[Math.min(i, cfg.factors.length - 1)];
  }
  if (!Number.isFinite(cfg.after) || nth <= cfg.after) return 1;
  return Math.max(cfg.min_factor ?? 0, (cfg.decay ?? 1) ** (nth - cfg.after));
}

function windowMs(cfg, fallbackHours = 24) {
  const hours = cfg?.window_hours ?? fallbackHours;
  return Math.max(1, hours) * HOUR_MS;
}

// How many prior events fall inside (t - window, t]. Current event is nth.
export function nthInRolling(priorTimes, t, ms) {
  let n = 0;
  for (const prev of priorTimes) {
    const dt = t - prev;
    if (dt >= 0 && dt < ms) n += 1;
  }
  return n + 1;
}

// Clip `want` so it does not push `used` above `cap`. Returns the allowed amount.
// Hard ceilings are opt-in; the default rules no longer set them.
function clipToCap(want, used, cap) {
  if (!Number.isFinite(cap)) return want;
  const remaining = Math.max(0, cap - used);
  return Math.min(want, remaining);
}

function prFiles(p) {
  return (p.files?.nodes || []).map((f) => ({
    path: typeof f === "string" ? f : f.path,
    additions: typeof f === "string" ? null : f.additions,
    deletions: typeof f === "string" ? null : f.deletions,
  }));
}

function meaningfulLines(p, excludeRes) {
  const files = prFiles(p);
  const excluded = files.filter((f) => pathIsExcluded(f.path, excludeRes));
  const rawLines = (p.additions || 0) + (p.deletions || 0);
  const havePerFileLines = files.some((f) => Number.isFinite(f.additions) || Number.isFinite(f.deletions));
  if (havePerFileLines) {
    const excludedLines = excluded.reduce((s, f) => s + (f.additions || 0) + (f.deletions || 0), 0);
    return Math.max(0, rawLines - excludedLines);
  }
  const excludedRatio = files.length ? excluded.length / files.length : 0;
  return Math.round(rawLines * (1 - excludedRatio));
}

function isDocsPr(p, labels, prCfg, excludeRes) {
  if (hasAnyLabel(labels, prCfg.documentation_labels)) return true;
  const files = prFiles(p).filter((f) => f.path && !pathIsExcluded(f.path, excludeRes));
  if (!files.length) return false;
  return files.every((f) => isDocPath(f.path));
}

// Points for a single review node, or 0 if it doesn't meet the bar.
function reviewBasePoints(state, bodyLen, inlineSubstantive, rv) {
  const min = rv.min_body_length ?? 0;
  const cmin = rv.commented_min_body_length ?? min;
  const qualifies =
    bodyLen >= (state === "COMMENTED" ? cmin : min) || inlineSubstantive > 0;
  if (!qualifies) return 0;
  if (state === "APPROVED") return rv.approved_points ?? 0;
  if (state === "CHANGES_REQUESTED") return rv.changes_requested_points ?? 0;
  if (state === "COMMENTED" && (rv.commented_points ?? 0) > 0) return rv.commented_points;
  return 0;
}

// Collect every human who reviewed this PR (submitted review and/or inline
// comments). Scoring still uses quality thresholds; counts do not.
function collectReviewers(p, authorLogin, rv, isExcluded) {
  const minInline = rv.min_inline_length ?? 15;
  const comments = p.reviewComments?.nodes || [];
  const inlineByLogin = new Map();
  for (const c of comments) {
    const login = c.author?.login;
    if (!login || isExcluded(login)) continue;
    if (rv.exclude_self_review && login === authorLogin) continue;
    const at = c.createdAt || c.submittedAt;
    const len = (c.body || "").trim().length;
    const cur = inlineByLogin.get(login) || {
      bodyLen: 0,
      submittedAt: at,
      inlineCount: 0,
      inlineSubstantive: 0,
    };
    cur.bodyLen += len;
    cur.inlineCount += 1;
    if (len >= minInline) cur.inlineSubstantive += 1;
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

    const inlineSubstantive = inline?.inlineSubstantive || 0;
    const pts = reviewBasePoints(r.state, bodyLen, inlineSubstantive, rv);
    const prev = scoring.get(reviewer);
    const newer =
      !prev || pts > prev.base || (pts === prev.base && submittedAt > prev.submittedAt);
    if (newer) {
      scoring.set(reviewer, {
        base: pts,
        submittedAt,
        state: r.state,
        inlineSubstantive,
        inlineCount: inline?.inlineCount || 0,
      });
    }
  }

  for (const [login, inline] of inlineByLogin) {
    if (!counted.has(login)) {
      counted.set(login, { submittedAt: inline.submittedAt, submissions: 1, inlineOnly: true });
    }
    if (!scoring.has(login)) {
      scoring.set(login, {
        base: reviewBasePoints("COMMENTED", inline.bodyLen, inline.inlineSubstantive, rv),
        submittedAt: inline.submittedAt,
        state: "COMMENTED",
        inlineSubstantive: inline.inlineSubstantive,
        inlineCount: inline.inlineCount,
      });
    }
  }

  return { scoring, counted };
}

function reviewQualityBonuses(best, p, meaningful, rv) {
  const notes = [];
  let extra = 0;
  if ((best.inlineSubstantive || 0) > 0 && (rv.inline_comment_bonus || 0) > 0) {
    extra += rv.inline_comment_bonus;
    notes.push("inline comments");
  }
  const nontrivial = rv.nontrivial_pr_lines ?? 40;
  if (meaningful >= nontrivial && (rv.nontrivial_pr_bonus || 0) > 0) {
    extra += rv.nontrivial_pr_bonus;
    notes.push("nontrivial PR");
  }
  const mergedAt = p.mergedAt ? parseTime(p.mergedAt) : 0;
  const reviewedAt = best.submittedAt ? parseTime(best.submittedAt) : 0;
  if (
    best.state === "CHANGES_REQUESTED" &&
    mergedAt &&
    reviewedAt &&
    mergedAt > reviewedAt &&
    (rv.addressed_changes_bonus || 0) > 0
  ) {
    extra += rv.addressed_changes_bonus;
    notes.push("change addressed");
  }
  return { extra, notes };
}

function applyDiminishing(login, t, buckets, cfg) {
  const ms = windowMs(cfg, 24);
  const times = buckets[login] || (buckets[login] = []);
  const nth = nthInRolling(times, t, ms);
  times.push(t);
  const factor = diminishingFactor(nth, cfg);
  return { nth, factor };
}

function maybeClip(points, login, t, usedMap, cap, cfg) {
  if (!Number.isFinite(cap)) return points;
  // Legacy hard cap, keyed by rolling window start rather than UTC midnight.
  const ms = windowMs(cfg, 24);
  const key = `${login}|${Math.floor(t / ms)}`;
  const used = usedMap[key] || 0;
  const clipped = clipToCap(points, used, cap);
  usedMap[key] = used + clipped;
  return clipped;
}

export function score(activity, rules, manual = {}, identities = {}) {
  const users = {};
  const pr = rules.pull_requests;
  const rv = rules.reviews;
  const is = rules.issues;
  const excludeRes = (pr.exclude_paths || []).map(globToRegExp);
  const isExcluded = buildLoginExcluder(rules);

  const seenAuthors = new Set();
  const prTimes = {};
  const reviewTimes = {};
  const issueTimes = {};
  const prPtsWindow = {};
  const reviewPtsWindow = {};
  const issuePtsWindow = {};

  const prs = [...activity.pullRequests]
    .filter((p) => p.mergedAt || p.state === "OPEN" || p.state === "CLOSED" || (p.reviews?.nodes || []).length)
    .sort(
      (a, b) =>
        new Date(a.mergedAt || a.updatedAt || a.createdAt) - new Date(b.mergedAt || b.updatedAt || b.createdAt)
    );

  for (const p of prs) {
    const login = p.author?.login;
    const labels = labelNames(p);
    const peers = collectReviewers(p, login, rv, isExcluded);
    const meaningful = meaningfulLines(p, excludeRes);
    const docsPr = isDocsPr(p, labels, pr, excludeRes);
    const isBug = hasAnyLabel(labels, pr.bug_labels);
    const isHighImpact = hasAnyLabel(labels, pr.impact_labels);

    const merged = Boolean(p.mergedAt);
    const authorEligible =
      merged &&
      login &&
      !isExcluded(login) &&
      (!pr.count_merges_to || pr.count_merges_to.includes(p.baseRefName));

    if (merged && login && !isExcluded(login)) {
      const u = userOf(users, login);
      addCount(u, "prs", p.mergedAt);
      if (docsPr) addCount(u, "docs_prs", p.mergedAt);
      if (isBug) addCount(u, "bug_prs", p.mergedAt);
    }

    for (const co of p.coauthors || []) {
      if (!co || isExcluded(co) || co === login || !merged) continue;
      addCount(userOf(users, co), "prs_coauthored", p.mergedAt);
    }

    if (authorEligible) {
      const bucket = sizeBucket(meaningful, pr.size_buckets);
      const { base, max_bonus, half_life_lines } = pr.points;
      const bonus = max_bonus * (meaningful / (meaningful + half_life_lines));
      let points = base + bonus;

      // Size is a small input. Impact labels are the explicit quality signal.
      if (isHighImpact) points *= pr.multipliers?.high_impact ?? 1;
      if (isBug && (pr.bug_fix_bonus || 0) > 0) points += pr.bug_fix_bonus;

      const knownFirst = identities[login]?.firstMergedAt;
      const isFirst = !seenAuthors.has(login) && (!knownFirst || knownFirst >= p.mergedAt);
      seenAuthors.add(login);

      const t = parseTime(p.mergedAt);
      const { nth, factor } = applyDiminishing(login, t, prTimes, pr.daily_diminishing);
      points *= factor;
      points = Math.round(points);
      points = Math.round(maybeClip(points, login, t, prPtsWindow, pr.max_points_per_day, pr.daily_diminishing));

      const category = docsPr ? "docs" : "pr";
      const u = userOf(users, login);
      const notes = [];
      if (isFirst) notes.push("first contribution");
      if (isHighImpact) notes.push("high impact");
      if (isBug) notes.push("bug fix");
      if (docsPr) notes.push("documentation");
      if (nth > 1) notes.push(`${nth}th in 24h ×${factor}`);
      addPoints(u, category, points, p.mergedAt, {
        kind: "pr",
        ref: repoRef(p),
        title: p.title || "",
        url: githubUrl(p, "pull"),
        notes,
      });
      u.sizes[bucket] += 1;
      if (isFirst) addBadge(u, "first_pr", p.mergedAt);
    }

    for (const [reviewer, info] of peers.counted) {
      const ru = userOf(users, reviewer);
      addCount(ru, "reviews", info.submittedAt || p.updatedAt || p.mergedAt);
      if (info.submissions) {
        addCount(ru, "review_submissions", info.submittedAt || p.updatedAt, info.submissions);
      }
    }
    for (const [reviewer, best] of peers.scoring) {
      if (!best.submittedAt || !best.base) continue;
      const { extra, notes } = reviewQualityBonuses(best, p, meaningful, rv);
      let rpts = best.base + extra;
      const t = parseTime(best.submittedAt);
      const { nth, factor } = applyDiminishing(reviewer, t, reviewTimes, rv.daily_diminishing);
      rpts *= factor;
      rpts = Math.round(rpts);
      rpts = Math.round(
        maybeClip(rpts, reviewer, t, reviewPtsWindow, rv.max_points_per_day, rv.daily_diminishing)
      );
      const ru = userOf(users, reviewer);
      if (nth > 1) notes.push(`${nth}th review in 24h ×${factor}`);
      if (rpts) {
        addPoints(ru, "review", rpts, best.submittedAt, {
          kind: "review",
          ref: repoRef(p),
          title: p.title || "",
          url: githubUrl(p, "pull"),
          notes: [best.state.toLowerCase().replace(/_/g, " "), ...notes],
        });
        addBadge(ru, "first_review", best.submittedAt);
      }
    }
  }

  const issues = [...activity.issues].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  for (const i of issues) {
    const login = i.author?.login;
    const labels = labelNames(i);
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

    // Ordinary issues are a visible statistic only. Points require a
    // maintainer-applied confirmation: difficulty, confirmed, or high-impact.
    let rawCreate = 0;
    let qualityNote = null;
    for (const [label, pts] of Object.entries(is.difficulty_points || {})) {
      if (labels.includes(label.toLowerCase())) {
        rawCreate = pts;
        qualityNote = label;
        break;
      }
    }
    if (!qualityNote && hasAnyLabel(labels, is.confirmed_labels) && (is.confirmed_points || 0) > 0) {
      rawCreate = is.confirmed_points;
      qualityNote = "confirmed";
    }
    if (!qualityNote && hasAnyLabel(labels, is.impact_labels) && (is.impact_points || 0) > 0) {
      rawCreate = is.impact_points;
      qualityNote = "high impact";
    }

    // Opening or closing a chore ticket must not consume the 24h window
    // or pay anything. Closing only scores if the issue itself was confirmed.
    if (!rawCreate) continue;

    const factorLogin = openerOk ? login : closerOk ? closerLogin : null;
    if (!factorLogin) continue;

    const createT = parseTime(i.createdAt);
    let createFactor = 1;
    let createNth = 1;
    if (openerOk) {
      const d = applyDiminishing(login, createT, issueTimes, is.daily_diminishing);
      createNth = d.nth;
      createFactor = d.factor;
    }

    let createPts = openerOk ? rawCreate * createFactor : 0;
    let closedPts = 0;
    if (i.closed && i.stateReason !== "NOT_PLANNED" && (is.closed_bonus || 0) > 0) {
      closedPts = (is.closed_bonus || 0) * (openerOk && closerLogin === login ? createFactor : 1);
    }

    createPts = maybeClip(
      createPts,
      openerOk ? login : factorLogin,
      createT,
      issuePtsWindow,
      is.max_points_per_day,
      is.daily_diminishing
    );

    const bonusTo = is.closed_bonus_to || "closer";
    let closedRecipient = openerOk ? login : null;
    if (bonusTo === "closer" && closerOk) closedRecipient = closerLogin;
    else if (bonusTo === "closer" && closerLogin && isExcluded(closerLogin) && openerOk) {
      closedRecipient = login;
    }
    if (!closedRecipient) closedPts = 0;

    if (closedPts > 0 && closedRecipient) {
      const closeT = parseTime(i.closedAt || i.createdAt);
      if (closedRecipient !== login || !openerOk) {
        const d = applyDiminishing(closedRecipient, closeT, issueTimes, is.daily_diminishing);
        closedPts *= d.factor;
      }
      closedPts = maybeClip(
        closedPts,
        closedRecipient,
        closeT,
        issuePtsWindow,
        is.max_points_per_day,
        is.daily_diminishing
      );
    }

    createPts = Math.round(createPts);
    closedPts = Math.round(closedPts);

    const issueRef = repoRef(i);
    const issueUrl = githubUrl(i, "issues");

    if (createPts && openerOk) {
      const notes = [];
      if (qualityNote) notes.push(qualityNote);
      if (createNth > 1) notes.push(`${createNth}th in 24h ×${createFactor}`);
      addPoints(userOf(users, login), "issue", createPts, i.createdAt, {
        kind: "issue",
        ref: issueRef,
        title: i.title || "",
        url: issueUrl,
        notes,
      });
      addBadge(userOf(users, login), "first_issue", i.createdAt);
    }

    if (closedPts > 0 && closedRecipient) {
      addPoints(userOf(users, closedRecipient), "issue", closedPts, i.closedAt || i.createdAt, {
        kind: "issue_closed",
        ref: issueRef,
        title: i.title || "",
        url: issueUrl,
        notes: ["closed"],
      });
      addCount(userOf(users, closedRecipient), "fixed_bonuses", i.closedAt || i.createdAt);
    }
  }

  const catDefaults = rules.manual_contributions?.categories || {};
  for (const c of manual?.contributions || []) {
    if (!c || c.approved !== true) continue;
    const login = c.login;
    if (!login || isExcluded(login)) continue;
    const pts = Number.isFinite(c.points) ? c.points : catDefaults[c.type]?.points ?? 0;
    if (!pts) continue;
    const when = c.date ? `${c.date}T12:00:00Z` : new Date().toISOString();

    const u = userOf(users, login);
    addPoints(u, "other", pts, when, {
      kind: "manual",
      ref: c.type || "other",
      title: c.description || "",
      url: c.source || null,
      notes: [c.type || "community"],
    });
    addCount(u, "manual", when);
    u.contributions.push({
      type: c.type,
      points: pts,
      description: c.description || "",
      date: c.date || when.slice(0, 10),
      source: c.source || null,
    });
  }

  const windowsDays = rules.display?.windows_days || [7, 14];
  const now = Date.now();
  for (const u of Object.values(users)) {
    u.windows = {};
    u.windowCounts = {};
    u.windowBreakdown = {};
    u.windowDimensions = {};
    u.windowLedger = {};
    for (const n of windowsDays) {
      const cutoff = now - n * DAY_MS;
      u.windows[n] = u.timed
        .filter((e) => e.t >= cutoff)
        .reduce((sum, e) => sum + e.points, 0);
      u.windowCounts[n] = COUNT_CATEGORIES.reduce((acc, cat) => {
        acc[cat] = u.timedCounts
          .filter((e) => e.t >= cutoff && e.category === cat)
          .reduce((sum, e) => sum + e.n, 0);
        return acc;
      }, {});
      u.windowBreakdown[n] = POINT_CATEGORIES.reduce((acc, cat) => {
        acc[cat] = u.timed
          .filter((e) => e.t >= cutoff && e.category === cat)
          .reduce((sum, e) => sum + e.points, 0);
        return acc;
      }, {});
      const b = u.windowBreakdown[n];
      u.windowDimensions[n] = {
        overall: u.windows[n],
        shipping: b.pr || 0,
        review: b.review || 0,
        bugs: b.issue || 0,
        docs: b.docs || 0,
      };
      u.windowLedger[n] = u.ledger.filter((e) => parseTime(e.at) >= cutoff);
    }
    u.rolling_total = u.windows[windowsDays[0]];
    // Timed arrays are scoring internals; drop them from the snapshot.
    delete u.timed;
    delete u.timedCounts;
  }

  const ranked = Object.values(users).sort((a, b) => b.rolling_total - a.rolling_total);
  ranked.forEach((u, idx) => (u.rank = idx + 1));
  return ranked;
}
