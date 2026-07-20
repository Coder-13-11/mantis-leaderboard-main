// -----------------------------------------------------------------------------
// render.mjs — Turn scored users into (1) a JSON snapshot, (2) a static HTML
// page for GitHub Pages, and (3) a Markdown table for the README.
// All outputs are written INSIDE this repo only.
// -----------------------------------------------------------------------------

function medal(rank) {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
}

export function renderJson(users, meta) {
  return JSON.stringify(
    { generated_at: new Date().toISOString(), ...meta, leaderboard: users },
    null,
    2
  );
}

export function renderReadmeTable(users, topN) {
  const rows = users
    .slice(0, topN)
    .map(
      (u) =>
        `| ${medal(u.rank)} | [@${u.login}](https://github.com/${u.login}) | **${u.rolling_total}** | ${u.counts.prs} | ${u.counts.reviews} | ${u.counts.confirmed_issues} |`
    )
    .join("\n");

  return [
    "<!-- LEADERBOARD:START -->",
    "| Rank | Contributor | Points | PRs | Reviews | Issues |",
    "| :--: | :---------- | -----: | --: | ------: | -----: |",
    rows,
    "",
    `_Last updated: ${new Date().toUTCString()}_`,
    "<!-- LEADERBOARD:END -->",
  ].join("\n");
}

export function renderHtml(users, meta) {
  const rows = users
    .map(
      (u) => `
      <tr>
        <td class="rank">${medal(u.rank)}</td>
        <td class="user">
          <img src="https://github.com/${u.login}.png?size=40" alt="" width="28" height="28" loading="lazy"/>
          <a href="https://github.com/${u.login}">@${u.login}</a>
        </td>
        <td class="pts">${u.rolling_total}</td>
        <td>${u.counts.prs}</td>
        <td>${u.counts.reviews}</td>
        <td>${u.counts.confirmed_issues}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Mantis Contributor Leaderboard</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
         max-width: 820px; margin: 2rem auto; padding: 0 1rem; }
  h1 { display:flex; align-items:center; gap:.5rem; }
  .sub { opacity:.7; margin-top:-.5rem; }
  table { width:100%; border-collapse: collapse; margin-top:1.5rem; }
  th, td { padding:.6rem .5rem; text-align:right; border-bottom:1px solid #8883; }
  th:nth-child(2), td.user { text-align:left; }
  td.rank { font-size:1.1rem; text-align:center; }
  td.user { display:flex; align-items:center; gap:.5rem; }
  td.user img { border-radius:50%; }
  td.pts { font-weight:700; }
  tr:nth-child(-n+3) td.pts { color:#2da44e; }
  a { text-decoration:none; }
  footer { margin-top:2rem; font-size:.85rem; opacity:.6; }
</style>
</head>
<body>
  <h1>🏆 Mantis Contributor Leaderboard</h1>
  <p class="sub">${meta.repos.length} repos · trailing ${meta.rolling_weeks} weeks · ${users.length} contributors</p>
  <table>
    <thead>
      <tr><th>Rank</th><th>Contributor</th><th>Points</th><th>PRs</th><th>Reviews</th><th>Issues</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <footer>Generated ${new Date().toUTCString()} · rules v${meta.rules_version} · read-only, org activity only.</footer>
</body>
</html>`;
}
