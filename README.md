# Mantis Leaderboard

A leaderboard that tracks who's actively contributing to the Mantis repos —
merged PRs, real code reviews, confirmed bugs. It only reads GitHub, never
writes anything back except to this repo, and it can't touch the actual
Mantis codebases.

It's ranked by points earned in the trailing 4 weeks, not lifetime totals,
so it's about who's active *now*, not who has the biggest all-time score.

## Live leaderboard

<!-- LEADERBOARD:START -->
| Rank | Contributor | Points | PRs | Reviews | Issues |
| :--: | :---------- | -----: | --: | ------: | -----: |
| 🥇 | [@chreia](https://github.com/chreia) | **1596** | 82 | 0 | 0 |
| 🥈 | [@MantisCartography](https://github.com/MantisCartography) | **1448** | 141 | 154 | 0 |
| 🥉 | [@ppxscal](https://github.com/ppxscal) | **738** | 91 | 6 | 0 |
| #4 | [@AnasMaar](https://github.com/AnasMaar) | **435** | 164 | 22 | 0 |
| #5 | [@vinays6](https://github.com/vinays6) | **273** | 29 | 15 | 0 |
| #6 | [@LucaVor](https://github.com/LucaVor) | **203** | 107 | 6 | 0 |
| #7 | [@pranilraichura](https://github.com/pranilraichura) | **126** | 27 | 1 | 0 |
| #8 | [@charleywolf](https://github.com/charleywolf) | **114** | 30 | 3 | 0 |
| #9 | [@rohan-va](https://github.com/rohan-va) | **113** | 51 | 21 | 0 |
| #10 | [@DemonizedCrush](https://github.com/DemonizedCrush) | **106** | 77 | 63 | 0 |

_Last updated: Tue, 21 Jul 2026 02:56:46 GMT_
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
| Confirmed issue | 10 / 20 / 30 | base / high / critical severity, from a maintainer label |
| Confirmed issue fixed | same again | reporter earns it a second time once the bug is actually closed |

All of this lives in [`config/rules.yml`](config/rules.yml) — point values,
size buckets, label names, anti-gaming thresholds. Change a number, open a
PR, done. No code changes needed, and it recomputes from scratch on the next
run so nothing needs migrating.
