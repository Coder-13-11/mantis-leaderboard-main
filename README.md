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
| 🥇 | **Hoang** ([@6namdang](https://github.com/6namdang)) | **70** | 6 | 2 | 1 |
| 🥈 | **Yakshith** ([@YakshithK](https://github.com/YakshithK)) | **67** | 4 | 0 | 12 |
| 🥉 | **Ilan Barts** ([@absol761](https://github.com/absol761)) | **59** | 8 | 0 | 0 |
| #4 | **Sebastien Kawada** ([@chreia](https://github.com/chreia)) | **41** | 33 | 0 | 7 |
| #5 | Name not found ([@VishwanathanV](https://github.com/VishwanathanV)) | **40** | 3 | 0 | 0 |
| #6 | Name not found ([@alexandragreenwood](https://github.com/alexandragreenwood)) | **40** | 2 | 0 | 5 |
| #7 | Name not found ([@Cruz-Arnzen](https://github.com/Cruz-Arnzen)) | **39** | 3 | 0 | 1 |
| #8 | **Pranava Kumar** ([@PranavaKCode](https://github.com/PranavaKCode)) | **37** | 71 | 0 | 0 |
| #9 | **Rohan Vaidya** ([@rohan-va](https://github.com/rohan-va)) | **29** | 3 | 1 | 1 |
| #10 | **Griffin Consigli** ([@gconsigli](https://github.com/gconsigli)) | **28** | 1 | 0 | 14 |

#### Past 14 Days

| Rank | Contributor | Points | PRs | Reviews | Issues |
| :--: | :---------- | -----: | --: | ------: | -----: |
| 🥇 | **Pranava Kumar** ([@PranavaKCode](https://github.com/PranavaKCode)) | **136** | 97 | 0 | 4 |
| 🥈 | **Hoang** ([@6namdang](https://github.com/6namdang)) | **119** | 12 | 3 | 2 |
| 🥉 | **Sebastien Kawada** ([@chreia](https://github.com/chreia)) | **110** | 78 | 0 | 8 |
| #4 | **Yakshith** ([@YakshithK](https://github.com/YakshithK)) | **100** | 6 | 0 | 17 |
| #5 | **Rohan Vaidya** ([@rohan-va](https://github.com/rohan-va)) | **92** | 10 | 1 | 3 |
| #6 | Name not found ([@alexandragreenwood](https://github.com/alexandragreenwood)) | **77** | 4 | 0 | 6 |
| #7 | Name not found ([@charleywolf](https://github.com/charleywolf)) | **77** | 7 | 0 | 11 |
| #8 | **Ilan Barts** ([@absol761](https://github.com/absol761)) | **66** | 9 | 0 | 0 |
| #9 | **Arjun Kulkarni** ([@DemonizedCrush](https://github.com/DemonizedCrush)) | **63** | 3 | 3 | 1 |
| #10 | **Taksh Kothari** ([@Chessing234](https://github.com/Chessing234)) | **50** | 14 | 0 | 3 |

_Last updated: Fri, 14 Aug 2026 09:10:49 GMT_
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

Mantis already codes a lot, often as many small PRs. The unit of value is a
**day of work**, not a PR. Two solid merges fill a shipping day; the 71st
merge that day is still that same day.

| Contribution | Points | Notes |
| ------------ | ------ | ----- |
| Merged PR | 10–22 | saturating size bonus (not XS–XL buckets). Unreviewed (no peer review) ×0.5 |
| Doc / first / high-impact PR | ×1.25 / ×1.5 / ×1.5 | labels, or first merged PR in the lookback |
| PR points per person per day | cap 36 | ~2 typical PRs. Burst merges cannot exceed a normal coding day |
| Commented review | 6 | Finish-review comment, body ≥ 40 chars |
| Approved review | 8 | body ≥ 20 chars |
| Changes requested | 10 | body ≥ 20 chars; finding problems pays more than LGTM |
| Review points per person per day | cap 20 | a review day cannot beat a shipping day |
| Issue created / closed | 2 / +1 | cap 6 issue pts/day |
| Issue difficulty (future) | 1 → 16 | a `difficulty: 1…6` label *replaces* the flat 2. Dormant until labeled |

**Anti-gaming:** same-day extra PRs decay to zero after the second merge,
*and* PR points hard-cap at 36/day. Spreading work across the week is the
only way to stack. Tunable in [`config/rules.yml`](config/rules.yml).

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

**"What counts as a review?"** A review scores if *all* of these hold:
1. State is **Approved**, **Changes requested**, or **Commented** (a finished
   review with a real body). Dismissed and Pending never score. Inline-only
   comments with no review body still don't score — GitHub doesn't attach
   those to the review node we fetch.
2. Body length: ≥ `reviews.min_body_length` (20) for Approve / Request
   changes, ≥ `reviews.commented_min_body_length` (40) for Commented.
3. You didn't review your own PR (`exclude_self_review: true`).
4. One credit per (reviewer, PR): the **highest-value** review type wins
   (comment then approve pays 8, not 6). Follow-up rounds on the same PR
   do not stack. Intentional anti-spam.
5. Reviews are scored even if the PR targets a branch outside
   `pull_requests.count_merges_to` — reviewing that work still counts,
   even though the author gets no merge points for it.
6. Review points also hard-cap at `reviews.max_points_per_day` (20).

**"What counts as a merged PR?"** Only PRs GitHub reports as merged
(`is:merged`), and only merges into `pull_requests.count_merges_to` branches
(currently `main`/`master` — a PR merged into any other branch, e.g. a
`develop` or release branch, scores nothing and isn't counted at all). If any
tracked repo actually uses a different default/integration branch, PRs into
it will silently not appear anywhere on this leaderboard until that branch
name is added to `count_merges_to`. Unreviewed merges (no scoring peer
review) pay `unreviewed_multiplier` (0.5). PR *points* then hard-cap at
`max_points_per_day` (36) per person per UTC day — counts still show all
the merges.

All of this lives in [`config/rules.yml`](config/rules.yml). Point values
and caps change without code; new *kinds* of events (e.g. commented
reviews, a PR daily cap) needed a scorer change once and are now
config-driven. It recomputes from scratch on the next `npm run build`.
