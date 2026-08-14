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

// Full name when GitHub has one; otherwise "Name not found" with the @login
// kept as secondary so the board still identifies the person.
function looksLikeLogin(name, login) {
  const norm = (s) => String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w]/g, "");
  return norm(name) === norm(login);
}

export function personLabel(u) {
  const name = (u?.name || "").trim();
  if (name && !looksLikeLogin(name, u.login)) {
    return { primary: name, secondary: `@${u.login}`, hasName: true };
  }
  return { primary: "Name not found", secondary: `@${u.login}`, hasName: false };
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
// JSON + README
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
        const p = personLabel(u);
        const label = p.hasName
          ? `**${p.primary}** ([@${u.login}](https://github.com/${u.login}))`
          : `Name not found ([@${u.login}](https://github.com/${u.login}))`;
        return `| ${medal(idx + 1)} | ${label} | **${u.windows[days] || 0}** | ${c.prs || 0} | ${c.reviews || 0} | ${c.confirmed_issues || 0} |`;
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

function personBlock(u, { compact = false } = {}) {
  const p = personLabel(u);
  const nameCls = p.hasName ? "pname" : "pname pname-missing";
  if (compact) {
    return `<a class="person" href="https://github.com/${esc(u.login)}">
      <span class="${nameCls}">${esc(p.primary)}</span>
      <span class="plogin">${esc(p.secondary)}</span>
    </a>`;
  }
  return `<a class="person person-pod" href="https://github.com/${esc(u.login)}">
      <span class="${nameCls}">${esc(p.primary)}</span>
      <span class="plogin">${esc(p.secondary)}</span>
    </a>`;
}

function windowBreakdownBar(u, days) {
  const wb = u.windowBreakdown?.[days];
  if (wb) return breakdownBar(wb);
  // Fallback for older snapshots that only have lifetime breakdown.
  return breakdownBar(u.breakdown || {});
}

// Human-readable “where did these points come from?” for a trailing window.
function scoreExplainer(u, days) {
  const pts = u.windows?.[days] || 0;
  const c = u.windowCounts?.[days] || {};
  const wb = u.windowBreakdown?.[days];
  const bits = [];
  if (wb) {
    if (wb.pr) bits.push(`${wb.pr} from PRs`);
    if (wb.review) bits.push(`${wb.review} from reviews`);
    if (wb.issue) bits.push(`${wb.issue} from issues`);
    if (wb.other) bits.push(`${wb.other} community`);
  }
  const activity = [];
  if (c.prs) activity.push(`${c.prs} PR${c.prs === 1 ? "" : "s"}`);
  if (c.reviews) activity.push(`${c.reviews} review${c.reviews === 1 ? "" : "s"}`);
  if (c.confirmed_issues) activity.push(`${c.confirmed_issues} issue${c.confirmed_issues === 1 ? "" : "s"}`);
  if (c.manual) activity.push(`${c.manual} community`);

  // Show pts/PR only when PRs clearly dominate the window (avoids “45 pts/PR”
  // when most of the total is actually issues / lifetime-ratio noise).
  let avg = "";
  if (c.prs && pts) {
    const prShare = wb ? (wb.pr || 0) / Math.max(1, pts) : c.prs >= (c.confirmed_issues || 0);
    if (prShare === true || prShare >= 0.65) {
      const denom = c.prs;
      const numer = wb ? wb.pr || pts : pts;
      avg = ` · ~${Math.max(1, Math.round(numer / denom))} pts per PR this window`;
    }
  }
  const from = bits.length ? bits.join(" · ") : activity.join(" · ") || "no scored activity";
  return { from, activity: activity.join(" · ") || "—", avg, pts };
}

function podiumCard(u, days, place) {
  const explain = scoreExplainer(u, days);
  return `
    <div class="pod pod-${place}">
      <div class="pod-badge">${medal(place)}</div>
      <img class="pod-avatar" src="https://github.com/${esc(u.login)}.png?size=120" alt="" loading="lazy"/>
      ${personBlock(u)}
      <div class="pod-pts" title="${esc(explain.from)}">${explain.pts}<span>pts</span></div>
      <div class="pod-why">${esc(explain.from)}${esc(explain.avg)}</div>
      <div class="pod-meta">${esc(explain.activity)}</div>
    </div>`;
}

function podium(ranked, days) {
  // Visual order left → right: 1st (largest), 2nd, 3rd (smallest).
  const [first, second, third] = ranked;
  const cards = [];
  if (first) cards.push(podiumCard(first, days, 1));
  if (second) cards.push(podiumCard(second, days, 2));
  if (third) cards.push(podiumCard(third, days, 3));
  return `<div class="podium">${cards.join("")}</div>`;
}

function listRows(ranked, days, dayKeys) {
  return ranked
    .slice(3, SITE_MAX)
    .map((u, i) => {
      const rank = i + 4;
      const explain = scoreExplainer(u, days);
      return `
        <li class="row">
          <span class="rank">${rank}</span>
          <img class="avatar" src="https://github.com/${esc(u.login)}.png?size=48" alt="" loading="lazy"/>
          <span class="who">
            ${personBlock(u, { compact: true })}
            <span class="meta">${esc(explain.activity)}${explain.from.includes("from") ? ` · ${esc(explain.from)}` : ""}</span>
            ${windowBreakdownBar(u, days)}
          </span>
          <span class="sparkwrap">${sparkline(u.days, dayKeys)}</span>
          <span class="pts" title="${esc(explain.from)}">${explain.pts}</span>
        </li>`;
    })
    .join("");
}

function statTile(value, label, scope) {
  return `<div class="tile"><div class="tile-num">${value}</div><div class="tile-lbl">${label}</div>${
    scope ? `<div class="tile-scope">${scope}</div>` : ""
  }</div>`;
}

function whatCountsSection(meta) {
  const rv = meta.review_rules || {};
  const pr = meta.pr_rules || {};
  const is = meta.issue_rules || {};
  const branches = (pr.count_merges_to || []).join(" or ");
  const dupes = (is.duplicate_labels || []).join(", ");
  const prDd = pr.daily_diminishing;
  const isDd = is.daily_diminishing;
  const pp = pr.points || {};
  const prMin = pp.base ?? 10;
  const prMax = Math.round((pp.base || 10) + (pp.max_bonus || 12));
  const prDayCap = pr.max_points_per_day;
  const rvDayCap = rv.max_points_per_day;
  const unrev = pr.unreviewed_multiplier;
  const reviewLo = Math.min(
    ...[rv.commented_points, rv.approved_points, rv.changes_requested_points].filter((n) =>
      Number.isFinite(n)
    )
  );
  const reviewHi = Math.max(
    ...[rv.commented_points, rv.approved_points, rv.changes_requested_points].filter((n) =>
      Number.isFinite(n)
    )
  );
  return `
    <section class="whatcounts">
      <h2>How points work</h2>
      <div class="score-guide">
        <p class="score-guide-lead">
          Ranked by the <b>selected window</b> (past 7 or 14 days), not career total.
          A day of shipping and a day of reviewing are in the same band. Merging
          70 times in one day is still one day.
        </p>
        <div class="score-math">
          <div class="sm">
            <span class="sm-lbl">Typical merged PR</span>
            <span class="sm-val">${prMin}–${prMax} pts</span>
            <span class="sm-note">base ${prMin} + size bonus up to ${pp.max_bonus ?? 12} (flattens after ~${pp.half_life_lines ?? 60} lines)${
              Number.isFinite(unrev) && unrev < 1
                ? ` · unreviewed ×${unrev}`
                : ""
            }</span>
          </div>
          <div class="sm">
            <span class="sm-lbl">A day of shipping</span>
            <span class="sm-val">cap ${prDayCap ?? "—"} pts</span>
            <span class="sm-note">~2 solid PRs. Extra merges the same day add nothing once the cap is hit</span>
          </div>
          <div class="sm">
            <span class="sm-lbl">Substantive review</span>
            <span class="sm-val">${reviewLo}–${reviewHi} pts</span>
            <span class="sm-note">comment / approve / request-changes · one per PR · cap ${rvDayCap ?? "—"} pts/day</span>
          </div>
          <div class="sm">
            <span class="sm-lbl">Issue filed / closed</span>
            <span class="sm-val">+${is.created_points} / +${is.closed_bonus}</span>
            <span class="sm-note">max <b>${is.max_points_per_day ?? 6} issue pts / day</b></span>
          </div>
        </div>
        <p class="score-example">
          <b>Worked example:</b> two reviewed PRs in a day ≈ ${prDayCap ?? 36} pts (the daily cap).
          Seventy-one unreviewed merges that same day still ≈ ${prDayCap ?? 36} pts — not 190.
          Coding five days that way beats one dump. A review (${rv.approved_points ?? 8}–${rv.changes_requested_points ?? 10})
          is part of a day, not a substitute for a week of shipping.
        </p>
      </div>
      <div class="wc-grid">
        <div class="wc">
          <b>Pull requests</b>
          <p>Only <b>merged</b> into <code>${esc(branches)}</code>. Lockfiles / generated /
          vendored paths are excluded from size. ${prDd ? `After ${prDd.after} merges/day, further PRs decay toward zero. ` : ""}${
            Number.isFinite(prDayCap) ? `<b>Hard cap ${prDayCap} PR pts/day.</b>` : ""
          }</p>
        </div>
        <div class="wc">
          <b>Reviews</b>
          <p><b>Commented</b> (+${rv.commented_points ?? 0}, ≥${rv.commented_min_body_length ?? rv.min_body_length} chars),
          <b>Approved</b> (+${rv.approved_points}), or <b>Changes requested</b>
          (+${rv.changes_requested_points}, ≥${rv.min_body_length} chars). ${
            rv.exclude_self_review ? "No self-reviews. " : ""
          }${
            rv.one_per_pr_per_reviewer ? "Best review per PR (not the first click). " : ""
          }${Number.isFinite(rvDayCap) ? `Cap ${rvDayCap} pts/day. ` : ""}Bots never appear.</p>
        </div>
        <div class="wc">
          <b>Issues</b>
          <p>+${is.created_points} to open (valid), +${is.closed_bonus} when completed.
          Rejected as ${esc(dupes)} / not-planned score nothing.
          ${isDd ? `Burst decay after ${isDd.after}/day. ` : ""}${
    Number.isFinite(is.max_points_per_day)
      ? `<b>Hard cap ${is.max_points_per_day} issue pts/day.</b>`
      : ""
  }</p>
        </div>
        <div class="wc">
          <b>Humans only</b>
          <p>Dependabot, GitHub Actions, Renovate, <code>[bot]</code> accounts, and
          named agents (MantisCartography, Codex, Copilot) are excluded. Rankings track
          who’s actively shipping <i>now</i>.</p>
        </div>
      </div>
    </section>`;
}

function highlightsSection(users, categories) {
  const items = [];
  for (const u of users) {
    for (const c of u.contributions || []) {
      items.push({ login: u.login, name: u.name, ...c });
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
            <div class="hl-top">${personBlock({ login: c.login, name: c.name }, { compact: true })}<span class="hl-badge">${badge}</span></div>
            <div class="hl-desc">${esc(c.description) || "Community contribution"}</div>
          </div>
          <div class="hl-pts">+${c.points}${src}</div>
        </div>`;
    })
    .join("");
  return `
    <section class="highlights">
      <h2>Community highlights <span class="h2-sub">off-GitHub contributions</span></h2>
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

  const lookback = meta.lookback_days;
  const scopeLbl = `last ${lookback}d`;
  const updated = new Date().toUTCString().replace("GMT", "UTC");
  const tiles = [
    statTile(users.length, "Contributors"),
    statTile(totalPRs.toLocaleString(), "PRs merged", scopeLbl),
    statTile(totalReviews.toLocaleString(), "Reviews", scopeLbl),
    totalManual
      ? statTile(totalManual.toLocaleString(), "Community credits", scopeLbl)
      : statTile(totalIssues.toLocaleString(), "Issues", scopeLbl),
  ].join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Mantis Leaderboard</title>
<link rel="icon" href="favicon.ico" sizes="any"/>
<link rel="icon" href="favicon.svg" type="image/svg+xml"/>
<link rel="apple-touch-icon" href="apple-touch-icon.png"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Serif:wght@500;600&display=swap" rel="stylesheet"/>
<style>
  :root {
    color-scheme: light dark;
    --navy: #0b1140;
    --ink: #12162e;
    --indigo: #2f45b8;
    --sky: #4a7fe0;
    --bg: #eef1f8;
    --bg-deep: #e4e9f4;
    --panel: #ffffff;
    --panel-2: #f8f9fd;
    --border: #d5dbea;
    --text: #12162e;
    --muted: #5a6280;
    --faint: #8b92ad;
    --accent: var(--indigo);
    --accent-ink: #ffffff;
    --accent-soft: #e8ecfa;
    --gold: #c9a227;
    --gold-soft: #f7efd4;
    --silver: #8e95aa;
    --bronze: #b07848;
    --c-pr: var(--indigo);
    --c-review: var(--sky);
    --c-issue: #c9a227;
    --c-other: #6b5bd4;
    --shadow: 0 1px 0 rgba(12,18,48,.04), 0 12px 32px rgba(12,18,48,.06);
    --radius: 12px;
    --font: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
    --serif: "IBM Plex Serif", "Iowan Old Style", Georgia, serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0a0c18;
      --bg-deep: #070912;
      --panel: #12162a;
      --panel-2: #161b32;
      --border: #262b48;
      --text: #eef0fa;
      --muted: #9aa1c0;
      --faint: #6d7396;
      --indigo: #7b8fff;
      --sky: #7fb0ff;
      --accent: var(--indigo);
      --accent-ink: #0a0c18;
      --accent-soft: #1a1f3c;
      --gold: #e0bc4a;
      --gold-soft: #2a2412;
      --shadow: 0 1px 0 rgba(0,0,0,.25), 0 18px 40px rgba(0,0,0,.45);
    }
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    min-height: 100vh;
    font-family: var(--font);
    color: var(--text);
    line-height: 1.45;
    background:
      radial-gradient(900px 420px at 12% -8%, color-mix(in srgb, var(--indigo) 14%, transparent), transparent 60%),
      radial-gradient(700px 380px at 92% 0%, color-mix(in srgb, var(--sky) 12%, transparent), transparent 55%),
      linear-gradient(180deg, var(--bg) 0%, var(--bg-deep) 100%);
    padding: 2.5rem 1.1rem 4rem;
  }
  .wrap { max-width: 820px; margin: 0 auto; }

  .hero { margin-bottom: 1.5rem; }
  .masthead {
    display: flex; align-items: center; justify-content: space-between;
    gap: 1rem; flex-wrap: wrap; margin-bottom: 1.15rem;
  }
  .brand { display: flex; align-items: center; }
  .logo {
    width: min(168px, 52vw); height: auto; display: block;
    filter: none;
  }
  @media (prefers-color-scheme: dark) {
    .logo { filter: invert(1) brightness(1.05); }
  }
  .topnav {
    display: flex; flex-wrap: wrap; gap: .4rem;
  }
  .topnav a {
    font-size: .78rem; font-weight: 600; letter-spacing: .01em;
    color: var(--muted); text-decoration: none;
    padding: .38rem .95rem; border-radius: 999px;
    border: 1px solid var(--border); background: var(--panel);
  }
  .topnav a:hover { color: var(--accent); border-color: var(--accent); }
  .topnav a.active {
    color: var(--accent); border-color: var(--accent);
    background: var(--accent-soft);
  }
  h1 {
    margin: 0; font-family: var(--serif); font-weight: 600;
    font-size: clamp(1.65rem, 4vw, 2.15rem); letter-spacing: -.02em;
    color: var(--text);
  }
  .sub { color: var(--muted); margin: .4rem 0 0; font-size: .88rem; }
  .sub .live { color: var(--accent); font-weight: 600; }

  .tiles {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: .65rem;
    margin: 1.7rem 0 1.5rem;
  }
  .tile {
    background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
    padding: .9rem 1rem; box-shadow: var(--shadow);
  }
  .tile-num {
    font-size: 1.5rem; font-weight: 700; letter-spacing: -.02em;
    font-variant-numeric: tabular-nums;
  }
  .tile-lbl {
    color: var(--muted); font-size: .68rem; text-transform: uppercase;
    letter-spacing: .08em; margin-top: .15rem; font-weight: 600;
  }
  .tile-scope { color: var(--faint); font-size: .66rem; margin-top: .2rem; }

  .tabs {
    display: inline-flex; gap: .2rem; padding: .22rem; margin-bottom: 1.35rem;
    background: var(--panel); border: 1px solid var(--border); border-radius: 999px;
    box-shadow: var(--shadow);
  }
  input[type="radio"][name="window"] { position: absolute; opacity: 0; pointer-events: none; }
  .tabs label {
    cursor: pointer; padding: .42rem 1.05rem; border-radius: 999px; font-size: .8rem;
    font-weight: 600; color: var(--muted); transition: color .15s, background .15s;
  }
  ${activeTab} { color: var(--accent-ink); background: var(--accent); }

  .boards .panel { display: none; }
  ${boardVisibility}

  /* Podium: left=1st (large), mid=2nd, right=3rd (small) */
  .podium {
    display: grid;
    grid-template-columns: minmax(0, 1.22fr) minmax(0, 1fr) minmax(0, .86fr);
    align-items: end;
    gap: .7rem;
    margin: 0 0 1.35rem;
    padding-top: 1.15rem;
  }
  .pod {
    position: relative; text-align: center;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 16px 16px 10px 10px;
    box-shadow: var(--shadow);
    display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
  }
  .pod-badge {
    position: absolute; top: -16px; left: 50%; transform: translateX(-50%);
    line-height: 1; filter: drop-shadow(0 2px 4px rgba(12,18,48,.12));
  }
  .pod-avatar {
    border-radius: 50%; border: 2.5px solid var(--panel);
    outline: 2.5px solid var(--border); object-fit: cover;
  }
  .pod-pts { font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums; line-height: 1.1; }
  .pod-pts span { font-size: .58em; font-weight: 600; color: var(--faint); margin-left: .15rem; }
  .pod-why {
    color: var(--muted); font-size: .68rem; margin-top: .28rem; line-height: 1.35;
    max-width: 100%; padding: 0 .25rem;
  }
  .pod-meta { color: var(--faint); font-size: .68rem; margin-top: .12rem; }

  .pod-3 {
    padding: 1.1rem .5rem .8rem; min-height: 172px;
    border-color: color-mix(in srgb, var(--bronze) 38%, var(--border));
  }
  .pod-3 .pod-badge { font-size: 1.1rem; }
  .pod-3 .pod-avatar { width: 48px; height: 48px; outline-color: var(--bronze); }
  .pod-3 .pod-pts { font-size: 1.18rem; }
  .pod-3 .pname { font-size: .78rem; }
  .pod-3 .pod-why { font-size: .62rem; }

  .pod-2 {
    padding: 1.35rem .55rem .9rem; min-height: 208px; margin-bottom: .3rem;
    border-color: color-mix(in srgb, var(--silver) 42%, var(--border));
  }
  .pod-2 .pod-badge { font-size: 1.3rem; }
  .pod-2 .pod-avatar { width: 64px; height: 64px; outline-color: var(--silver); }
  .pod-2 .pod-pts { font-size: 1.4rem; }
  .pod-2 .pname { font-size: .86rem; }

  .pod-1 {
    padding: 1.65rem .6rem 1.05rem; min-height: 252px; margin-bottom: .65rem;
    border-color: color-mix(in srgb, var(--gold) 55%, var(--border));
    background:
      linear-gradient(180deg, var(--gold-soft) 0%, var(--panel) 42%);
  }
  .pod-1 .pod-badge { font-size: 1.6rem; top: -18px; }
  .pod-1 .pod-avatar { width: 84px; height: 84px; outline: 3px solid var(--gold); }
  .pod-1 .pod-pts { font-size: 1.72rem; }
  .pod-1 .pname { font-size: .95rem; font-weight: 600; }
  .pod-1 .pod-why { font-size: .7rem; color: var(--text); }

  /* Person labels: full name primary, @login secondary */
  .person {
    display: flex; flex-direction: column; gap: .08rem; min-width: 0;
    text-decoration: none; color: inherit;
  }
  .person-pod {
    align-items: center; margin: .55rem 0 .12rem; width: 100%; padding: 0 .15rem;
  }
  .pname {
    font-family: var(--serif); font-weight: 600; color: var(--text);
    line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    max-width: 100%;
  }
  .pname-missing { color: var(--faint); font-style: italic; font-weight: 500; }
  .plogin {
    font-family: var(--font); font-size: .72rem; font-weight: 500; color: var(--muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .person:hover .pname { color: var(--accent); }
  .person:hover .plogin { color: var(--accent); }

  .board {
    list-style: none; margin: 0; padding: 0;
    display: flex; flex-direction: column;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px;
    box-shadow: var(--shadow); overflow: hidden;
  }
  .row {
    display: grid; grid-template-columns: 1.7rem 2.2rem 1fr auto auto;
    align-items: center; gap: .75rem; padding: .72rem .9rem;
    border-bottom: 1px solid var(--border);
  }
  .row:last-child { border-bottom: 0; }
  .row:hover { background: var(--panel-2); }
  .rank {
    text-align: center; color: var(--faint); font-weight: 700;
    font-variant-numeric: tabular-nums; font-size: .86rem;
  }
  .avatar {
    width: 36px; height: 36px; border-radius: 50%;
    border: 1px solid var(--border); object-fit: cover;
  }
  .who { display: flex; flex-direction: column; gap: .2rem; min-width: 0; }
  .who .pname { font-size: .95rem; }
  .meta {
    color: var(--muted); font-size: .73rem;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .split {
    display: flex; height: 3px; border-radius: 999px; overflow: hidden;
    background: var(--border); margin-top: .14rem; max-width: 240px;
  }
  .seg-pr { background: var(--c-pr); } .seg-review { background: var(--c-review); }
  .seg-issue { background: var(--c-issue); } .seg-other { background: var(--c-other); }
  .sparkwrap { width: 96px; }
  .spark { width: 96px; height: 28px; display: block; }
  .spark-line { fill: none; stroke: var(--accent); stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; }
  .spark-area { fill: color-mix(in srgb, var(--accent) 12%, transparent); stroke: none; }
  .pts {
    font-weight: 700; font-size: 1.02rem; text-align: right;
    font-variant-numeric: tabular-nums; min-width: 3ch;
  }
  .more { text-align: center; color: var(--faint); font-size: .8rem; margin: 1rem 0 0; }

  .legend {
    display: flex; flex-wrap: wrap; gap: .9rem; margin: 1.25rem 0 0;
    color: var(--muted); font-size: .74rem;
  }
  .legend span { display: inline-flex; align-items: center; gap: .35rem; }
  .legend i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }

  .whatcounts { margin-top: 2.5rem; }
  .whatcounts h2, .highlights h2 {
    font-family: var(--serif); font-size: 1.15rem; font-weight: 600;
    margin: 0 0 1rem; letter-spacing: -.01em;
  }
  .score-guide {
    background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 1.05rem 1.15rem 1.15rem; box-shadow: var(--shadow); margin-bottom: .85rem;
  }
  .score-guide-lead { margin: 0 0 .9rem; color: var(--muted); font-size: .86rem; line-height: 1.55; }
  .score-math {
    display: grid; grid-template-columns: repeat(2, 1fr); gap: .65rem;
  }
  .sm {
    background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px;
    padding: .7rem .8rem; display: flex; flex-direction: column; gap: .15rem;
  }
  .sm-lbl { font-size: .68rem; text-transform: uppercase; letter-spacing: .06em; color: var(--faint); font-weight: 600; }
  .sm-val { font-size: 1.05rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .sm-note { font-size: .72rem; color: var(--muted); line-height: 1.4; }
  .score-example {
    margin: .9rem 0 0; padding: .75rem .85rem; border-radius: 10px;
    background: color-mix(in srgb, var(--accent-soft) 80%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border));
    color: var(--muted); font-size: .8rem; line-height: 1.5;
  }
  .score-example b { color: var(--text); }
  @media (max-width: 560px) {
    .score-math { grid-template-columns: 1fr; }
  }
  .wc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .7rem; }
  .wc {
    background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
    padding: .95rem 1.05rem; box-shadow: var(--shadow);
  }
  .wc b { font-size: .86rem; }
  .wc p { color: var(--muted); font-size: .78rem; margin: .4rem 0 0; line-height: 1.55; }
  .wc code {
    background: var(--accent-soft); border-radius: 4px; padding: .05rem .3rem; font-size: .74rem;
  }
  @media (max-width: 560px) { .wc-grid { grid-template-columns: 1fr; } }

  .highlights { margin-top: 2.5rem; }
  .h2-sub { color: var(--faint); font-weight: 500; font-size: .78rem; margin-left: .35rem; font-family: var(--font); }
  .hl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .7rem; }
  .hl {
    display: flex; align-items: flex-start; gap: .7rem;
    background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
    padding: .85rem .9rem; box-shadow: var(--shadow);
  }
  .hl-avatar { width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--border); }
  .hl-body { flex: 1; min-width: 0; }
  .hl-top { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .hl-badge {
    font-size: .66rem; color: var(--muted); background: var(--accent-soft);
    border-radius: 999px; padding: .1rem .5rem; white-space: nowrap;
  }
  .hl-desc { color: var(--muted); font-size: .78rem; margin-top: .2rem; }
  .hl-pts { font-weight: 700; color: var(--accent); font-size: .9rem; text-align: right; white-space: nowrap; }
  .hl-src { display: block; font-size: .68rem; font-weight: 500; color: var(--faint); text-decoration: none; margin-top: .1rem; }
  .hl-src:hover { color: var(--accent); }

  footer {
    margin-top: 2.75rem; padding-top: 1.25rem; border-top: 1px solid var(--border);
    font-size: .76rem; color: var(--faint); text-align: center; line-height: 1.65;
  }
  footer a { color: var(--muted); }

  @media (max-width: 560px) {
    h1 { font-size: 1.45rem; }
    .logo { width: min(180px, 68vw); }
    .tiles { grid-template-columns: repeat(2, 1fr); }
    .sparkwrap, .spark { display: none; }
    .row { grid-template-columns: 1.4rem 1.9rem 1fr auto; gap: .55rem; padding: .65rem .7rem; }
    .hl-grid { grid-template-columns: 1fr; }
    .podium { gap: .45rem; }
    .pod-meta, .pod-why { font-size: .58rem !important; }
    .pod-3 { min-height: 150px; }
    .pod-3 .pod-avatar { width: 42px; height: 42px; }
    .pod-2 { min-height: 178px; }
    .pod-2 .pod-avatar { width: 54px; height: 54px; }
    .pod-1 { min-height: 214px; }
    .pod-1 .pod-avatar { width: 68px; height: 68px; }
    .pname { font-size: .72rem !important; max-width: 7.2rem; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <div class="masthead">
        <a class="brand" href="index.html">
          <img class="logo" src="mantis-logo.png" alt="Mantis" width="220" height="74"/>
        </a>
        <nav class="topnav">
          <a class="active" href="index.html">Leaderboard</a>
          <a href="admin.html">Log a contribution</a>
        </nav>
      </div>
      <h1>Contributor Leaderboard</h1>
      <p class="sub">${meta.repos.length} repositories · humans only · <span class="live">updates every 2 hours</span> · ${updated}</p>
    </header>

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

    ${whatCountsSection(meta)}

    <footer>
      Ranked by points in the selected window only — not lifetime totals.<br/>
      Why a score looks “small”: same-day PR floods are discounted; issues hard-capped. Hover a total to see the split.<br/>
      rules v${meta.rules_version} · GitHub activity + approved manual credits<br/>
      Part of <a href="https://mantis.csail.mit.edu" target="_blank" rel="noopener">Mantis @ MIT CSAIL</a>
    </footer>
  </div>
</body>
</html>`;
}
