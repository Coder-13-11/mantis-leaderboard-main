# Mantis Leaderboard

A leaderboard that tracks who's actively contributing to the Mantis repos —
merged PRs, real code reviews, confirmed bugs. It only reads GitHub, never
writes anything back except to this repo, and it can't touch the actual
Mantis codebases.

It's ranked by points earned in the past 7 days (with a 14-day view
alongside it), not lifetime totals, so it's about who's active *now*, not
who has the biggest all-time score.

## Live leaderboard

<!-- LEADERBOARD:START -->
#### Past 7 Days

| Rank | Contributor | Points | PRs | Reviews | Issues |
| :--: | :---------- | -----: | --: | ------: | -----: |
| 🥇 | [@chreia](https://github.com/chreia) | **966** | 62 | 0 | 23 |
| 🥈 | [@MantisCartography](https://github.com/MantisCartography) | **870** | 18 | 31 | 19 |
| 🥉 | [@ppxscal](https://github.com/ppxscal) | **494** | 24 | 0 | 1 |
| #4 | [@alex-d4v](https://github.com/alex-d4v) | **254** | 3 | 1 | 39 |
| #5 | [@AnasMaar](https://github.com/AnasMaar) | **220** | 10 | 1 | 1 |
| #6 | [@Cruz-Arnzen](https://github.com/Cruz-Arnzen) | **142** | 9 | 0 | 0 |
| #7 | [@rohan-va](https://github.com/rohan-va) | **95** | 4 | 0 | 7 |
| #8 | [@charleywolf](https://github.com/charleywolf) | **94** | 3 | 0 | 0 |
| #9 | [@6namdang](https://github.com/6namdang) | **80** | 3 | 0 | 0 |
| #10 | [@dhedhialy](https://github.com/dhedhialy) | **73** | 4 | 0 | 6 |

#### Past 14 Days

| Rank | Contributor | Points | PRs | Reviews | Issues |
| :--: | :---------- | -----: | --: | ------: | -----: |
| 🥇 | [@chreia](https://github.com/chreia) | **1510** | 104 | 0 | 34 |
| 🥈 | [@MantisCartography](https://github.com/MantisCartography) | **1476** | 55 | 40 | 38 |
| 🥉 | [@ppxscal](https://github.com/ppxscal) | **752** | 45 | 0 | 1 |
| #4 | [@AnasMaar](https://github.com/AnasMaar) | **454** | 26 | 2 | 1 |
| #5 | [@alex-d4v](https://github.com/alex-d4v) | **315** | 4 | 1 | 52 |
| #6 | [@charleywolf](https://github.com/charleywolf) | **194** | 6 | 0 | 12 |
| #7 | [@Cruz-Arnzen](https://github.com/Cruz-Arnzen) | **142** | 9 | 0 | 0 |
| #8 | [@6namdang](https://github.com/6namdang) | **139** | 6 | 0 | 5 |
| #9 | [@rohan-va](https://github.com/rohan-va) | **136** | 4 | 1 | 13 |
| #10 | [@vinays6](https://github.com/vinays6) | **119** | 3 | 4 | 0 |

_Last updated: Sat, 25 Jul 2026 19:26:36 GMT_
<!-- LEADERBOARD:END -->

## Setup

**1. Create a read-only token.**
GitHub → Settings → Developer settings → Fine-grained tokens → New token.

- Resource owner: the org
- Repository access: pick exactly the repos listed under `repos:` in
  [`config/rules.yml`](config/rules.yml) — not "All repositories". If a repo
  isn't in that list, the token shouldn't be able to see it.
- Permissions, set only these to Read, everything else No access:
  Contents, Pull requests, Issues, Metadata (auto-required).

Zero write permissions means this thing is physically incapable of changing
anything else, even if there's a bug in it somewhere.

**2. Add it as a secret.**
Repo → Settings → Secrets and variables → Actions → New repository secret →
name it `ORG_READ_TOKEN`, paste the token.

**3. Run it.**
Actions tab → "Update Leaderboard" → Run workflow. After that it runs on its
own every hour (cron's in `.github/workflows/update-leaderboard.yml`).

**Where results show up:** there's no GitHub Pages site here — Pages needs a
paid plan for private repos. Instead every run commits the refreshed numbers
straight into the repo:

- this README's table above, updates itself
- `site/index.html` — pull the repo and open it in a browser
- `data/leaderboard.json` — raw scored data if you want to build on top of it

**Running it locally:**

```bash
npm install
GH_TOKEN=your_token npm run build
open site/index.html
```

## Daily Discord digest

A separate workflow posts the top 10 to a Discord channel once a day —
just a webhook POST, no bot process to run or host.

**1. Create an Incoming Webhook in Discord.**
Channel → Edit Channel → Integrations → Webhooks → New Webhook → name it
(e.g. "Mantis Leaderboard") → **Copy Webhook URL**.

**2. Add it as a secret.**
Repo → Settings → Secrets and variables → Actions → New repository secret →
name it `DISCORD_WEBHOOK_URL`, paste the URL.

**3. Test it.**
Actions tab → "Daily Discord Digest" → Run workflow. It posts immediately;
after that it runs on its own every day at 14:00 UTC (cron in
`.github/workflows/discord-digest.yml` — edit the cron line for a different time).

It reads the `data/leaderboard.json` the hourly refresh already keeps
current, so this job never needs `ORG_READ_TOKEN` — it can only read this
repo's own committed file and POST to the one webhook URL you gave it.

## How scoring works

| Contribution | Points | Notes |
| ------------ | ------ | ----- |
| Merged PR | 5 / 10 / 16 / 24 / 32 | XS / S / M / L / XL by meaningful lines changed — deliberately flat, size alone can't dominate |
| Doc PR | ×1.25 | PR labeled `documentation` |
| High-impact PR | ×1.5 | PR labeled `priority: critical`/`priority: high`/`impact: high` — the counterweight to line-count scoring |
| First PR | ×1.5 | contributor's first merged PR |
| Approved review | 20 | must have a real body (anti-spam) |
| Changes requested | 15 | must have a real body |
| Issue created | 3 | any valid issue (not duplicate/invalid/wontfix/not-planned) — kept low, it's the easiest thing to farm |
| Issue closed | +2 | small bonus once someone acts on it and closes it as completed |
| Issue difficulty (future) | 2 → 24 | a `difficulty: 1…6` label *replaces* the flat 3 — harder issues worth more. Dormant until you apply the labels |

**Anti-gaming:** merging many PRs on the *same day* hits diminishing returns
(the main way to farm this is splitting one change into lots of small PRs).
The first few PRs a day score full; each further same-day PR is worth a
shrinking fraction. A normal cadence is unaffected. Tunable under
`pull_requests.daily_diminishing` in `config/rules.yml`.

All of this lives in [`config/rules.yml`](config/rules.yml) — point values,
size buckets, label names, anti-gaming thresholds. Change a number, open a
PR, done. No code changes needed, and it recomputes from scratch on the next
run so nothing needs migrating.
