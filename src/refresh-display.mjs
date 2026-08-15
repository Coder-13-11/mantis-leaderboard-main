// -----------------------------------------------------------------------------
// refresh-display.mjs — Re-render site/README from data/leaderboard.json without
// re-fetching GitHub activity. Used when scoring logic is unchanged for the
// snapshot, but display rules (names, bot exclusion, HTML skin) advanced.
//
// Does NOT recompute fair points from raw events — run `npm run build` with
// GH_TOKEN for a true rescore under the new rules.
// -----------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import yaml from "js-yaml";

import { buildLoginExcluder } from "./score.mjs";
import { enrichUserNames } from "./profiles.mjs";
import { renderJson, renderHtml, renderReadmeTable } from "./render.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function updateReadme(readmePath, table) {
  let md;
  try {
    md = readFileSync(readmePath, "utf8");
  } catch {
    md = "# Mantis Leaderboard\n\n<!-- LEADERBOARD:START -->\n<!-- LEADERBOARD:END -->\n";
  }
  const re = /<!-- LEADERBOARD:START -->[\s\S]*?<!-- LEADERBOARD:END -->/;
  md = re.test(md) ? md.replace(re, table) : `${md}\n\n${table}\n`;
  writeFileSync(readmePath, md);
}

async function main() {
  const rules = yaml.load(readFileSync(join(ROOT, "config/rules.yml"), "utf8"));
  const raw = JSON.parse(readFileSync(join(ROOT, "data/leaderboard.json"), "utf8"));
  const isExcluded = buildLoginExcluder(rules);

  let users = (raw.leaderboard || []).filter((u) => !isExcluded(u.login));
  // Prefer primary window already on the record
  const windowsDays = rules.display?.windows_days || raw.windows_days || [7, 14];
  const primary = windowsDays[0];
  users.sort((a, b) => (b.windows?.[primary] || 0) - (a.windows?.[primary] || 0));
  users.forEach((u, i) => {
    u.rank = i + 1;
    if (u.name === undefined) u.name = null;
  });

  console.log(`After bot filter: ${users.length} contributors (was ${raw.leaderboard?.length || 0})`);

  const token = process.env.GH_TOKEN || null;
  if (token) {
    console.log("Resolving full names...");
    await enrichUserNames(users, token);
    console.log(`  ${users.filter((u) => u.name).length}/${users.length} have a public full name`);
  } else {
    console.log("Keeping existing names (no GH_TOKEN).");
  }

  const meta = {
    repos: raw.repos || rules.repos,
    lookback_days: raw.lookback_days || rules.lookback_days,
    windows_days: windowsDays,
    manual_categories: rules.manual_contributions?.categories || raw.manual_categories || {},
    sync: raw.sync || null,
    review_rules: {
      approved_points: rules.reviews.approved_points,
      changes_requested_points: rules.reviews.changes_requested_points,
      commented_points: rules.reviews.commented_points,
      inline_comment_bonus: rules.reviews.inline_comment_bonus,
      nontrivial_pr_bonus: rules.reviews.nontrivial_pr_bonus,
      addressed_changes_bonus: rules.reviews.addressed_changes_bonus,
      min_body_length: rules.reviews.min_body_length,
      commented_min_body_length: rules.reviews.commented_min_body_length,
      exclude_self_review: rules.reviews.exclude_self_review,
      one_per_pr_per_reviewer: rules.reviews.one_per_pr_per_reviewer,
      daily_diminishing: rules.reviews.daily_diminishing,
    },
    pr_rules: {
      count_merges_to: rules.pull_requests.count_merges_to,
      daily_diminishing: rules.pull_requests.daily_diminishing,
      points: rules.pull_requests.points,
      multipliers: rules.pull_requests.multipliers,
      bug_fix_bonus: rules.pull_requests.bug_fix_bonus,
    },
    issue_rules: {
      created_points: rules.issues.created_points,
      closed_bonus: rules.issues.closed_bonus,
      confirmed_points: rules.issues.confirmed_points,
      impact_points: rules.issues.impact_points,
      duplicate_labels: rules.issues.duplicate_labels,
      daily_diminishing: rules.issues.daily_diminishing,
      difficulty_points: rules.issues.difficulty_points,
    },
  };

  mkdirSync(join(ROOT, "data"), { recursive: true });
  mkdirSync(join(ROOT, "site"), { recursive: true });
  writeFileSync(join(ROOT, "data/leaderboard.json"), renderJson(users, meta));
  writeFileSync(join(ROOT, "site/index.html"), renderHtml(users, meta));
  updateReadme(
    join(ROOT, "README.md"),
    renderReadmeTable(users, rules.display.top_n_in_readme, windowsDays)
  );
  console.log("Wrote data/leaderboard.json, site/index.html, README.md");
  console.log("NOTE: points are from the previous snapshot. Run GH_TOKEN=… npm run build to rescore under current rules.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
