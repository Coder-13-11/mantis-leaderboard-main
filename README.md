# Mantis Leaderboard

A leaderboard that tracks who's actively contributing to the Mantis repos —
merged PRs, real code reviews, confirmed bugs. It only reads GitHub, never
writes anything back except to this repo, and it can't touch the actual
Mantis codebases.

It's ranked by points earned in a rolling 7-day window (with a 14-day view
alongside it), not lifetime totals, so it's about who's active *now*, not
who has the biggest all-time score. Click anyone on the site for a
code / review / issues ledger.

## Live leaderboard

<!-- LEADERBOARD:START -->
#### Past 7 Days

| Rank | Contributor | Points | PRs | Reviews | Issues |
| :--: | :---------- | -----: | --: | ------: | -----: |
| 🥇 | **Hoang** ([@6namdang](https://github.com/6namdang)) | **86** | 7 | 9 | 1 |
| 🥈 | **Yakshith** ([@YakshithK](https://github.com/YakshithK)) | **81** | 6 | 0 | 11 |
| 🥉 | Name not found ([@alexandragreenwood](https://github.com/alexandragreenwood)) | **74** | 6 | 0 | 6 |
| #4 | **Rohan Vaidya** ([@rohan-va](https://github.com/rohan-va)) | **67** | 5 | 2 | 3 |
| #5 | **Ilan Barts** ([@absol761](https://github.com/absol761)) | **58** | 6 | 0 | 1 |
| #6 | **Arun Vinayagam** ([@Arun-V18](https://github.com/Arun-V18)) | **54** | 4 | 0 | 0 |
| #7 | Name not found ([@SufianTA](https://github.com/SufianTA)) | **49** | 5 | 0 | 0 |
| #8 | **Griffin Consigli** ([@gconsigli](https://github.com/gconsigli)) | **48** | 4 | 1 | 23 |
| #9 | Name not found ([@charleywolf](https://github.com/charleywolf)) | **48** | 4 | 0 | 0 |
| #10 | Name not found ([@VishwanathanV](https://github.com/VishwanathanV)) | **39** | 3 | 0 | 0 |

#### Past 14 Days

| Rank | Contributor | Points | PRs | Reviews | Issues |
| :--: | :---------- | -----: | --: | ------: | -----: |
| 🥇 | **Pranava Kumar** ([@PranavaKCode](https://github.com/PranavaKCode)) | **467** | 97 | 2 | 5 |
| 🥈 | **Sebastien Kawada** ([@chreia](https://github.com/chreia)) | **409** | 78 | 0 | 8 |
| 🥉 | **Rohan Vaidya** ([@rohan-va](https://github.com/rohan-va)) | **150** | 12 | 3 | 5 |
| #4 | **Hoang** ([@6namdang](https://github.com/6namdang)) | **149** | 13 | 12 | 2 |
| #5 | **Ilan Barts** ([@absol761](https://github.com/absol761)) | **110** | 11 | 0 | 1 |
| #6 | Name not found ([@charleywolf](https://github.com/charleywolf)) | **104** | 8 | 0 | 11 |
| #7 | Name not found ([@alexandragreenwood](https://github.com/alexandragreenwood)) | **102** | 8 | 0 | 7 |
| #8 | **Taksh Kothari** ([@Chessing234](https://github.com/Chessing234)) | **95** | 14 | 0 | 3 |
| #9 | **Yakshith** ([@YakshithK](https://github.com/YakshithK)) | **85** | 6 | 0 | 19 |
| #10 | Name not found ([@Copilot](https://github.com/Copilot)) | **84** | 0 | 10 | 0 |

_Last updated: Sun, 16 Aug 2026 03:10:32 GMT_
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

The unit of value is a **contribution**, not a calendar day. Extra PRs the
same day still count — they just count a bit less, so a 70-PR burst cannot
look like a month of work, and a 7-PR day is still worth more than a 2-PR
day. Shipping, reviewing, and finding bugs are different jobs: they share
one overall score, and each has its own board on `site/index.html`. Open
any person to see the ledger.

| Contribution | Points | Notes |
| ------------ | ------ | ----- |
| Merged PR | 10–14 | small saturating size bonus (at most +4). High-impact label ×1.5. Bug-fix label +4 |
| Docs PR | same 10–14 | classified separately, not a flat +25% |
| Extra PRs in 24h | ×100 / 100 / 80 / 65 / 50 / 35% | 1st…6th+. Rolling 24 hours, **no hard cap** |
| Commented / approved / changes requested | 4 / 6 / 8 | outcome, not character count. +3 inline, +2 nontrivial PR, +4 if requested changes later merge |
| Issue opened | 1 | Scored, with steeper 24h decay than PRs so volume cannot dominate |
| Issue closed | 0 | Closing a ticket is not the work — too easy to farm |
| Bug report | 6 | `bug` / `defect` label |
| Confirmed / high-impact issue | 10 / 16 | Maintainer `confirmed` or `priority`/`impact` label |
| `difficulty: 1…6` | 3–36 | Replaces the file points when labeled |
| First PR / review / bug | badge | not a point multiplier |

**Anti-gaming:** diminishing returns on PRs and reviews in a rolling 24-hour
window. Issues decay faster: 27 chores cannot overtake a merged PR. Closing
a ticket scores nothing. Tunable in [`config/rules.yml`](config/rules.yml).

### Exactly what counts (the questions people actually ask)

**"Is this the total?"** No single number on this page is an unqualified
lifetime total:
- The **"Past 7 Days" / "Past 14 Days" tables** above are rolling windows
  ending now — this is what ranks people. **PRs / Reviews / Issues are raw
  activity counts.** Issue *points* come from opening work (bugs score more);
  closing a ticket does not.
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
   score. A short body still scores when there is a substantive inline
   comment — character count is a gate, not the quality signal.
2. Quality bonuses (additive): at least one inline comment, reviewing a
   nontrivial PR, and **Changes requested** on a PR that later merged
   (the change was addressed).
3. You didn't review your own PR (`exclude_self_review: true`).
4. One credit per (reviewer, PR): the **highest-value** review type wins.
   Follow-up rounds on the same PR do not stack.
5. Reviews are scored even if the PR targets a branch outside
   `pull_requests.count_merges_to` — reviewing that work still counts,
   even though the author gets no merge points for it.
6. Same rolling 24h diminishing curve as PRs. Authors are **not** penalized
   when nobody reviews their PR; the reviewer is rewarded instead.

**"What counts as a merged PR?"** Every PR GitHub reports as merged
(`mergedAt` set), any target branch, authored by you, is **counted**.
**Points** only for merges into `pull_requests.count_merges_to` branches
(currently `main`/`master`). Size is a small bonus, not the definition of
value. Docs-only PRs go to the docs line, not code shipping. Co-authors are
stored and counted separately; they do not take the author's merge.

All of this lives in [`config/rules.yml`](config/rules.yml). Point values
and diminishing tables change without code. Scores recompute from the event
log on the next `npm run build`.
