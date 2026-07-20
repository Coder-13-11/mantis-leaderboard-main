# 🏆 Mantis Leaderboard

An automated, **read-only** contributor leaderboard for the Mantis repos
(listed in [`config/rules.yml`](config/rules.yml)). It observes merged PRs,
substantive reviews, and confirmed issues and turns them into points — with
no effect on any other repo.

- **Isolated:** lives entirely in this repo; uses a read-only token scoped
  to just the Mantis repos.
- **Config-driven:** all points and the tracked repo list live in
  [`config/rules.yml`](config/rules.yml).
- **Zero-ops:** a scheduled GitHub Action recomputes and publishes it.
- **Anti-gaming built in:** PR size excludes generated files, reviews must be
  substantive, and issues only score when a maintainer labels them.
- **Active, not lifetime:** ranked by points earned in the trailing 4 weeks,
  so it reflects who's contributing *now*.

See [SETUP.md](SETUP.md) to get it running.

## Live leaderboard

<!-- LEADERBOARD:START -->
_The table here is populated automatically on the first run._
<!-- LEADERBOARD:END -->

## How scoring works

| Contribution | Points | Notes |
| ------------ | ------ | ----- |
| Merged PR | 5 / 15 / 40 / 80 / 120 | XS / S / M / L / XL by meaningful lines changed |
| Doc PR | ×1.25 | PR labeled `documentation` |
| First PR | ×1.5 | contributor's first merged PR |
| Approved review | 20 | must have a real body (anti-spam) |
| Changes requested | 15 | must have a real body |
| Confirmed issue | 8 | only when a maintainer labels it `confirmed` |
| Confirmed issue fixed | +25 | bonus to reporter when it's closed |

Edit the values in [`config/rules.yml`](config/rules.yml) to change any of this.
