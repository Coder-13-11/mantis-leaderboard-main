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

// ISO week label ("2026-W29") for a timestamp, so points can be bucketed by
// the week they were earned in.
function isoWeek(dateStr) {
  const d = new Date(dateStr);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// The `n` most recent ISO week labels, current week included.
function recentWeeks(n) {
  const weeks = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    weeks.push(isoWeek(d.toISOString()));
    d.setUTCDate(d.getUTCDate() - 7);
  }
  return weeks;
}

// Create/return a user record in the accumulator.
function userOf(users, login) {
  if (!login) return null;
  if (!users[login]) {
    users[login] = {
      login,
      total: 0,
      weeks: {},
      breakdown: { pr: 0, review: 0, issue: 0 },
      counts: { prs: 0, reviews: 0, confirmed_issues: 0, fixed_bonuses: 0 },
      sizes: { XS: 0, S: 0, M: 0, L: 0, XL: 0 },
    };
  }
  return users[login];
}

// Credit points to a user's lifetime total, category breakdown, and the ISO
// week the points were earned in.
function addPoints(user, category, points, earnedAt) {
  user.total += points;
  user.breakdown[category] += points;
  const week = isoWeek(earnedAt);
  user.weeks[week] = (user.weeks[week] || 0) + points;
}

export function score(activity, rules) {
  const users = {};
  const pr = rules.pull_requests;
  const rv = rules.reviews;
  const is = rules.issues;
  const excludeRes = (pr.exclude_paths || []).map(globToRegExp);
  const excludeLogins = new Set(rules.display?.exclude_logins || []);

  // Track which login has already been credited a "first PR" bonus.
  const seenAuthors = new Set();

  // Sort PRs chronologically so "first PR" is deterministic.
  const prs = [...activity.pullRequests]
    .filter((p) => p.mergedAt)
    .sort((a, b) => new Date(a.mergedAt) - new Date(b.mergedAt));

  for (const p of prs) {
    const login = p.author?.login;
    if (!login || excludeLogins.has(login)) continue;
    if (pr.count_merges_to && !pr.count_merges_to.includes(p.baseRefName)) continue;

    // --- PR base points from size (excluding generated files) ---
    const files = (p.files?.nodes || []).map((f) => f.path);
    const excludedCount = files.filter((f) => pathIsExcluded(f, excludeRes)).length;
    const excludedRatio = files.length ? excludedCount / files.length : 0;
    // Approximate the meaningful diff by discounting excluded-file share.
    const rawLines = (p.additions || 0) + (p.deletions || 0);
    const meaningful = Math.round(rawLines * (1 - excludedRatio));

    const bucket = sizeBucket(meaningful, pr.size_buckets);
    let points = pr.size_points[bucket];

    // --- Multipliers ---
    const labels = (p.labels?.nodes || []).map((l) => l.name.toLowerCase());
    const isDoc = (pr.documentation_labels || []).some((d) =>
      labels.includes(d.toLowerCase())
    );
    if (isDoc) points *= pr.multipliers.documentation;

    const isFirst = !seenAuthors.has(login);
    if (isFirst) points *= pr.multipliers.first_pr;
    seenAuthors.add(login);

    points = Math.round(points);

    const u = userOf(users, login);
    addPoints(u, "pr", points, p.mergedAt);
    u.counts.prs += 1;
    u.sizes[bucket] += 1;

    // --- Reviews on this PR (anti-spam) ---
    const creditedReviewers = new Set();
    for (const r of p.reviews?.nodes || []) {
      const reviewer = r.author?.login;
      if (!reviewer || excludeLogins.has(reviewer)) continue;
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
      ru.counts.reviews += 1;
    }
  }

  // --- Issues (label-gated) ---
  for (const i of activity.issues) {
    const login = i.author?.login;
    if (!login || excludeLogins.has(login)) continue;
    const labels = (i.labels?.nodes || []).map((l) => l.name.toLowerCase());

    const isDuplicate =
      (is.duplicate_labels || []).some((d) => labels.includes(d.toLowerCase())) ||
      i.stateReason === "DUPLICATE" ||
      i.stateReason === "NOT_PLANNED";
    if (isDuplicate) continue;

    const isConfirmed = (is.confirmed_labels || []).some((c) =>
      labels.includes(c.toLowerCase())
    );
    if (!isConfirmed) continue; // opening an issue alone scores nothing

    const u = userOf(users, login);
    addPoints(u, "issue", is.confirmed_points, i.createdAt);
    u.counts.confirmed_issues += 1;

    // Confirmed AND closed => presumed fixed => bonus to reporter.
    if (i.closed) {
      addPoints(u, "issue", is.fixed_bonus_points, i.closedAt);
      u.counts.fixed_bonuses += 1;
    }
  }

  // Rank by points earned in the trailing window, not lifetime total, so
  // the leaderboard reflects who is active now.
  const window = recentWeeks(rules.display?.rolling_weeks || 4);
  for (const u of Object.values(users)) {
    u.rolling_total = window.reduce((sum, week) => sum + (u.weeks[week] || 0), 0);
  }

  const ranked = Object.values(users).sort((a, b) => b.rolling_total - a.rolling_total);
  ranked.forEach((u, idx) => (u.rank = idx + 1));
  return ranked;
}
