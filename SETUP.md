# Setup

This tool is **fully isolated and read-only**. It runs entirely inside this
repo and only *reads* activity from your other repos. It cannot modify them.

## 1. Create a read-only token

Create a **fine-grained personal access token**
(GitHub → Settings → Developer settings → Fine-grained tokens):

- **Resource owner:** your organization
- **Repository access:** select exactly the repos listed in `config/rules.yml`
  under `repos:` — not "All repositories". If a repo isn't in that list, the
  token shouldn't be able to see it either.
- **Repository permissions — set ONLY these to `Read`, everything else `No access`:**
  - Contents: **Read-only**
  - Pull requests: **Read-only**
  - Issues: **Read-only**
  - Metadata: **Read-only** (auto-required)

> Because the token has **zero write permissions**, this tool is physically
> incapable of changing any other repo — even if there were a bug.

## 2. Add it to this repo

- **Secret** (Settings → Secrets and variables → Actions → *Secrets*):
  - `ORG_READ_TOKEN` = the token from step 1

## 3. Enable GitHub Pages

Settings → Pages → Source: **GitHub Actions**.
The leaderboard will publish to `https://<org>.github.io/mantis-leaderboard/`.

## 4. Run it

Actions tab → **Update Leaderboard** → **Run workflow**.
After that it runs automatically every hour (change the cron in
`.github/workflows/update-leaderboard.yml`).

## Run locally (optional)

```bash
npm install
GH_TOKEN=your_token npm run build
open site/index.html
```

## Changing scoring

Edit `config/rules.yml` and open a PR. Point values, PR size buckets,
multipliers, and anti-gaming thresholds all live there — no code changes.
The leaderboard recomputes from scratch on the next run.
