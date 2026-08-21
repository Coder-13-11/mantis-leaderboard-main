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
| 1 | **Rohan Vaidya** ([@rohan-va](https://github.com/rohan-va)) | **133** | 8 | 8 | 3 |
| 2 | **Arun Vinayagam** ([@Arun-V18](https://github.com/Arun-V18)) | **114** | 10 | 3 | 0 |
| 3 | **Yakshith** ([@YakshithK](https://github.com/YakshithK)) | **104** | 11 | 0 | 2 |
| 4 | **Adhiban Arulselvan** ([@ark248](https://github.com/ark248)) | **95** | 12 | 0 | 1 |
| 5 | [@charleywolf](https://github.com/charleywolf) | **79** | 6 | 0 | 0 |
| 6 | **Pranava Kumar** ([@PranavaKCode](https://github.com/PranavaKCode)) | **78** | 10 | 0 | 0 |
| 7 | **Ilan Barts** ([@absol761](https://github.com/absol761)) | **78** | 6 | 1 | 2 |
| 8 | [@VishwanathanV](https://github.com/VishwanathanV) | **61** | 4 | 7 | 0 |
| 9 | [@alexandragreenwood](https://github.com/alexandragreenwood) | **55** | 5 | 1 | 5 |
| 10 | **Hoang** ([@6namdang](https://github.com/6namdang)) | **44** | 4 | 6 | 0 |

#### Past 14 Days

| Rank | Contributor | Points | PRs | Reviews | Issues |
| :--: | :---------- | -----: | --: | ------: | -----: |
| 1 | **Pranava Kumar** ([@PranavaKCode](https://github.com/PranavaKCode)) | **387** | 82 | 2 | 1 |
| 2 | **Rohan Vaidya** ([@rohan-va](https://github.com/rohan-va)) | **220** | 16 | 10 | 5 |
| 3 | **Sebastien Kawada** ([@chreia](https://github.com/chreia)) | **186** | 34 | 0 | 23 |
| 4 | **Yakshith** ([@YakshithK](https://github.com/YakshithK)) | **170** | 16 | 0 | 15 |
| 5 | **Ilan Barts** ([@absol761](https://github.com/absol761)) | **150** | 14 | 1 | 2 |
| 6 | **Hoang** ([@6namdang](https://github.com/6namdang)) | **141** | 15 | 15 | 1 |
| 7 | **Arun Vinayagam** ([@Arun-V18](https://github.com/Arun-V18)) | **140** | 12 | 3 | 0 |
| 8 | [@charleywolf](https://github.com/charleywolf) | **139** | 11 | 0 | 10 |
| 9 | **Adhiban Arulselvan** ([@ark248](https://github.com/ark248)) | **108** | 13 | 1 | 1 |
| 10 | [@VishwanathanV](https://github.com/VishwanathanV) | **100** | 7 | 7 | 0 |

_Last updated: Fri, 21 Aug 2026 13:57:06 GMT_
<!-- LEADERBOARD:END -->


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
