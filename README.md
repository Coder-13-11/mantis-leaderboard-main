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
| 🥇 | [@chreia](https://github.com/chreia) | **1766** | 109 | 0 | 0 |
| 🥈 | [@MantisCartography](https://github.com/MantisCartography) | **1005** | 151 | 161 | 0 |
| 🥉 | [@ppxscal](https://github.com/ppxscal) | **360** | 96 | 6 | 0 |
| #4 | [@AnasMaar](https://github.com/AnasMaar) | **295** | 167 | 21 | 0 |
| #5 | [@6namdang](https://github.com/6namdang) | **122** | 9 | 1 | 0 |
| #6 | [@PranavaKCode](https://github.com/PranavaKCode) | **105** | 103 | 1 | 0 |
| #7 | [@Cruz-Arnzen](https://github.com/Cruz-Arnzen) | **102** | 7 | 0 | 0 |
| #8 | [@charleywolf](https://github.com/charleywolf) | **80** | 32 | 3 | 0 |
| #9 | [@rohan-va](https://github.com/rohan-va) | **73** | 53 | 22 | 0 |
| #10 | [@dhedhialy](https://github.com/dhedhialy) | **71** | 21 | 3 | 0 |

#### Past 14 Days

| Rank | Contributor | Points | PRs | Reviews | Issues |
| :--: | :---------- | -----: | --: | ------: | -----: |
| 🥇 | [@chreia](https://github.com/chreia) | **2195** | 109 | 0 | 0 |
| 🥈 | [@MantisCartography](https://github.com/MantisCartography) | **1468** | 151 | 161 | 0 |
| 🥉 | [@ppxscal](https://github.com/ppxscal) | **866** | 96 | 6 | 0 |
| #4 | [@AnasMaar](https://github.com/AnasMaar) | **490** | 167 | 21 | 0 |
| #5 | [@alex-d4v](https://github.com/alex-d4v) | **153** | 38 | 7 | 0 |
| #6 | [@vinays6](https://github.com/vinays6) | **139** | 30 | 15 | 0 |
| #7 | [@6namdang](https://github.com/6namdang) | **122** | 9 | 1 | 0 |
| #8 | [@charleywolf](https://github.com/charleywolf) | **122** | 32 | 3 | 0 |
| #9 | [@PranavaKCode](https://github.com/PranavaKCode) | **105** | 103 | 1 | 0 |
| #10 | [@Cruz-Arnzen](https://github.com/Cruz-Arnzen) | **102** | 7 | 0 | 0 |

_Last updated: Thu, 23 Jul 2026 00:07:38 GMT_
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
