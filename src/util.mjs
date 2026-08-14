// Shared time / repo helpers. UTC everywhere — daily caps and windows are UTC days.

export function lookbackSinceIso(lookbackDays) {
  const d = new Date(Date.now() - lookbackDays * 86400_000);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function lookbackSinceDate(lookbackDays) {
  return lookbackSinceIso(lookbackDays).slice(0, 10);
}

export function subtractMinutes(iso, minutes) {
  return new Date(Date.parse(iso) - minutes * 60_000).toISOString();
}

export function splitRepo(repo) {
  const [owner, name] = String(repo).split("/");
  if (!owner || !name) throw new Error(`Invalid repo "${repo}" (expected owner/name)`);
  return { owner, name };
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function loginOf(actor) {
  if (!actor) return null;
  if (typeof actor === "string") return actor;
  return actor.login || null;
}

/** Keep nodes at/after `sinceIso` on an UPDATED_AT DESC page; decide whether to stop. */
export function pageWatermark(nodes, sinceIso, field = "updatedAt") {
  if (!nodes?.length) return { keep: [], done: true, monotonic: true };
  const times = nodes.map((n) => n?.[field]).filter(Boolean);
  const last = nodes[nodes.length - 1]?.[field];
  const min = times.length ? times.reduce((a, b) => (a < b ? a : b)) : last;
  const monotonic = !last || !min || last <= min;
  const keep = nodes.filter((n) => n?.[field] && n[field] >= sinceIso);
  const done = Boolean(monotonic && last && last < sinceIso);
  return { keep, done, monotonic };
}

export function parsePullNumberFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)/);
  return m ? Number(m[1]) : null;
}

export function parseLinkNext(linkHeader) {
  if (!linkHeader) return null;
  const m = String(linkHeader).match(/<([^>]+)>;\s*rel="next"/);
  return m ? m[1] : null;
}
