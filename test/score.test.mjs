import { test } from "node:test";
import assert from "node:assert/strict";
import { diminishingFactor, nthInRolling, score } from "../src/score.mjs";

const FACTORS = [1.0, 1.0, 0.8, 0.65, 0.5, 0.35];

const rules = {
  pull_requests: {
    points: { base: 10, max_bonus: 4, half_life_lines: 80 },
    size_buckets: { XS: 10, S: 50, M: 250, L: 800 },
    multipliers: { high_impact: 1.5 },
    documentation_labels: ["docs"],
    impact_labels: ["impact: high"],
    bug_labels: ["bug"],
    bug_fix_bonus: 4,
    exclude_paths: ["**/package-lock.json"],
    count_merges_to: ["main", "master"],
    daily_diminishing: { window_hours: 24, factors: FACTORS },
  },
  reviews: {
    approved_points: 6,
    changes_requested_points: 8,
    commented_points: 4,
    inline_comment_bonus: 3,
    nontrivial_pr_bonus: 2,
    addressed_changes_bonus: 4,
    nontrivial_pr_lines: 40,
    min_inline_length: 15,
    min_body_length: 20,
    commented_min_body_length: 40,
    approved_min_body_length: 60,
    exclude_self_review: true,
    one_per_pr_per_reviewer: true,
    daily_diminishing: { window_hours: 24, factors: FACTORS },
  },
  issues: {
    created_points: 1,
    closed_bonus: 8,
    closed_bonus_to: "reporter",
    max_points_per_day: 10,
    severity_bonus: {
      high: 4,
      medium: 2,
      high_labels: ["imp:8", "super-issue"],
      medium_labels: ["imp:5"],
    },
    bug_labels: ["bug"],
    bug_points: 6,
    confirmed_labels: ["confirmed"],
    confirmed_points: 10,
    impact_labels: ["impact: high"],
    impact_points: 16,
    daily_diminishing: { window_hours: 24, factors: [1.0, 0.75, 0.45, 0.25, 0.12, 0.06] },
    duplicate_labels: ["duplicate"],
    difficulty_points: { "difficulty: 6": 36 },
  },
  display: { windows_days: [7, 14], exclude_logins: ["dependabot[bot]"], exclude_login_patterns: ["\\[bot\\]$"] },
};

function pr(over = {}) {
  const mergedAt = over.mergedAt || new Date().toISOString();
  return {
    id: over.id || "PR_1",
    number: over.number || 1,
    title: over.title || "x",
    additions: over.additions ?? 10,
    deletions: over.deletions ?? 0,
    mergedAt,
    baseRefName: over.baseRefName || "main",
    state: "MERGED",
    author: { login: over.author || "alice" },
    coauthors: over.coauthors || [],
    repository: { nameWithOwner: "KellisLab/Mantis" },
    labels: { nodes: (over.labels || []).map((name) => ({ name })) },
    files: {
      nodes: over.files || [{ path: "src/a.js", additions: over.additions ?? 10, deletions: 0 }],
    },
    reviews: { nodes: over.reviews || [] },
    reviewComments: { nodes: over.reviewComments || [] },
  };
}

function expectedPrPoints(lines, nth = 1, extra = 0) {
  const bonus = 4 * (lines / (lines + 80));
  const factor = diminishingFactor(nth, { factors: FACTORS });
  return Math.round((10 + bonus + extra) * factor);
}

test("diminishing factor table: 1st/2nd full, 6th+ at 35%", () => {
  const cfg = { factors: FACTORS };
  assert.equal(diminishingFactor(1, cfg), 1);
  assert.equal(diminishingFactor(2, cfg), 1);
  assert.equal(diminishingFactor(3, cfg), 0.8);
  assert.equal(diminishingFactor(6, cfg), 0.35);
  assert.equal(diminishingFactor(20, cfg), 0.35);
});

test("nthInRolling uses a trailing window, not UTC midnight", () => {
  const t0 = Date.parse("2026-08-14T23:50:00Z");
  const t1 = Date.parse("2026-08-15T00:10:00Z");
  const t2 = Date.parse("2026-08-15T00:30:00Z");
  const day = 24 * 3600_000;
  assert.equal(nthInRolling([], t0, day), 1);
  assert.equal(nthInRolling([t0], t1, day), 2);
  assert.equal(nthInRolling([t0, t1], t2, day), 3);
  const later = Date.parse("2026-08-16T00:30:00Z");
  assert.equal(nthInRolling([t0, t1, t2], later, day), 1);
});

test("PR counts include non-main branches; points do not", () => {
  const activity = {
    pullRequests: [
      pr({ id: "1", author: "alice", baseRefName: "develop", mergedAt: new Date().toISOString() }),
    ],
    issues: [],
  };
  const users = score(activity, rules);
  const alice = users.find((u) => u.login === "alice");
  assert.equal(alice.counts.prs, 1);
  assert.equal(alice.breakdown.pr, 0);
});

test("a bare rubber-stamp approval scores nothing", () => {
  const now = new Date().toISOString();
  const stamp = (body) => ({
    pullRequests: [
      pr({
        author: "alice",
        reviews: [{ id: "r1", state: "APPROVED", body, submittedAt: now, author: { login: "bob" } }],
      }),
    ],
    issues: [],
  });
  // 22 chars: clears the old shared min_body_length of 20, but not the
  // approval-specific bar — this is exactly the LGTM case.
  const rubber = score(stamp("LGTM, looks good to me"), rules).find((u) => u.login === "bob");
  assert.equal(rubber?.breakdown.review ?? 0, 0);

  // A real approval that explains what was checked still scores.
  const real = score(
    stamp("Approved — pulled this locally and verified the migration is idempotent against a seeded DB."),
    rules
  ).find((u) => u.login === "bob");
  assert.ok(real.breakdown.review >= 6);
});

test("a short approval still scores when it carries a substantive inline comment", () => {
  const now = new Date().toISOString();
  const users = score(
    {
      pullRequests: [
        pr({
          author: "alice",
          reviews: [{ id: "r1", state: "APPROVED", body: "lgtm", submittedAt: now, author: { login: "bob" } }],
          reviewComments: [
            {
              author: { login: "bob" },
              body: "this retry loop will spin forever if the socket is half-open",
              createdAt: now,
            },
          ],
        }),
      ],
      issues: [],
    },
    rules
  );
  const bob = users.find((u) => u.login === "bob");
  assert.ok(bob.breakdown.review >= 6);
});

test("finding problems keeps the lower bar: a short CHANGES_REQUESTED still scores", () => {
  const now = new Date().toISOString();
  const users = score(
    {
      pullRequests: [
        pr({
          author: "alice",
          reviews: [
            {
              id: "r1",
              state: "CHANGES_REQUESTED",
              body: "this leaks a db connection", // 26 chars — under the approval bar
              submittedAt: now,
              author: { login: "bob" },
            },
          ],
        }),
      ],
      issues: [],
    },
    rules
  );
  const bob = users.find((u) => u.login === "bob");
  assert.ok(bob.breakdown.review >= 8);
});

test("short LGTM still counts as a review; inline comments can make it score", () => {
  const now = new Date().toISOString();
  const activity = {
    pullRequests: [
      pr({
        author: "alice",
        reviews: [
          { id: "r1", state: "COMMENTED", body: "lgtm", submittedAt: now, author: { login: "bob" } },
        ],
        reviewComments: [
          {
            author: { login: "bob" },
            body: "this is a substantive inline remark about the algorithm",
            createdAt: now,
          },
        ],
      }),
    ],
    issues: [],
  };
  const users = score(activity, rules);
  const bob = users.find((u) => u.login === "bob");
  assert.equal(bob.counts.reviews, 1);
  assert.ok(bob.breakdown.review >= 4);
  assert.ok(bob.ledger.some((e) => e.notes?.includes("inline comments")));
});

test("lockfile lines are subtracted from size, not ratio-guessed", () => {
  const now = new Date().toISOString();
  const small = score(
    {
      pullRequests: [
        pr({
          id: "s",
          additions: 5,
          files: [{ path: "src/a.js", additions: 5, deletions: 0 }],
          mergedAt: now,
        }),
      ],
      issues: [],
    },
    rules
  ).find((u) => u.login === "alice");

  const lock = score(
    {
      pullRequests: [
        pr({
          id: "l",
          additions: 50005,
          files: [
            { path: "src/a.js", additions: 5, deletions: 0 },
            { path: "package-lock.json", additions: 50000, deletions: 0 },
          ],
          mergedAt: now,
        }),
      ],
      issues: [],
    },
    rules
  ).find((u) => u.login === "alice");

  assert.equal(small.breakdown.pr, lock.breakdown.pr);
});

test("duplicates pay nothing; the closer is never paid for closing", () => {
  const now = new Date().toISOString();
  const activity = {
    pullRequests: [],
    issues: [
      {
        author: { login: "alice" },
        createdAt: now,
        closed: true,
        closedAt: now,
        closedBy: { login: "carol" },
        stateReason: null,
        labels: { nodes: [{ name: "duplicate" }] },
        repository: { nameWithOwner: "KellisLab/Mantis" },
        number: 1,
      },
      {
        author: { login: "alice" },
        createdAt: now,
        closed: true,
        closedAt: now,
        closedBy: { login: "carol" },
        stateReason: "COMPLETED",
        labels: { nodes: [] },
        repository: { nameWithOwner: "KellisLab/Mantis" },
        number: 2,
      },
    ],
  };
  const users = score(activity, rules);
  const alice = users.find((u) => u.login === "alice");
  const carol = users.find((u) => u.login === "carol");
  assert.equal(alice.counts.confirmed_issues, 2);
  assert.equal(carol.counts.issues_closed, 2);
  // Issue #1 is a duplicate and pays nothing at all. Issue #2 pays Alice
  // 1 for filing + an 8pt finder's fee, because Carol (not Alice) closed it.
  assert.equal(alice.breakdown.issue, 9);
  // Carol did the closing and earns nothing for it: closing is too easy to
  // farm, so the value flows to whoever reported the thing worth fixing.
  assert.equal(carol.breakdown.issue || 0, 0);
});

test("coauthors are counted separately and do not take the merge", () => {
  const activity = {
    pullRequests: [pr({ author: "alice", coauthors: ["dave"] })],
    issues: [],
  };
  const users = score(activity, rules);
  const dave = users.find((u) => u.login === "dave");
  const alice = users.find((u) => u.login === "alice");
  assert.equal(alice.counts.prs, 1);
  assert.equal(dave.counts.prs, 0);
  assert.equal(dave.counts.prs_coauthored, 1);
});

test("a contributor's first PR is scored exactly like any other PR", () => {
  const now = new Date().toISOString();
  const activity = { pullRequests: [pr({ author: "alice", mergedAt: now })], issues: [] };
  const withHistory = score(activity, rules, {}, { alice: { firstMergedAt: "2024-01-01T00:00:00Z" } });
  const without = score(activity, rules, {}, {});
  const a1 = withHistory.find((u) => u.login === "alice");
  const a2 = without.find((u) => u.login === "alice");
  assert.equal(a1.breakdown.pr, a2.breakdown.pr);
  // No first-* badges are emitted: they were window-relative and so mislabelled
  // long-standing contributors as newcomers.
  assert.equal(a1.badges, undefined);
  assert.equal(a2.badges, undefined);
});

test("bots never appear", () => {
  const activity = {
    pullRequests: [pr({ author: "dependabot[bot]" })],
    issues: [],
  };
  const users = score(activity, rules);
  assert.equal(users.length, 0);
});

test("unreviewed PRs are not penalized; the reviewer is rewarded instead", () => {
  const now = new Date().toISOString();
  const bare = score({ pullRequests: [pr({ id: "a", mergedAt: now })], issues: [] }, rules).find(
    (u) => u.login === "alice"
  );
  const reviewed = score(
    {
      pullRequests: [
        pr({
          id: "b",
          mergedAt: now,
          reviews: [
            {
              id: "r",
              state: "APPROVED",
              // Must clear approved_min_body_length: this test is about the
              // reviewer being rewarded, not about the rubber-stamp gate.
              body: "Approved — I walked the error paths and confirmed the new index covers the slow query.",
              submittedAt: now,
              author: { login: "bob" },
            },
          ],
        }),
      ],
      issues: [],
    },
    rules
  );
  const aliceR = reviewed.find((u) => u.login === "alice");
  const bob = reviewed.find((u) => u.login === "bob");
  assert.equal(bare.breakdown.pr, aliceR.breakdown.pr);
  assert.ok(bob.breakdown.review >= 6);
});

test("extra PRs in 24h still score, at a declining rate, with no hard cap", () => {
  const t0 = Date.now();
  const prs = Array.from({ length: 7 }, (_, i) =>
    pr({
      id: `p${i}`,
      number: i + 1,
      mergedAt: new Date(t0 + i * 60_000).toISOString(),
      additions: 10,
    })
  );
  const alice = score({ pullRequests: prs, issues: [] }, rules).find((u) => u.login === "alice");
  const expected = [1, 2, 3, 4, 5, 6, 7].reduce((s, nth) => s + expectedPrPoints(10, nth), 0);
  assert.equal(alice.breakdown.pr, expected);
  assert.ok(alice.breakdown.pr > 36, "7 real PRs must beat the old 36-pt ceiling");
  const sixth = alice.ledger.filter((e) => e.kind === "pr")[5];
  assert.match(String(sixth.notes.join(" ")), /6th in 24h/);
});

test("PRs 20 minutes apart across UTC midnight share one 24h window", () => {
  const t1 = new Date();
  t1.setUTCHours(23, 50, 0, 0);
  if (t1.getTime() > Date.now()) t1.setUTCDate(t1.getUTCDate() - 1);
  const t2 = new Date(t1.getTime() + 20 * 60_000);
  const t3 = new Date(t1.getTime() + 40 * 60_000);
  const alice = score(
    {
      pullRequests: [
        pr({ id: "1", number: 1, mergedAt: t1.toISOString() }),
        pr({ id: "2", number: 2, mergedAt: t2.toISOString() }),
        pr({ id: "3", number: 3, mergedAt: t3.toISOString() }),
      ],
      issues: [],
    },
    rules
  ).find((u) => u.login === "alice");
  const pts = alice.ledger.filter((e) => e.kind === "pr").map((e) => e.points);
  assert.equal(pts[0], expectedPrPoints(10, 1));
  assert.equal(pts[1], expectedPrPoints(10, 2));
  assert.equal(pts[2], expectedPrPoints(10, 3));
  assert.ok(pts[2] < pts[0], "3rd PR across midnight is diminished, not a fresh day");
});

test("docs PRs are classified separately, not given a flat multiplier", () => {
  const now = new Date().toISOString();
  const alice = score(
    {
      pullRequests: [
        pr({
          id: "d",
          labels: ["docs"],
          files: [{ path: "README.md", additions: 10, deletions: 0 }],
          mergedAt: now,
        }),
      ],
      issues: [],
    },
    rules
  ).find((u) => u.login === "alice");
  assert.equal(alice.breakdown.pr, 0);
  assert.equal(alice.breakdown.docs, expectedPrPoints(10, 1));
  assert.equal(alice.windowDimensions[7].shipping, 0);
  assert.ok(alice.counts.docs_prs >= 1);
});

test("requested changes that are later merged earn an addressed bonus", () => {
  const reviewedAt = new Date(Date.now() - 3600_000).toISOString();
  const mergedAt = new Date().toISOString();
  const bob = score(
    {
      pullRequests: [
        pr({
          additions: 80,
          files: [{ path: "src/a.js", additions: 80, deletions: 0 }],
          mergedAt,
          reviews: [
            {
              id: "r",
              state: "CHANGES_REQUESTED",
              body: "this introduces a race when two workers update state",
              submittedAt: reviewedAt,
              author: { login: "bob" },
            },
          ],
        }),
      ],
      issues: [],
    },
    rules
  ).find((u) => u.login === "bob");
  // 8 base + 2 nontrivial + 4 addressed = 14
  assert.equal(bob.breakdown.review, 14);
  assert.ok(bob.ledger[0].notes.includes("change addressed"));
});

test("difficulty-labeled issues outrank unlabeled chore tickets", () => {
  const now = new Date().toISOString();
  const users = score(
    {
      pullRequests: [],
      issues: [
        {
          author: { login: "alice" },
          createdAt: now,
          closed: false,
          labels: { nodes: [{ name: "difficulty: 6" }] },
          repository: { nameWithOwner: "KellisLab/Mantis" },
          number: 9,
        },
      ],
    },
    rules
  );
  const alice = users.find((u) => u.login === "alice");
  // The raw difficulty tier is 36, but filing points are bounded by
  // `max_points_per_day` (10). That ceiling is intentional — it bounds what
  // filing alone can ever be worth in a day — and it means the high end of
  // the difficulty scale is unreachable while these labels stay dormant.
  // The property that matters here is that a labeled issue still far
  // outranks an unlabeled chore (1 pt).
  assert.equal(alice.breakdown.issue, 10);
  assert.ok(alice.breakdown.issue > 1);
});

const mkIssue = (over = {}) => ({
  author: { login: "griffin" },
  createdAt: new Date().toISOString(),
  closed: false,
  labels: { nodes: [] },
  repository: { nameWithOwner: "KellisLab/Mantis" },
  number: 1,
  ...over,
});

test("the reporter is paid when someone else closes their issue as completed", () => {
  const now = new Date().toISOString();
  const users = score(
    {
      pullRequests: [],
      issues: [mkIssue({ closed: true, closedAt: now, closedBy: { login: "maintainer" } })],
    },
    rules
  );
  const griffin = users.find((u) => u.login === "griffin");
  // 1 for filing + 8 finder's fee.
  assert.equal(griffin.breakdown.issue, 9);
  assert.ok(griffin.ledger.some((e) => e.kind === "issue_closed"));
});

test("closing your own issue pays no finder's fee", () => {
  const now = new Date().toISOString();
  const users = score(
    {
      pullRequests: [],
      issues: [mkIssue({ closed: true, closedAt: now, closedBy: { login: "griffin" } })],
    },
    rules
  );
  const griffin = users.find((u) => u.login === "griffin");
  assert.equal(griffin.breakdown.issue, 1); // filing only — no self-close bonus
  assert.ok(!griffin.ledger.some((e) => e.kind === "issue_closed"));
});

test("an unresolved pile of issues stays nearly worthless", () => {
  const now = Date.now();
  const users = score(
    {
      pullRequests: [],
      issues: Array.from({ length: 25 }, (_, i) =>
        mkIssue({ createdAt: new Date(now - i * 60_000).toISOString(), number: 100 + i })
      ),
    },
    rules
  );
  const griffin = users.find((u) => u.login === "griffin");
  // 25 unverified tickets in one burst: the decay floor keeps this tiny.
  assert.ok(griffin.breakdown.issue < 4, `expected <4, got ${griffin.breakdown.issue}`);
});

test("decayed issues accumulate instead of each rounding to zero", () => {
  const now = Date.now();
  const users = score(
    {
      pullRequests: [],
      issues: Array.from({ length: 6 }, (_, i) =>
        mkIssue({ createdAt: new Date(now - i * 60_000).toISOString(), number: 200 + i })
      ),
    },
    rules
  );
  const griffin = users.find((u) => u.login === "griffin");
  // Raw: 1 + .75 + .45 + .25 + .12 + .06 = 2.63. Rounding each event to an
  // integer first would have thrown away everything from the 3rd on and
  // yielded 2 — the cliff this guards against.
  assert.ok(griffin.breakdown.issue > 2.5, `expected >2.5, got ${griffin.breakdown.issue}`);
});

test("severity bonus applies only when someone else applied the label", () => {
  const now = new Date().toISOString();
  const run = (labelActors) =>
    score(
      {
        pullRequests: [],
        issues: [
          mkIssue({
            closed: true,
            closedAt: now,
            closedBy: { login: "maintainer" },
            labels: { nodes: [{ name: "imp:8" }] },
            labelActors,
          }),
        ],
      },
      rules
    ).find((u) => u.login === "griffin");

  // Triage agent applied it: 1 filing + 8 fix + 4 severity.
  assert.equal(run({ "imp:8": "MantisCartography" }).breakdown.issue, 13);
  // Filer applied it to their own issue: no severity kicker.
  assert.equal(run({ "imp:8": "griffin" }).breakdown.issue, 9);
  // Applier unknown (old snapshot): withhold rather than guess in their favour.
  assert.equal(run(null).breakdown.issue, 9);
});

test("filing is capped per day but verified fixes are not", () => {
  const now = Date.now();
  const mk = (n, over = {}) =>
    Array.from({ length: n }, (_, i) =>
      mkIssue({ createdAt: new Date(now - i * 60_000).toISOString(), number: 300 + i, ...over })
    );

  const filedOnly = score({ pullRequests: [], issues: mk(27) }, rules).find(
    (u) => u.login === "griffin"
  );
  assert.ok(
    filedOnly.breakdown.issue <= 6,
    `filing should be capped at 6, got ${filedOnly.breakdown.issue}`
  );

  const allFixed = score(
    {
      pullRequests: [],
      issues: mk(10, { closed: true, closedAt: new Date(now).toISOString(), closedBy: { login: "maintainer" } }),
    },
    rules
  ).find((u) => u.login === "griffin");
  // 10 verified fixes x 8 = 80, uncapped, plus capped filing.
  assert.ok(allFixed.breakdown.issue >= 80, `expected >=80, got ${allFixed.breakdown.issue}`);
});

test("Griffin-style: 27 ordinary issues cannot outrank a merged PR", () => {
  const now = Date.now();
  const issues = Array.from({ length: 27 }, (_, i) => ({
    author: { login: "griffin" },
    createdAt: new Date(now - i * 60_000).toISOString(),
    closed: true,
    closedAt: new Date(now - i * 60_000 + 1000).toISOString(),
    closedBy: { login: "griffin" },
    stateReason: "COMPLETED",
    labels: { nodes: [] },
    repository: { nameWithOwner: "KellisLab/Mantis" },
    number: i + 1,
  }));
  const users = score(
    {
      pullRequests: [
        pr({ id: "ship", author: "alice", number: 100, mergedAt: new Date(now).toISOString() }),
      ],
      issues,
    },
    rules
  );
  const griffin = users.find((u) => u.login === "griffin");
  const alice = users.find((u) => u.login === "alice");
  assert.equal(griffin.counts.confirmed_issues, 27);
  assert.ok(griffin.breakdown.issue > 0, "opening issues must score something");
  assert.ok(griffin.breakdown.issue < alice.windows[7], "27 chores cannot beat a merged PR");
  assert.ok(alice.rank < griffin.rank);
});

test("bug reports score more than chores; confirmed issues score more than bugs", () => {
  const now = new Date().toISOString();
  const users = score(
    {
      pullRequests: [],
      issues: [
        {
          author: { login: "alice" },
          createdAt: now,
          closed: false,
          labels: { nodes: [{ name: "bug" }] },
          repository: { nameWithOwner: "KellisLab/Mantis" },
          number: 1,
        },
        {
          author: { login: "bob" },
          createdAt: now,
          closed: false,
          labels: { nodes: [{ name: "confirmed" }] },
          repository: { nameWithOwner: "KellisLab/Mantis" },
          number: 2,
        },
      ],
    },
    rules
  );
  const alice = users.find((u) => u.login === "alice");
  const bob = users.find((u) => u.login === "bob");
  assert.equal(alice.breakdown.issue, 6);
  assert.equal(bob.breakdown.issue, 10);
});

test("score is auditable: ledger + window breakdown sum to the total", () => {
  const now = new Date().toISOString();
  const alice = score(
    {
      pullRequests: [pr({ id: "1", number: 4, mergedAt: now, title: "fix parser" })],
      issues: [
        {
          author: { login: "alice" },
          createdAt: now,
          closed: false,
          labels: { nodes: [] },
          repository: { nameWithOwner: "KellisLab/Mantis" },
          number: 2,
          title: "wrong output",
        },
      ],
    },
    rules
  ).find((u) => u.login === "alice");
  const b = alice.windowBreakdown[7];
  assert.equal(b.pr + b.review + b.issue + b.docs + b.other, alice.windows[7]);
  assert.equal(alice.ledger.reduce((s, e) => s + e.points, 0), alice.total);
  assert.equal(alice.windowDimensions[7].overall, alice.windows[7]);
  assert.ok(alice.ledger.some((e) => e.ref === "KellisLab/Mantis#4"));
});
