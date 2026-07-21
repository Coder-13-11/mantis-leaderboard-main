// -----------------------------------------------------------------------------
// index.mjs — Orchestrator. Recomputes the leaderboard from scratch each run:
//   fetch (read-only)  ->  score (config-driven)  ->  render (JSON/HTML/README)
//
// Env:
//   GH_TOKEN   read-only token with read access to the repos in config/rules.yml
//
// Which repos to track lives in config/rules.yml (`repos:`), not here.
// -----------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import yaml from "js-yaml";

import { fetchActivity } from "./fetch.mjs";
import { score } from "./score.mjs";
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
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("GH_TOKEN is required (read-only token).");

  const rules = yaml.load(readFileSync(join(ROOT, "config/rules.yml"), "utf8"));
  if (!rules.repos?.length) throw new Error("config/rules.yml needs a non-empty `repos` list.");

  console.log(`Fetching activity for ${rules.repos.length} repos (last ${rules.lookback_days} days)...`);
  const activity = await fetchActivity(token, rules.repos, rules.lookback_days);
  console.log(`  ${activity.pullRequests.length} merged PRs, ${activity.issues.length} issues`);

  const users = score(activity, rules);
  console.log(`  scored ${users.length} contributors`);

  const meta = {
    repos: rules.repos,
    lookback_days: rules.lookback_days,
    windows_days: rules.display?.windows_days || [7, 14],
    rules_version: rules.version,
  };

  mkdirSync(join(ROOT, "data"), { recursive: true });
  mkdirSync(join(ROOT, "site"), { recursive: true });
  writeFileSync(join(ROOT, "data/leaderboard.json"), renderJson(users, meta));
  writeFileSync(join(ROOT, "site/index.html"), renderHtml(users, meta));
  updateReadme(
    join(ROOT, "README.md"),
    renderReadmeTable(users, rules.display.top_n_in_readme, meta.windows_days)
  );

  console.log("Wrote data/leaderboard.json, site/index.html, README.md");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
