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
| 🥇 | [@chreia](https://github.com/chreia) | **986** | 60 | 0 | 18 |
| 🥈 | [@MantisCartography](https://github.com/MantisCartography) | **706** | 15 | 26 | 13 |
| 🥉 | [@ppxscal](https://github.com/ppxscal) | **634** | 32 | 0 | 1 |
| #4 | [@alex-d4v](https://github.com/alex-d4v) | **342** | 5 | 0 | 56 |
| #5 | [@AnasMaar](https://github.com/AnasMaar) | **215** | 9 | 1 | 1 |
| #6 | [@Cruz-Arnzen](https://github.com/Cruz-Arnzen) | **142** | 9 | 0 | 0 |
| #7 | [@gconsigli](https://github.com/gconsigli) | **106** | 1 | 3 | 9 |
| #8 | [@rohan-va](https://github.com/rohan-va) | **97** | 2 | 1 | 8 |
| #9 | [@charleywolf](https://github.com/charleywolf) | **94** | 3 | 0 | 0 |
| #10 | [@LucaVor](https://github.com/LucaVor) | **84** | 3 | 1 | 0 |

#### Past 14 Days

| Rank | Contributor | Points | PRs | Reviews | Issues |
| :--: | :---------- | -----: | --: | ------: | -----: |
| 🥇 | [@chreia](https://github.com/chreia) | **1669** | 110 | 0 | 35 |
| 🥈 | [@MantisCartography](https://github.com/MantisCartography) | **1568** | 55 | 45 | 37 |
| 🥉 | [@ppxscal](https://github.com/ppxscal) | **735** | 39 | 0 | 1 |
| #4 | [@AnasMaar](https://github.com/AnasMaar) | **454** | 26 | 2 | 1 |
| #5 | [@alex-d4v](https://github.com/alex-d4v) | **418** | 6 | 1 | 69 |
| #6 | [@charleywolf](https://github.com/charleywolf) | **194** | 6 | 0 | 12 |
| #7 | [@6namdang](https://github.com/6namdang) | **171** | 8 | 0 | 5 |
| #8 | [@gconsigli](https://github.com/gconsigli) | **169** | 2 | 3 | 18 |
| #9 | [@rohan-va](https://github.com/rohan-va) | **159** | 4 | 2 | 14 |
| #10 | [@Cruz-Arnzen](https://github.com/Cruz-Arnzen) | **142** | 9 | 0 | 0 |

_Last updated: Sun, 26 Jul 2026 17:02:35 GMT_
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
own every 2 hours (cron's in `.github/workflows/update-leaderboard.yml`).

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

It reads the `data/leaderboard.json` the 2-hourly refresh already keeps
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

### Exactly what counts (the questions people actually ask)

**"Is this the total?"** No single number on this page is an unqualified
lifetime total:
- The **"Past 7 Days" / "Past 14 Days" tables** above are trailing windows
  ending today — this is what ranks people.
- The **stat tiles on `site/index.html`** ("PRs merged", "Reviews", "Issues
  logged") are a wider, *unranked* count over the full `lookback_days` window
  (currently 365 days) — not all-time. Anything older than `lookback_days`
  was never fetched, so those tiles will always undercount true lifetime
  activity once a repo is older than that. If you want real all-time totals,
  raise `lookback_days` in `config/rules.yml` (tradeoff: longer run time, and
  GitHub's search API caps any single query at 1,000 results).

**"What counts as a review?"** A review only scores if *all* of these hold:
1. State is **Approved** or **Changes requested** — Commented, Dismissed, and
   Pending reviews never score, no matter how long the comment is. A `/gemini
   review`-style comment, or a comment-only pass with no formal
   approve/request-changes, is real work but isn't counted today.
2. The review body is at least `reviews.min_body_length` characters (15 by
   default) — kills empty "LGTM" approvals.
3. You didn't review your own PR (`exclude_self_review: true`).
4. Only your **first** scored review on a given PR counts
   (`one_per_pr_per_reviewer: true`) — this is the one that most understates
   real effort. If you request changes, the author pushes fixes, and you come
   back and do a second (or third) full review pass before approving, only
   that *first* requested-changes review is credited — the follow-up review
   rounds and the eventual approval add nothing further. On a PR with several
   review rounds, your "Reviews" count only ever goes up by 1 for it, not by
   the number of times you actually reviewed it. This is intentional
   anti-spam (stops trivial re-click farming), but it means a thorough,
   multi-round reviewer's count will look much lower than their actual GitHub
   activity — worth knowing before assuming the number is wrong.
5. Reviews are scored independently of which branch the PR merges into —
   reviewing a PR that targets a non-tracked branch (outside
   `pull_requests.count_merges_to`) still earns full review credit, even
   though the PR author gets no points for it.

**"What counts as a merged PR?"** Only PRs GitHub reports as merged
(`is:merged`), and only merges into `pull_requests.count_merges_to` branches
(currently `main`/`master` — a PR merged into any other branch, e.g. a
`develop` or release branch, scores nothing and isn't counted at all). If any
tracked repo actually uses a different default/integration branch, PRs into
it will silently not appear anywhere on this leaderboard until that branch
name is added to `count_merges_to`.

All of this lives in [`config/rules.yml`](config/rules.yml) — point values,
size buckets, label names, anti-gaming thresholds. Change a number, open a
PR, done. No code changes needed, and it recomputes from scratch on the next
run so nothing needs migrating.
