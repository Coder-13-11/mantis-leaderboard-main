// -----------------------------------------------------------------------------
// render.mjs — Turn scored users into (1) a JSON snapshot, (2) a static HTML
// page, and (3) a Markdown table for the README.
// All outputs are written INSIDE this repo only.
// -----------------------------------------------------------------------------

function medal(rank) {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
}

function windowLabel(days) {
  return `Past ${days} Days`;
}

// `users` is already ranked by the primary (first) window. For every other
// window, re-sort a copy by that window's points instead.
function rankedFor(users, days, primaryDays) {
  return days === primaryDays
    ? users
    : [...users].sort((a, b) => (b.windows[days] || 0) - (a.windows[days] || 0));
}

export function renderJson(users, meta) {
  return JSON.stringify(
    { generated_at: new Date().toISOString(), ...meta, leaderboard: users },
    null,
    2
  );
}

export function renderReadmeTable(users, topN, windowsDays) {
  const primary = windowsDays[0];
  const sections = windowsDays.map((days) => {
    const ranked = rankedFor(users, days, primary);
    const rows = ranked
      .slice(0, topN)
      .map(
        (u, idx) =>
          `| ${medal(idx + 1)} | [@${u.login}](https://github.com/${u.login}) | **${u.windows[days] || 0}** | ${u.counts.prs} | ${u.counts.reviews} | ${u.counts.confirmed_issues} |`
      )
      .join("\n");
    return [
      `#### ${windowLabel(days)}`,
      "",
      "| Rank | Contributor | Points | PRs | Reviews | Issues |",
      "| :--: | :---------- | -----: | --: | ------: | -----: |",
      rows,
    ].join("\n");
  });

  return [
    "<!-- LEADERBOARD:START -->",
    sections.join("\n\n"),
    "",
    `_Last updated: ${new Date().toUTCString()}_`,
    "<!-- LEADERBOARD:END -->",
  ].join("\n");
}

function rows(ranked, days, topScore) {
  return ranked
    .map((u, idx) => {
      const rank = idx + 1;
      const pts = u.windows[days] || 0;
      const share = topScore ? Math.max(4, Math.round((pts / topScore) * 100)) : 0;
      return `
        <li class="row ${rank <= 3 ? `top top-${rank}` : ""}">
          <span class="rank">${medal(rank)}</span>
          <img class="avatar" src="https://github.com/${u.login}.png?size=64" alt="" loading="lazy"/>
          <span class="who">
            <a class="handle" href="https://github.com/${u.login}">@${u.login}</a>
            <span class="meta">${u.counts.prs} PRs · ${u.counts.reviews} reviews · ${u.counts.confirmed_issues} issues</span>
            <span class="bar"><span class="fill" style="width:${share}%"></span></span>
          </span>
          <span class="pts">${pts}</span>
        </li>`;
    })
    .join("");
}

export function renderHtml(users, meta) {
  const windowsDays = meta.windows_days || [7, 14];
  const primary = windowsDays[0];

  const panels = windowsDays.map((days, i) => {
    const ranked = rankedFor(users, days, primary);
    const topScore = ranked[0]?.windows[days] || 0;
    return { days, id: `w${days}`, first: i === 0, ranked, topScore };
  });

  const tabInputs = panels
    .map((p) => `<input type="radio" name="window" id="tab-${p.id}" ${p.first ? "checked" : ""}/>`)
    .join("");
  const tabLabels = panels
    .map((p) => `<label for="tab-${p.id}">${windowLabel(p.days)}</label>`)
    .join("");
  const boards = panels
    .map((p) => `<ul class="board" data-for="tab-${p.id}">${rows(p.ranked, p.days, p.topScore)}</ul>`)
    .join("");
  const boardVisibility = panels
    .map((p) => `#tab-${p.id}:checked ~ .boards .board[data-for="tab-${p.id}"] { display: flex; }`)
    .join("\n    ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Mantis Contributor Leaderboard</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f3f4f8;
    --card: #ffffff;
    --border: #e4e6ef;
    --text: #16181d;
    --muted: #6b7280;
    --accent: #6366f1;
    --accent-soft: #eef0ff;
    --gold: #f5c518;
    --silver: #c0c5ce;
    --bronze: #cd8b52;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0e1016;
      --card: #171922;
      --border: #262a36;
      --text: #f1f2f6;
      --muted: #9aa0ac;
      --accent-soft: #22243a;
    }
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    margin: 0;
    padding: 2.5rem 1rem;
  }
  .card {
    max-width: 720px;
    margin: 0 auto;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 1.75rem;
    box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 12px 28px rgba(0,0,0,.06);
  }
  h1 {
    display: flex;
    align-items: center;
    gap: .5rem;
    margin: 0 0 .25rem;
    font-size: 1.5rem;
  }
  .sub { color: var(--muted); margin: 0 0 1.5rem; font-size: .9rem; }
  .tabs { display: flex; gap: .4rem; margin-bottom: 1.25rem; }
  input[type="radio"][name="window"] { position: absolute; opacity: 0; pointer-events: none; }
  .tabs label {
    cursor: pointer;
    padding: .4rem .9rem;
    border-radius: 999px;
    font-size: .85rem;
    font-weight: 600;
    color: var(--muted);
    background: var(--accent-soft);
    border: 1px solid transparent;
    transition: color .15s ease, background .15s ease;
  }
  ${panels.map((p) => `#tab-${p.id}:checked ~ .tabs label[for="tab-${p.id}"]`).join(", ")} {
    color: #fff;
    background: var(--accent);
  }
  .boards .board { display: none; flex-direction: column; gap: .5rem; list-style: none; margin: 0; padding: 0; }
  ${boardVisibility}
  .row {
    display: grid;
    grid-template-columns: 2rem 2.25rem 1fr auto;
    align-items: center;
    gap: .75rem;
    padding: .6rem .6rem;
    border-radius: 10px;
    transition: background .15s ease;
  }
  .row:hover { background: var(--accent-soft); }
  .row.top-1 { background: linear-gradient(90deg, var(--accent-soft), transparent); }
  .rank { text-align: center; font-size: 1.05rem; }
  .avatar { width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--border); }
  .who { display: flex; flex-direction: column; gap: .2rem; min-width: 0; }
  .handle { color: var(--text); font-weight: 600; text-decoration: none; }
  .handle:hover { text-decoration: underline; }
  .meta { color: var(--muted); font-size: .78rem; }
  .bar { display: block; height: 4px; border-radius: 999px; background: var(--border); overflow: hidden; margin-top: .15rem; }
  .bar .fill { display: block; height: 100%; background: var(--accent); border-radius: 999px; }
  .pts { font-weight: 800; font-size: 1.05rem; text-align: right; white-space: nowrap; }
  .top-1 .pts { color: var(--gold); }
  .top-2 .pts { color: var(--silver); }
  .top-3 .pts { color: var(--bronze); }
  footer { margin-top: 1.75rem; font-size: .78rem; color: var(--muted); text-align: center; }
</style>
</head>
<body>
  <div class="card">
    <h1>🏆 Mantis Contributor Leaderboard</h1>
    <p class="sub">${meta.repos.length} repos · ${users.length} contributors · updated ${new Date().toUTCString()}</p>

    ${tabInputs}
    <div class="tabs">${tabLabels}</div>
    <div class="boards">${boards}</div>

    <footer>rules v${meta.rules_version} · read-only, GitHub activity only · no JS, this page works with scripts off</footer>
  </div>
</body>
</html>`;
}
