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
| Rank | Contributor | Points | PRs | Reviews | Issues |
| :--: | :---------- | -----: | --: | ------: | -----: |
| 🥇 | [@chreia](https://github.com/chreia) | **5120** | 82 | 0 | 0 |
| 🥈 | [@MantisCartography](https://github.com/MantisCartography) | **2625** | 140 | 153 | 0 |
| 🥉 | [@ppxscal](https://github.com/ppxscal) | **2250** | 90 | 6 | 0 |
| #4 | [@AnasMaar](https://github.com/AnasMaar) | **1170** | 164 | 22 | 0 |
| #5 | [@vinays6](https://github.com/vinays6) | **585** | 29 | 15 | 0 |
| #6 | [@LucaVor](https://github.com/LucaVor) | **505** | 107 | 6 | 0 |
| #7 | [@charleywolf](https://github.com/charleywolf) | **375** | 30 | 3 | 0 |
| #8 | [@alex-d4v](https://github.com/alex-d4v) | **335** | 37 | 6 | 0 |
| #9 | [@varvarakarenski](https://github.com/varvarakarenski) | **300** | 2 | 0 | 0 |
| #10 | [@ThomasdeChillaz](https://github.com/ThomasdeChillaz) | **300** | 2 | 0 | 0 |

_Last updated: Tue, 21 Jul 2026 01:45:11 GMT_
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
