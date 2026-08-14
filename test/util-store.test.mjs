import { test } from "node:test";
import assert from "node:assert/strict";
import { pageWatermark, parsePullNumberFromUrl, parseLinkNext, splitRepo } from "../src/util.mjs";
import { repoMatchesDiscovery, mergeRepoLists } from "../src/github/discover.mjs";
import {
  loadStore,
  saveStore,
  replaceRepoSlice,
  upsertById,
  noteFirstMerge,
  isEmptyStore,
} from "../src/store.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("pageWatermark keeps newer nodes and stops when last is older", () => {
  const since = "2026-08-01T00:00:00.000Z";
  const nodes = [
    { updatedAt: "2026-08-10T00:00:00.000Z" },
    { updatedAt: "2026-08-02T00:00:00.000Z" },
    { updatedAt: "2026-07-01T00:00:00.000Z" },
  ];
  const { keep, done, monotonic } = pageWatermark(nodes, since);
  assert.equal(monotonic, true);
  assert.equal(done, true);
  assert.equal(keep.length, 2);
});

test("pageWatermark does not stop on a fully-new page", () => {
  const since = "2026-08-01T00:00:00.000Z";
  const nodes = [
    { updatedAt: "2026-08-14T00:00:00.000Z" },
    { updatedAt: "2026-08-13T00:00:00.000Z" },
  ];
  const { keep, done } = pageWatermark(nodes, since);
  assert.equal(done, false);
  assert.equal(keep.length, 2);
});

test("parsePullNumberFromUrl and Link next", () => {
  assert.equal(
    parsePullNumberFromUrl("https://api.github.com/repos/KellisLab/Mantis/pulls/441"),
    441
  );
  assert.equal(
    parseLinkNext('<https://api.github.com/repos/x/y/pulls/comments?page=2>; rel="next", <https://...>; rel="last"'),
    "https://api.github.com/repos/x/y/pulls/comments?page=2"
  );
  assert.deepEqual(splitRepo("KellisLab/Mantis"), { owner: "KellisLab", name: "Mantis" });
});

test("repo discovery patterns", () => {
  const cfg = { include_patterns: ["^Mantis", "^auto-meeting-minutes$"], exclude: ["KellisLab/Mantis-old"] };
  assert.equal(repoMatchesDiscovery("KellisLab/Mantis", cfg), true);
  assert.equal(repoMatchesDiscovery("KellisLab/mantis-cli", cfg), false);
  assert.equal(repoMatchesDiscovery("KellisLab/auto-meeting-minutes", cfg), true);
  assert.equal(repoMatchesDiscovery("KellisLab/Mantis-old", cfg), false);
  assert.deepEqual(mergeRepoLists(["KellisLab/A"], ["KellisLab/A", "KellisLab/B"]), [
    "KellisLab/A",
    "KellisLab/B",
  ]);
});

test("store upsert, replace slice, identities", () => {
  const dir = mkdtempSync(join(tmpdir(), "mantis-store-"));
  try {
    const store = loadStore(dir);
    assert.equal(isEmptyStore(store), true);
    upsertById(store.prs, [{ id: "1", repo: "A/B", number: 1 }]);
    upsertById(store.prs, [{ id: "2", repo: "A/C", number: 2 }]);
    replaceRepoSlice(store.prs, "A/B", [{ id: "3", repo: "A/B", number: 3 }]);
    assert.equal(store.prs["1"], undefined);
    assert.equal(store.prs["3"].number, 3);
    assert.equal(store.prs["2"].repo, "A/C");
    noteFirstMerge(store.identities, "alice", "2026-01-02T00:00:00Z");
    noteFirstMerge(store.identities, "alice", "2026-06-01T00:00:00Z");
    assert.equal(store.identities.alice.firstMergedAt, "2026-01-02T00:00:00Z");
    saveStore(dir, store);
    const again = loadStore(dir);
    assert.equal(again.prs["3"].number, 3);
    assert.equal(isEmptyStore(again), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
