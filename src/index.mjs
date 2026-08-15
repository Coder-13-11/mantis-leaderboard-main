// -----------------------------------------------------------------------------
// index.mjs — Orchestrator.
//   list GitHub (read-only)  ->  event store  ->  score  ->  render
//
// Env:
//   GH_TOKEN    read-only token for the org repos in config/rules.yml
//   SYNC_MODE   incremental | full   (empty store always does full)
// -----------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import yaml from "js-yaml";

import { fetchActivity } from "./fetch.mjs";
import { rememberName, saveStore } from "./store.mjs";
import { score } from "./score.mjs";
import { enrichUserNames } from "./profiles.mjs";
import { renderJson, renderHtml, renderReadmeTable } from "./render.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const STORE_DIR = join(ROOT, "data/store");

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
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("GH_TOKEN is required (read-only token).");

  const rules = yaml.load(readFileSync(join(ROOT, "config/rules.yml"), "utf8"));
  if (!rules.repos?.length) throw new Error("config/rules.yml needs a non-empty `repos` list.");

  const mode = process.env.SYNC_MODE || "incremental";
  console.log(`Fetching activity (mode=${mode}, lookback=${rules.lookback_days}d)...`);
  const activity = await fetchActivity(token, rules.repos, rules.lookback_days, {
    rules,
    storeDir: STORE_DIR,
    mode,
  });
  const q = activity.quality || {};
  console.log(
    `  store: ${q.event_counts?.prs ?? "?"} PRs, ${q.event_counts?.reviews ?? "?"} reviews, ${q.event_counts?.review_comments ?? "?"} inline comments, ${q.event_counts?.issues ?? "?"} issues`
  );
  if (q.warnings?.length) {
    for (const w of q.warnings) console.warn(`  ! ${w}`);
  }

  let manual = { contributions: [] };
  const manualPath = join(ROOT, "data/manual.yml");
  if (existsSync(manualPath)) {
    manual = yaml.load(readFileSync(manualPath, "utf8")) || { contributions: [] };
  }
  const approvedManual = (manual.contributions || []).filter((c) => c?.approved === true).length;
  console.log(`  ${approvedManual} approved manual contributions`);

  const identities = activity.store?.identities || {};
  const users = score(activity, rules, manual, identities);
  console.log(`  scored ${users.length} human contributors`);

  for (const u of users) {
    if (!u.name && identities[u.login]?.name) u.name = identities[u.login].name;
  }

  console.log("Resolving full names from GitHub profiles...");
  await enrichUserNames(users, token);
  const named = users.filter((u) => u.name).length;
  console.log(`  ${named}/${users.length} profiles have a public full name`);

  if (activity.store) {
    for (const u of users) rememberName(activity.store.identities, u.login, u.name);
    saveStore(STORE_DIR, activity.store);
  }

  const meta = {
    repos: activity.repos || rules.repos,
    lookback_days: rules.lookback_days,
    windows_days: rules.display?.windows_days || [7, 14],
    manual_categories: rules.manual_contributions?.categories || {},
    rules_version: rules.version,
    sync: q,
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
      closed_bonus_to: rules.issues.closed_bonus_to,
      bug_points: rules.issues.bug_points,
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
    renderReadmeTable(users, rules.display.top_n_in_readme, meta.windows_days)
  );

  console.log("Wrote data/store/*, data/leaderboard.json, site/index.html, README.md");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
