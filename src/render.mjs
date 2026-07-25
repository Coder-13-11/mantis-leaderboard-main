// -----------------------------------------------------------------------------
// render.mjs — Turn scored users into (1) a JSON snapshot, (2) a static HTML
// dashboard, and (3) a Markdown table for the README.
// All outputs are written INSIDE this repo only. The dashboard uses no
// JavaScript — window switching is a pure-CSS radio-tab trick — so it renders
// identically with scripts off and can't break.
// -----------------------------------------------------------------------------

const SITE_MAX = 15; // contributors shown on the dashboard (podium + list)

function medal(rank) {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
}

function windowLabel(days) {
  return `Past ${days} Days`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

// `users` is already ranked by the primary (first) window. For every other
// window, re-sort a copy by that window's points instead.
function rankedFor(users, days, primaryDays) {
  return days === primaryDays
    ? users
    : [...users].sort((a, b) => (b.windows[days] || 0) - (a.windows[days] || 0));
}

// The last `n` calendar-day keys ("2026-07-21"), oldest first.
function lastDayKeys(n) {
  const keys = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    keys.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return keys;
}

// -----------------------------------------------------------------------------
// JSON + README (unchanged data contract)
// -----------------------------------------------------------------------------
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
      .map((u, idx) => {
        const c = u.windowCounts?.[days] || {};
        return `| ${medal(idx + 1)} | [@${u.login}](https://github.com/${u.login}) | **${u.windows[days] || 0}** | ${c.prs || 0} | ${c.reviews || 0} | ${c.confirmed_issues || 0} |`;
      })
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

// -----------------------------------------------------------------------------
// Dashboard pieces
// -----------------------------------------------------------------------------

// Thin stacked bar showing how a contributor's points split across categories.
function breakdownBar(breakdown) {
  const parts = [
    ["pr", breakdown.pr || 0],
    ["review", breakdown.review || 0],
    ["issue", breakdown.issue || 0],
    ["other", breakdown.other || 0],
  ];
  const sum = parts.reduce((a, [, v]) => a + v, 0);
  if (!sum) return `<span class="split"></span>`;
  const segs = parts
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `<span class="seg seg-${k}" style="flex:${v}"></span>`)
    .join("");
  return `<span class="split">${segs}</span>`;
}

// Inline SVG sparkline of daily points over the trailing window.
function sparkline(daysMap, dayKeys) {
  const vals = dayKeys.map((d) => daysMap?.[d] || 0);
  const max = Math.max(1, ...vals);
  const w = 96;
  const h = 28;
  const pad = 3;
  const step = vals.length > 1 ? (w - 2 * pad) / (vals.length - 1) : 0;
  const pts = vals.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - (v / max) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(" ");
  const area = `${pad},${h - pad} ${line} ${(pad + (vals.length - 1) * step).toFixed(1)},${h - pad}`;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <polygon class="spark-area" points="${area}"/>
      <polyline class="spark-line" points="${line}"/>
    </svg>`;
}

function podiumCard(u, days, place) {
  const pts = u.windows?.[days] || 0;
  const c = u.windowCounts?.[days] || {};
  return `
    <div class="pod pod-${place}">
      <div class="pod-badge">${medal(place)}</div>
      <img class="pod-avatar" src="https://github.com/${esc(u.login)}.png?size=120" alt="" loading="lazy"/>
      <a class="pod-handle" href="https://github.com/${esc(u.login)}">${esc(u.login)}</a>
      <div class="pod-pts">${pts}<span>pts</span></div>
      <div class="pod-meta">${c.prs || 0} PRs · ${c.reviews || 0} reviews</div>
    </div>`;
}

function podium(ranked, days) {
  const [first, second, third] = ranked;
  const cards = [];
  if (second) cards.push(podiumCard(second, days, 2));
  if (first) cards.push(podiumCard(first, days, 1));
  if (third) cards.push(podiumCard(third, days, 3));
  return `<div class="podium">${cards.join("")}</div>`;
}

function listRows(ranked, days, dayKeys) {
  return ranked
    .slice(3, SITE_MAX)
    .map((u, i) => {
      const rank = i + 4;
      const pts = u.windows?.[days] || 0;
      const c = u.windowCounts?.[days] || {};
      return `
        <li class="row">
          <span class="rank">${rank}</span>
          <img class="avatar" src="https://github.com/${esc(u.login)}.png?size=48" alt="" loading="lazy"/>
          <span class="who">
            <a class="handle" href="https://github.com/${esc(u.login)}">${esc(u.login)}</a>
            <span class="meta">${c.prs || 0} PRs · ${c.reviews || 0} reviews · ${c.confirmed_issues || 0} issues${c.manual ? ` · ${c.manual} community` : ""}</span>
            ${breakdownBar(u.breakdown)}
          </span>
          <span class="sparkwrap">${sparkline(u.days, dayKeys)}</span>
          <span class="pts">${pts}</span>
        </li>`;
    })
    .join("");
}

function statTile(value, label) {
  return `<div class="tile"><div class="tile-num">${value}</div><div class="tile-lbl">${label}</div></div>`;
}

function highlightsSection(users, categories) {
  const items = [];
  for (const u of users) {
    for (const c of u.contributions || []) {
      items.push({ login: u.login, ...c });
    }
  }
  if (!items.length) return "";
  items.sort((a, b) => (a.date < b.date ? 1 : -1));
  const cards = items
    .slice(0, 6)
    .map((c) => {
      const cat = categories?.[c.type] || {};
      const badge = `${cat.emoji || "⭐"} ${esc(cat.label || c.type || "Other")}`;
      const src = c.source
        ? `<a class="hl-src" href="${esc(c.source)}">view →</a>`
        : "";
      return `
        <div class="hl">
          <img class="hl-avatar" src="https://github.com/${esc(c.login)}.png?size=48" alt="" loading="lazy"/>
          <div class="hl-body">
            <div class="hl-top"><a class="handle" href="https://github.com/${esc(c.login)}">${esc(c.login)}</a><span class="hl-badge">${badge}</span></div>
            <div class="hl-desc">${esc(c.description) || "Community contribution"}</div>
          </div>
          <div class="hl-pts">+${c.points}${src}</div>
        </div>`;
    })
    .join("");
  return `
    <section class="highlights">
      <h2>Community Highlights <span class="h2-sub">off-GitHub contributions</span></h2>
      <div class="hl-grid">${cards}</div>
    </section>`;
}

// -----------------------------------------------------------------------------
// Dashboard
// -----------------------------------------------------------------------------
export function renderHtml(users, meta) {
  const windowsDays = meta.windows_days || [7, 14];
  const primary = windowsDays[0];
  const dayKeys = lastDayKeys(Math.max(...windowsDays));

  const totalPRs = users.reduce((a, u) => a + u.counts.prs, 0);
  const totalReviews = users.reduce((a, u) => a + u.counts.reviews, 0);
  const totalIssues = users.reduce((a, u) => a + u.counts.confirmed_issues, 0);
  const totalManual = users.reduce((a, u) => a + (u.counts.manual || 0), 0);

  const panels = windowsDays.map((days, i) => {
    const ranked = rankedFor(users, days, primary);
    return { days, id: `w${days}`, first: i === 0, ranked };
  });

  const tabInputs = panels
    .map((p) => `<input type="radio" name="window" id="tab-${p.id}" ${p.first ? "checked" : ""}/>`)
    .join("");
  const tabLabels = panels
    .map((p) => `<label for="tab-${p.id}">${windowLabel(p.days)}</label>`)
    .join("");
  const boards = panels
    .map(
      (p) => `<section class="panel" data-for="tab-${p.id}">
        ${podium(p.ranked, p.days)}
        <ol class="board">${listRows(p.ranked, p.days, dayKeys)}</ol>
        ${p.ranked.length > SITE_MAX ? `<p class="more">…and ${p.ranked.length - SITE_MAX} more contributors</p>` : ""}
      </section>`
    )
    .join("");
  const boardVisibility = panels
    .map((p) => `#tab-${p.id}:checked ~ .boards .panel[data-for="tab-${p.id}"] { display: block; }`)
    .join("\n    ");
  const activeTab = panels
    .map((p) => `#tab-${p.id}:checked ~ .tabs label[for="tab-${p.id}"]`)
    .join(", ");

  const updated = new Date().toUTCString().replace("GMT", "UTC");
  const tiles = [
    statTile(users.length, "Contributors"),
    statTile(totalPRs.toLocaleString(), "PRs merged"),
    statTile(totalReviews.toLocaleString(), "Reviews"),
    totalManual
      ? statTile(totalManual.toLocaleString(), "Community credits")
      : statTile(totalIssues.toLocaleString(), "Issues logged"),
  ].join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Mantis · Contributor Leaderboard</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#0e1442"/><path d="M18 74 40 30 50 46 60 30 82 74" stroke="url(%23g)" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/><defs><linearGradient id="g" x1="0" y1="0" x2="100" y2="0"><stop offset="0" stop-color="%234f7cf0"/><stop offset="1" stop-color="%238b5cf6"/></linearGradient></defs></svg>'
  )}"/>
<style>
  :root {
    color-scheme: light dark;
    /* Palette lifted from the Mantis wordmark: deep navy -> indigo -> purple -> sky blue */
    --navy: #0e1442;
    --indigo: #3346c4;
    --purple: #7c4fe0;
    --blue: #4f8ef0;
    --bg: #f4f6fc;
    --panel: #ffffff;
    --border: #e2e5f5;
    --text: #10132b;
    --muted: #5b6180;
    --faint: #9296b3;
    --accent: var(--indigo);
    --accent-ink: #ffffff;
    --accent-soft: #ebeefc;
    --gold: #d8a838;
    --silver: #9aa0b8;
    --bronze: #bd7d4d;
    --c-pr: var(--indigo);
    --c-review: var(--blue);
    --c-issue: #d8a838;
    --c-other: var(--purple);
    --shadow: 0 1px 2px rgba(20,25,70,.05), 0 18px 40px rgba(20,25,70,.08);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #080a1e;
      --panel: #11142f;
      --border: #23274d;
      --text: #eceeff;
      --muted: #9498c0;
      --faint: #666aa0;
      --indigo: #6d84ff;
      --purple: #a480f5;
      --blue: #6fa6ff;
      --accent: var(--indigo);
      --accent-ink: #080a1e;
      --accent-soft: #191d42;
      --shadow: 0 1px 2px rgba(0,0,0,.35), 0 24px 50px rgba(0,0,0,.5);
    }
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }

  /* Slow-drifting mesh of brand-color glows behind everything */
  .mesh {
    position: fixed; inset: 0; z-index: -2; overflow: hidden; pointer-events: none;
  }
  .mesh i {
    position: absolute; border-radius: 50%; filter: blur(60px); opacity: .35;
    animation: drift 26s ease-in-out infinite;
  }
  .mesh i:nth-child(1) { width: 46vw; height: 46vw; left: -10vw; top: -14vw; background: var(--indigo); animation-duration: 24s; }
  .mesh i:nth-child(2) { width: 40vw; height: 40vw; right: -12vw; top: -6vw; background: var(--purple); animation-duration: 30s; animation-delay: -6s; }
  .mesh i:nth-child(3) { width: 42vw; height: 42vw; left: 20vw; bottom: -18vw; background: var(--blue); animation-duration: 28s; animation-delay: -12s; }
  @media (prefers-color-scheme: dark) { .mesh i { opacity: .28; } }
  @keyframes drift {
    0%, 100% { transform: translate(0, 0) scale(1); }
    33% { transform: translate(3vw, 2vw) scale(1.08); }
    66% { transform: translate(-2vw, 3vw) scale(0.96); }
  }

  body {
    font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    margin: 0;
    padding: 2.75rem 1rem 4rem;
    line-height: 1.45;
  }
  .wrap { max-width: 760px; margin: 0 auto; }

  /* Header, centered, with the animated network mark up top */
  .hero { text-align: center; margin-bottom: 1.6rem; }
  .brand { display: flex; flex-direction: column; align-items: center; gap: .5rem; margin-bottom: .6rem; }
  .mark { width: 84px; height: 64px; overflow: visible; }
  .mark .edge {
    fill: none; stroke-width: 6.5; stroke-linecap: round; stroke-linejoin: round;
    stroke-dasharray: 56; stroke-dashoffset: 56;
    animation: draw 2.6s ease-out forwards, glow 4.5s ease-in-out 2.6s infinite;
  }
  .mark .e1 { stroke: var(--navy); animation-delay: 0s, 2.6s; }
  .mark .e2 { stroke: var(--indigo); animation-delay: .18s, 2.78s; }
  .mark .e3 { stroke: var(--purple); animation-delay: .36s, 2.96s; }
  .mark .e4 { stroke: var(--blue); animation-delay: .54s, 3.14s; }
  @media (prefers-color-scheme: dark) { .mark .e1 { stroke: var(--indigo); } }
  .mark .node { animation: pulse 3.4s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
  .mark .n1 { fill: var(--navy); animation-delay: 0s; }
  .mark .n2 { fill: var(--purple); animation-delay: .3s; }
  .mark .n3 { fill: var(--purple); animation-delay: .6s; }
  .mark .n4 { fill: var(--blue); animation-delay: .9s; }
  .mark .n5 { fill: var(--navy); animation-delay: 1.2s; }
  @media (prefers-color-scheme: dark) { .mark .n1, .mark .n5 { fill: var(--indigo); } }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  @keyframes glow {
    0%, 100% { filter: drop-shadow(0 0 0 transparent); }
    50% { filter: drop-shadow(0 0 4px currentColor); }
  }
  @keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.28); opacity: .75; }
  }

  .brand b { font-size: 1.15rem; letter-spacing: -.01em; }
  .brand .parent {
    font-size: .72rem; color: var(--faint); text-decoration: none;
    padding: .15rem .55rem; border: 1px solid var(--border); border-radius: 999px;
  }
  .brand .parent:hover { color: var(--accent); border-color: var(--accent); }
  h1 {
    margin: 0; font-size: 2.1rem; letter-spacing: -.02em; font-weight: 750;
    background: linear-gradient(100deg, var(--navy) 0%, var(--indigo) 45%, var(--purple) 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  @media (prefers-color-scheme: dark) {
    h1 { background: linear-gradient(100deg, var(--indigo) 0%, var(--purple) 60%, var(--blue) 100%); -webkit-background-clip: text; background-clip: text; }
  }
  .sub { color: var(--muted); margin: .4rem 0 0; font-size: .9rem; }
  .sub .live { color: var(--accent); font-weight: 600; }

  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: .7rem; margin: 1.8rem 0 1.6rem; }
  .tile {
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px;
    padding: .85rem .9rem; box-shadow: var(--shadow);
  }
  .tile-num { font-size: 1.45rem; font-weight: 750; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .tile-lbl { color: var(--muted); font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; margin-top: .1rem; }

  .tabs { display: inline-flex; gap: .25rem; padding: .25rem; margin-bottom: 1.4rem;
    background: var(--panel); border: 1px solid var(--border); border-radius: 999px; box-shadow: var(--shadow); }
  input[type="radio"][name="window"] { position: absolute; opacity: 0; pointer-events: none; }
  .tabs label {
    cursor: pointer; padding: .4rem 1rem; border-radius: 999px; font-size: .82rem;
    font-weight: 600; color: var(--muted); transition: color .15s, background .15s;
  }
  ${activeTab} { color: var(--accent-ink); background: var(--accent); }

  .boards .panel { display: none; }
  ${boardVisibility}

  /* Podium */
  .podium { display: grid; grid-template-columns: 1fr 1.15fr 1fr; align-items: end; gap: .7rem; margin-bottom: 1.4rem; }
  .pod {
    position: relative; text-align: center; background: var(--panel);
    border: 1px solid var(--border); border-radius: 16px; padding: 1.4rem .6rem .95rem;
    box-shadow: var(--shadow);
  }
  .pod-1 { padding-top: 1.9rem; border-color: color-mix(in srgb, var(--gold) 45%, var(--border)); }
  .pod-1 .pod-avatar { width: 68px; height: 68px; }
  .pod-badge { position: absolute; top: -14px; left: 50%; transform: translateX(-50%); font-size: 1.35rem; }
  .pod-avatar { width: 54px; height: 54px; border-radius: 50%; border: 2px solid var(--panel);
    outline: 2px solid var(--border); object-fit: cover; }
  .pod-1 .pod-avatar { outline-color: var(--gold); }
  .pod-2 .pod-avatar { outline-color: var(--silver); }
  .pod-3 .pod-avatar { outline-color: var(--bronze); }
  .pod-handle { display: block; margin: .55rem 0 .1rem; font-weight: 650; font-size: .9rem; color: var(--text); text-decoration: none; }
  .pod-handle:hover { color: var(--accent); }
  .pod-pts { font-size: 1.5rem; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .pod-pts span { font-size: .7rem; font-weight: 600; color: var(--faint); margin-left: .2rem; }
  .pod-meta { color: var(--muted); font-size: .72rem; margin-top: .1rem; }

  /* List */
  .board { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .row {
    display: grid; grid-template-columns: 1.6rem 2.1rem 1fr auto auto;
    align-items: center; gap: .8rem; padding: .6rem .55rem; border-radius: 12px;
    border-bottom: 1px solid var(--border);
  }
  .row:last-child { border-bottom: 0; }
  .row:hover { background: color-mix(in srgb, var(--accent-soft) 60%, transparent); }
  .rank { text-align: center; color: var(--faint); font-weight: 700; font-variant-numeric: tabular-nums; font-size: .9rem; }
  .avatar { width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--border); object-fit: cover; }
  .who { display: flex; flex-direction: column; gap: .22rem; min-width: 0; }
  .handle { color: var(--text); font-weight: 650; text-decoration: none; font-size: .92rem; }
  .handle:hover { color: var(--accent); }
  .meta { color: var(--muted); font-size: .74rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .split { display: flex; height: 4px; border-radius: 999px; overflow: hidden; background: var(--border); margin-top: .12rem; max-width: 260px; }
  .seg-pr { background: var(--c-pr); } .seg-review { background: var(--c-review); }
  .seg-issue { background: var(--c-issue); } .seg-other { background: var(--c-other); }
  .sparkwrap { width: 96px; }
  .spark { width: 96px; height: 28px; display: block; }
  .spark-line { fill: none; stroke: var(--accent); stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; }
  .spark-area { fill: color-mix(in srgb, var(--accent) 14%, transparent); stroke: none; }
  .pts { font-weight: 800; font-size: 1.02rem; text-align: right; font-variant-numeric: tabular-nums; min-width: 3ch; }
  .more { text-align: center; color: var(--faint); font-size: .8rem; margin: 1rem 0 0; }

  /* Legend */
  .legend { display: flex; flex-wrap: wrap; gap: .9rem; margin: 1.3rem 0 0; color: var(--muted); font-size: .74rem; }
  .legend span { display: inline-flex; align-items: center; gap: .35rem; }
  .legend i { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }

  /* Highlights */
  .highlights { margin-top: 2.4rem; }
  .highlights h2 { font-size: 1.05rem; margin: 0 0 .9rem; letter-spacing: -.01em; }
  .h2-sub { color: var(--faint); font-weight: 500; font-size: .8rem; margin-left: .4rem; }
  .hl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .7rem; }
  .hl { display: flex; align-items: flex-start; gap: .7rem; background: var(--panel);
    border: 1px solid var(--border); border-radius: 14px; padding: .8rem .85rem; box-shadow: var(--shadow); }
  .hl-avatar { width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--border); }
  .hl-body { flex: 1; min-width: 0; }
  .hl-top { display: flex; align-items: center; gap: .5rem; }
  .hl-badge { font-size: .68rem; color: var(--muted); background: var(--accent-soft); border-radius: 999px; padding: .1rem .5rem; white-space: nowrap; }
  .hl-desc { color: var(--muted); font-size: .78rem; margin-top: .2rem; }
  .hl-pts { font-weight: 800; color: var(--accent); font-size: .9rem; text-align: right; white-space: nowrap; }
  .hl-src { display: block; font-size: .68rem; font-weight: 500; color: var(--faint); text-decoration: none; margin-top: .1rem; }
  .hl-src:hover { color: var(--accent); }

  footer { margin-top: 2.6rem; padding-top: 1.2rem; border-top: 1px solid var(--border);
    font-size: .76rem; color: var(--faint); text-align: center; }
  footer a { color: var(--muted); }

  @media (max-width: 560px) {
    h1 { font-size: 1.5rem; }
    .mark { width: 60px; height: 46px; }
    .tiles { grid-template-columns: repeat(2, 1fr); }
    .sparkwrap, .spark { display: none; }
    .row { grid-template-columns: 1.4rem 1.9rem 1fr auto; gap: .6rem; }
    .hl-grid { grid-template-columns: 1fr; }
    .pod-meta { display: none; }
  }
</style>
</head>
<body>
  <div class="mesh"><i></i><i></i><i></i></div>
  <div class="wrap">
    <div class="hero">
      <div class="brand">
        <svg class="mark" viewBox="0 0 100 74" aria-hidden="true">
          <path class="edge e1" d="M14 60 L30 16" />
          <path class="edge e2" d="M30 16 L50 38" />
          <path class="edge e3" d="M50 38 L70 16" />
          <path class="edge e4" d="M70 16 L86 60" />
          <circle class="node n1" cx="14" cy="60" r="7"/>
          <circle class="node n2" cx="30" cy="16" r="7"/>
          <circle class="node n3" cx="50" cy="38" r="6"/>
          <circle class="node n4" cx="70" cy="16" r="7"/>
          <circle class="node n5" cx="86" cy="60" r="7"/>
        </svg>
        <b>Mantis</b>
        <a class="parent" href="https://mantis.csail.mit.edu" target="_blank" rel="noopener">mantis.csail.mit.edu ↗</a>
      </div>
      <h1>Contributor Leaderboard</h1>
      <p class="sub">${meta.repos.length} repositories · <span class="live">refreshes hourly</span> · updated ${updated}</p>
    </div>

    <div class="tiles">${tiles}</div>

    ${tabInputs}
    <div class="tabs">${tabLabels}</div>
    <div class="boards">${boards}</div>

    <div class="legend">
      <span><i style="background:var(--c-pr)"></i>Pull requests</span>
      <span><i style="background:var(--c-review)"></i>Reviews</span>
      <span><i style="background:var(--c-issue)"></i>Issues</span>
      <span><i style="background:var(--c-other)"></i>Community</span>
    </div>

    ${highlightsSection(users, meta.manual_categories)}

    <footer>
      Ranked by points earned in the trailing window, not lifetime totals — it's about who's active now.<br/>
      rules v${meta.rules_version} · read-only, GitHub activity + approved manual credits · <a href="admin.html">log a contribution →</a><br/>
      Part of <a href="https://mantis.csail.mit.edu" target="_blank" rel="noopener">Mantis @ MIT CSAIL</a>
    </footer>
  </div>
</body>
</html>`;
}
