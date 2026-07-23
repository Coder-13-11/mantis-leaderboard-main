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
  return `
    <div class="pod pod-${place}">
      <div class="pod-badge">${medal(place)}</div>
      <img class="pod-avatar" src="https://github.com/${esc(u.login)}.png?size=120" alt="" loading="lazy"/>
      <a class="pod-handle" href="https://github.com/${esc(u.login)}">${esc(u.login)}</a>
      <div class="pod-pts">${pts}<span>pts</span></div>
      <div class="pod-meta">${u.counts.prs} PRs · ${u.counts.reviews} reviews</div>
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
      return `
        <li class="row">
          <span class="rank">${rank}</span>
          <img class="avatar" src="https://github.com/${esc(u.login)}.png?size=48" alt="" loading="lazy"/>
          <span class="who">
            <a class="handle" href="https://github.com/${esc(u.login)}">${esc(u.login)}</a>
            <span class="meta">${u.counts.prs} PRs · ${u.counts.reviews} reviews · ${u.counts.confirmed_issues} issues${u.counts.manual ? ` · ${u.counts.manual} community` : ""}</span>
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
      : statTile(totalIssues.toLocaleString(), "Issues confirmed"),
  ].join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Mantis · Contributor Leaderboard</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f5f7f5;
    --panel: #ffffff;
    --border: #e5e9e5;
    --text: #14181a;
    --muted: #62706a;
    --faint: #97a39d;
    --accent: #1f9d57;
    --accent-ink: #ffffff;
    --accent-soft: #e7f5ec;
    --gold: #e0a92a;
    --silver: #9aa4ad;
    --bronze: #c07d43;
    --c-pr: #1f9d57;
    --c-review: #3b82f6;
    --c-issue: #e0a43b;
    --c-other: #8b6fe0;
    --shadow: 0 1px 2px rgba(20,40,30,.05), 0 18px 40px rgba(20,40,30,.07);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0b0e0c;
      --panel: #12160f;
      --panel: #121712;
      --border: #232a24;
      --text: #eaf0ec;
      --muted: #93a29a;
      --faint: #6b7a72;
      --accent: #34c47c;
      --accent-ink: #06110b;
      --accent-soft: #14251b;
      --shadow: 0 1px 2px rgba(0,0,0,.3), 0 24px 50px rgba(0,0,0,.45);
    }
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background:
      radial-gradient(1200px 600px at 50% -300px, var(--accent-soft), transparent 70%),
      var(--bg);
    color: var(--text);
    margin: 0;
    padding: 2.75rem 1rem 4rem;
    line-height: 1.45;
  }
  .wrap { max-width: 760px; margin: 0 auto; }
  .brand { display: flex; align-items: center; gap: .6rem; margin-bottom: .35rem; }
  .brand .dot {
    width: 30px; height: 30px; border-radius: 9px;
    background: linear-gradient(135deg, var(--accent), #0e7a41);
    display: grid; place-items: center; color: #fff; font-size: 1rem;
    box-shadow: 0 4px 12px rgba(31,157,87,.35);
  }
  .brand b { font-size: 1.05rem; letter-spacing: -.01em; }
  h1 { margin: 0; font-size: 1.9rem; letter-spacing: -.02em; font-weight: 750; }
  .sub { color: var(--muted); margin: .3rem 0 1.6rem; font-size: .9rem; }
  .sub .live { color: var(--accent); font-weight: 600; }

  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: .7rem; margin-bottom: 1.6rem; }
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
    .tiles { grid-template-columns: repeat(2, 1fr); }
    .sparkwrap, .spark { display: none; }
    .row { grid-template-columns: 1.4rem 1.9rem 1fr auto; gap: .6rem; }
    .hl-grid { grid-template-columns: 1fr; }
    .pod-meta { display: none; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand"><span class="dot">🦗</span><b>Mantis</b></div>
    <h1>Contributor Leaderboard</h1>
    <p class="sub">${meta.repos.length} repositories · <span class="live">refreshes hourly</span> · updated ${updated}</p>

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
      rules v${meta.rules_version} · read-only, GitHub activity + approved manual credits · <a href="admin.html">log a contribution →</a>
    </footer>
  </div>
</body>
</html>`;
}
