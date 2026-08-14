import { test } from "node:test";
import assert from "node:assert/strict";
import { score } from "../src/score.mjs";

const rules = {
  pull_requests: {
    points: { base: 10, max_bonus: 12, half_life_lines: 60 },
    size_buckets: { XS: 10, S: 50, M: 250, L: 800 },
    multipliers: { documentation: 1.25, first_pr: 1.5, high_impact: 1.5 },
    documentation_labels: ["docs"],
    impact_labels: ["impact: high"],
    unreviewed_multiplier: 0.5,
    exclude_paths: ["**/package-lock.json"],
    count_merges_to: ["main", "master"],
    daily_diminishing: { after: 2, decay: 0.4, min_factor: 0 },
    max_points_per_day: 36,
  },
  reviews: {
    approved_points: 8,
    changes_requested_points: 10,
    commented_points: 6,
    min_body_length: 20,
    commented_min_body_length: 40,
    exclude_self_review: true,
    one_per_pr_per_reviewer: true,
    max_points_per_day: 20,
  },
  issues: {
    created_points: 2,
    closed_bonus: 1,
    closed_bonus_to: "closer",
    daily_diminishing: { after: 2, decay: 0.4, min_factor: 0.05 },
    max_points_per_day: 6,
    duplicate_labels: ["duplicate"],
    difficulty_points: {},
  },
  display: { windows_days: [7, 14], exclude_logins: ["dependabot[bot]"], exclude_login_patterns: ["\\[bot\\]$"] },
};

function pr(over = {}) {
  const mergedAt = over.mergedAt || new Date().toISOString();
  return {
    id: over.id || "PR_1",
    number: over.number || 1,
    title: "x",
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
  assert.ok(bob.breakdown.review >= 6);
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
          reviews: [
            {
              id: "r",
              state: "APPROVED",
              body: "looks good to me, nice work here",
              submittedAt: now,
              author: { login: "bob" },
            },
          ],
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
          reviews: [
            {
              id: "r",
              state: "APPROVED",
              body: "looks good to me, nice work here",
              submittedAt: now,
              author: { login: "bob" },
            },
          ],
        }),
      ],
      issues: [],
    },
    rules
  ).find((u) => u.login === "alice");

  assert.equal(small.breakdown.pr, lock.breakdown.pr);
});

test("issues opened are counted even when duplicate; closer gets close bonus", () => {
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
      },
    ],
  };
  const users = score(activity, rules);
  const alice = users.find((u) => u.login === "alice");
  const carol = users.find((u) => u.login === "carol");
  assert.equal(alice.counts.confirmed_issues, 2);
  assert.equal(carol.counts.issues_closed, 2);
  assert.ok(carol.breakdown.issue >= 1);
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

test("first_pr bonus is skipped when identities already have an earlier merge", () => {
  const now = new Date().toISOString();
  const activity = { pullRequests: [pr({ author: "alice", mergedAt: now })], issues: [] };
  const withHistory = score(activity, rules, {}, { alice: { firstMergedAt: "2024-01-01T00:00:00Z" } });
  const without = score(activity, rules, {}, {});
  const a1 = withHistory.find((u) => u.login === "alice").breakdown.pr;
  const a2 = without.find((u) => u.login === "alice").breakdown.pr;
  assert.ok(a2 > a1);
});

test("bots never appear", () => {
  const activity = {
    pullRequests: [pr({ author: "dependabot[bot]" })],
    issues: [],
  };
  const users = score(activity, rules);
  assert.equal(users.length, 0);
});
