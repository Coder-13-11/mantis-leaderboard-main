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
| 🥇 | **Yakshith** ([@YakshithK](https://github.com/YakshithK)) | **79** | 6 | 0 | 12 |
| 🥈 | **Hoang** ([@6namdang](https://github.com/6namdang)) | **70** | 7 | 9 | 1 |
| 🥉 | **Ilan Barts** ([@absol761](https://github.com/absol761)) | **70** | 9 | 0 | 0 |
| #4 | **Griffin Consigli** ([@gconsigli](https://github.com/gconsigli)) | **54** | 4 | 1 | 27 |
| #5 | **Pranava Kumar** ([@PranavaKCode](https://github.com/PranavaKCode)) | **48** | 71 | 2 | 0 |
| #6 | **Arun Vinayagam** ([@Arun-V18](https://github.com/Arun-V18)) | **41** | 4 | 0 | 0 |
| #7 | Name not found ([@alexandragreenwood](https://github.com/alexandragreenwood)) | **41** | 2 | 0 | 6 |
| #8 | Name not found ([@VishwanathanV](https://github.com/VishwanathanV)) | **40** | 3 | 0 | 0 |
| #9 | **Sebastien Kawada** ([@chreia](https://github.com/chreia)) | **40** | 33 | 0 | 7 |
| #10 | Name not found ([@Cruz-Arnzen](https://github.com/Cruz-Arnzen)) | **38** | 3 | 0 | 1 |

#### Past 14 Days

| Rank | Contributor | Points | PRs | Reviews | Issues |
| :--: | :---------- | -----: | --: | ------: | -----: |
| 🥇 | **Pranava Kumar** ([@PranavaKCode](https://github.com/PranavaKCode)) | **151** | 97 | 2 | 5 |
| 🥈 | **Hoang** ([@6namdang](https://github.com/6namdang)) | **116** | 13 | 12 | 2 |
| 🥉 | **Yakshith** ([@YakshithK](https://github.com/YakshithK)) | **109** | 8 | 0 | 19 |
| #4 | **Sebastien Kawada** ([@chreia](https://github.com/chreia)) | **104** | 78 | 0 | 8 |
| #5 | **Rohan Vaidya** ([@rohan-va](https://github.com/rohan-va)) | **99** | 10 | 3 | 4 |
| #6 | Name not found ([@charleywolf](https://github.com/charleywolf)) | **86** | 8 | 0 | 11 |
| #7 | **Ilan Barts** ([@absol761](https://github.com/absol761)) | **82** | 10 | 0 | 0 |
| #8 | Name not found ([@alexandragreenwood](https://github.com/alexandragreenwood)) | **78** | 4 | 0 | 7 |
| #9 | **Arjun Kulkarni** ([@DemonizedCrush](https://github.com/DemonizedCrush)) | **78** | 3 | 19 | 1 |
| #10 | **Griffin Consigli** ([@gconsigli](https://github.com/gconsigli)) | **62** | 4 | 3 | 27 |

_Last updated: Fri, 14 Aug 2026 21:58:18 GMT_
<!-- LEADERBOARD:END -->

## Setup

**1. Create a read-only token.**
GitHub → Settings → Developer settings → Fine-grained tokens → New token.

- Resource owner: the org
- Repository access: **All repositories** in the org if you want new Mantis
  repos to show up automatically (`repo_discovery` in
  [`config/rules.yml`](config/rules.yml)). Otherwise pick exactly the repos
  listed under `repos:` — if a repo isn't visible to the token, the job
  **fails** rather than silently reporting zero activity.
- Permissions, set only these to Read, everything else No access:
  Contents, Pull requests, Issues, Metadata (auto-required).

Zero write permissions means this thing is physically incapable of changing
anything else, even if there's a bug in it somewhere.

**2. Add it as a secret.**
Repo → Settings → Secrets and variables → Actions → New repository secret →
name it `ORG_READ_TOKEN`, paste the token.

**3. Run it.**
Actions tab → "Update Leaderboard" → Run workflow (choose **full** the first time). After that it lists GitHub every 30 minutes, does a full audit once a day, and can also wake on a webhook (below).

**Where results show up:** there's no GitHub Pages site here — Pages needs a
paid plan for private repos. Instead every run commits the refreshed numbers
straight into the repo:

- this README's table above, updates itself
- `site/index.html` — pull the repo and open it in a browser
- `data/leaderboard.json` — scored snapshot
- `data/store/` — the event log (every PR, review, inline comment, and issue). This is the database. Scores are recomputed from it each run.

**Running it locally:**

```bash
npm install
npm test
GH_TOKEN=your_token SYNC_MODE=full npm run build
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

It reads the `data/leaderboard.json` the refresh already keeps current, so this
job never needs `ORG_READ_TOKEN` — it can only read this repo's own committed
file and POST to the one webhook URL you gave it.

## Near-real-time GitHub webhook (optional)

The 30-minute poll is the backbone. To refresh within a minute of a merge or
review, add an **organization webhook** (or one webhook per tracked repo):

1. GitHub org → Settings → Webhooks → Add webhook.
2. Payload URL: `https://<your-vercel>/api/github-webhook`
3. Content type: `application/json`
4. Secret: generate one, save it as Vercel env `GITHUB_WEBHOOK_SECRET`.
5. Events: Pull requests, Pull request reviews, Pull request review comments, Issues.

Also set on Vercel:

- `LEADERBOARD_DISPATCH_TOKEN` — a PAT that can dispatch workflows on **this**
  leaderboard repo only (`actions: write`). Do **not** reuse `ORG_READ_TOKEN`.
- `LEADERBOARD_REPO` — `owner/Mantis-Leaderboard`

The endpoint verifies the HMAC, ignores uninteresting events, skips the
dispatch if a leaderboard run is already in progress, and never writes to
Mantis codebases.

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
  ending today — this is what ranks people. The **PRs / Reviews / Issues
  columns are raw activity counts** (no daily cap). Points still cap.
- The **stat tiles on `site/index.html`** ("PRs merged", "Reviews", "Issues")
  are a wider, *unranked* count over the full `lookback_days` window
  (currently 365 days) — not all-time. Anything older than `lookback_days`
  was never fetched. The event log in `data/store/` is the replayable source;
  GitHub Search is only used as a checksum of totals (it still cannot
  *return* more than 1,000 hits per query, which is why we no longer list
  via Search).

**"What counts as a review?"** A review is **counted** if you submitted a
finished review (Approved / Changes requested / Commented / Dismissed) or left
inline comments on someone else's PR — including open and unmerged PRs. It
**scores** if *all* of these hold:
1. State is **Approved**, **Changes requested**, or **Commented** (or
   inline-only comments treated as Commented). Dismissed and Pending never
   score. Inline comments are fetched separately and add to body length, so
   a short “lgtm” plus a real line comment can still score.
2. Body length: ≥ `reviews.min_body_length` (20) for Approve / Request
   changes, ≥ `reviews.commented_min_body_length` (40) for Commented
   (review body + inline comments).
3. You didn't review your own PR (`exclude_self_review: true`).
4. One credit per (reviewer, PR): the **highest-value** review type wins
   (comment then approve pays 8, not 6). Follow-up rounds on the same PR
   do not stack. Intentional anti-spam.
5. Reviews are scored even if the PR targets a branch outside
   `pull_requests.count_merges_to` — reviewing that work still counts,
   even though the author gets no merge points for it.
6. Review points also hard-cap at `reviews.max_points_per_day` (20).

**"What counts as a merged PR?"** The **PRs column** counts every PR GitHub
reports as merged (`mergedAt` set), any target branch, authored by you.
**Points** only for merges into `pull_requests.count_merges_to` branches
(currently `main`/`master`). Unreviewed merges (no scoring peer review, including
inline comments) pay `unreviewed_multiplier` (0.5). PR *points* then hard-cap at
`max_points_per_day` (36) per person per UTC day — counts still show all
the merges. Co-authors are stored and counted separately; they do not take
the author's merge.

All of this lives in [`config/rules.yml`](config/rules.yml). Point values
and caps change without code; new *kinds* of events (e.g. commented
reviews, a PR daily cap) needed a scorer change once and are now
config-driven. Scores recompute from the event log on the next `npm run build`.
