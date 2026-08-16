// Guards the SHIPPED config in config/rules.yml, as opposed to score.test.mjs
// which exercises the engine against its own fixture. The engine still fully
// supports issue scoring and is tested for it; this file asserts that the
// config we actually ship has it switched off, so it cannot drift back on by
// accident.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import yaml from "js-yaml";
import { score } from "../src/score.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rules = yaml.load(readFileSync(join(ROOT, "config/rules.yml"), "utf8"));

test("issues award no points in the shipped config", () => {
  const is = rules.issues;
  // Every one of these OVERRIDES created_points when its label matches, so
  // all of them must be zero — not just created_points.
  for (const key of [
    "created_points",
    "closed_bonus",
    "bug_points",
    "confirmed_points",
    "impact_points",
  ]) {
    assert.equal(is[key] ?? 0, 0, `issues.${key} must be 0 while issue scoring is off`);
  }
  assert.equal(is.severity_bonus?.high ?? 0, 0);
  assert.equal(is.severity_bonus?.medium ?? 0, 0);
  for (const [label, pts] of Object.entries(is.difficulty_points || {})) {
    assert.equal(pts, 0, `difficulty_points["${label}"] would reactivate issue scoring`);
  }
});

test("no issue can score under the shipped config, whatever its labels", () => {
  // End-to-end guard through the real engine using the real config: throw
  // every label that used to pay at a closed, PR-fixed issue and assert zero.
  const now = new Date().toISOString();
  const users = score(
    {
      pullRequests: [],
      issues: [
        {
          author: { login: "alice" },
          createdAt: now,
          closed: true,
          closedAt: now,
          closedBy: { login: "maintainer" },
          closedByMergedPr: true,
          stateReason: "COMPLETED",
          labels: { nodes: [{ name: "bug" }, { name: "confirmed" }, { name: "imp:8" }] },
          labelActors: { "imp:8": "MantisCartography" },
          repository: { nameWithOwner: "KellisLab/Mantis" },
          number: 1,
        },
      ],
    },
    rules
  );
  const alice = users.find((u) => u.login === "alice");
  assert.equal(alice?.breakdown.issue ?? 0, 0, "issues must contribute no points");
  assert.equal(alice?.counts.confirmed_issues, 1, "but the activity count is still tracked");
});

test("code and review scoring remain active", () => {
  assert.ok(rules.pull_requests.points.base > 0, "PRs must still score");
  assert.ok(rules.reviews.approved_points > 0, "approvals must still score");
  assert.ok(rules.reviews.changes_requested_points > 0, "change requests must still score");
  assert.ok(rules.reviews.commented_points > 0, "comment reviews must still score");
});
