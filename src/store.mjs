// Durable event log. Git is the database: each successful sync commits these
// files, the next run upserts. Full sync replaces a repo's slice; incremental
// merges. Identities remember first-seen merge time so "first PR" survives prune.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILES = {
  prs: "prs.json",
  issues: "issues.json",
  reviews: "reviews.json",
  reviewComments: "review_comments.json",
  identities: "identities.json",
  state: "state.json",
};

function emptyStore() {
  return {
    prs: {},
    issues: {},
    reviews: {},
    reviewComments: {},
    identities: {},
    state: { version: 1, repos: {}, lastFullSyncAt: null, lastSuccessAt: null },
  };
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Corrupt store file ${path}: ${err.message}`);
  }
}

function writeJsonAtomic(path, value) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, path);
}

export function loadStore(dir) {
  mkdirSync(dir, { recursive: true });
  const store = emptyStore();
  store.prs = readJson(join(dir, FILES.prs), {});
  store.issues = readJson(join(dir, FILES.issues), {});
  store.reviews = readJson(join(dir, FILES.reviews), {});
  store.reviewComments = readJson(join(dir, FILES.reviewComments), {});
  store.identities = readJson(join(dir, FILES.identities), {});
  store.state = { ...store.state, ...readJson(join(dir, FILES.state), {}) };
  return store;
}

export function saveStore(dir, store) {
  mkdirSync(dir, { recursive: true });
  writeJsonAtomic(join(dir, FILES.prs), store.prs);
  writeJsonAtomic(join(dir, FILES.issues), store.issues);
  writeJsonAtomic(join(dir, FILES.reviews), store.reviews);
  writeJsonAtomic(join(dir, FILES.reviewComments), store.reviewComments);
  writeJsonAtomic(join(dir, FILES.identities), store.identities);
  writeJsonAtomic(join(dir, FILES.state), store.state);
}

export function isEmptyStore(store) {
  return !Object.keys(store.prs || {}).length && !store.state?.lastSuccessAt;
}

export function upsertById(map, records) {
  for (const rec of records || []) {
    if (!rec?.id) continue;
    map[rec.id] = rec;
  }
}

export function replaceRepoSlice(map, repo, records) {
  for (const [id, rec] of Object.entries(map)) {
    if (rec.repo === repo) delete map[id];
  }
  upsertById(map, records);
}

export function replaceReviewsForPrs(reviewMap, prIds, records) {
  const drop = new Set(prIds);
  for (const [id, rec] of Object.entries(reviewMap)) {
    if (drop.has(rec.prId)) delete reviewMap[id];
  }
  upsertById(reviewMap, records);
}

export function noteFirstMerge(identities, login, mergedAt) {
  if (!login || !mergedAt) return;
  const prev = identities[login]?.firstMergedAt;
  if (!prev || mergedAt < prev) {
    identities[login] = { ...(identities[login] || {}), firstMergedAt: mergedAt };
  }
}

export function rememberName(identities, login, name) {
  if (!login) return;
  identities[login] = { ...(identities[login] || {}), name: name || null };
}

export function countsByRepo(map) {
  const out = {};
  for (const rec of Object.values(map || {})) {
    const repo = rec.repo || "?";
    out[repo] = (out[repo] || 0) + 1;
  }
  return out;
}
