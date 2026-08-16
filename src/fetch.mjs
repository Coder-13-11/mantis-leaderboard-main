// Orchestrate a listing-based sync into the event store, then produce the
// GraphQL-shaped activity object the scorer already understands.

import {
  assertRepoVisible,
  attachCommentsToPrs,
  checksumSearch,
  hydratePullRequests,
  listIssues,
  listPullRequests,
  listReviewComments,
} from "./github/list.mjs";
import { discoverOrgRepos, mergeRepoLists, repoMatchesDiscovery } from "./github/discover.mjs";
import {
  isEmptyStore,
  loadStore,
  noteFirstMerge,
  rememberName,
  replaceRepoSlice,
  replaceReviewsForPrs,
  saveStore,
  upsertById,
} from "./store.mjs";
import { lookbackSinceDate, lookbackSinceIso, subtractMinutes } from "./util.mjs";

function toPrRecord(p) {
  return {
    id: p.id,
    repo: p.repo,
    number: p.number,
    title: p.title,
    state: p.state,
    author: p.author?.login || null,
    mergedBy: p.mergedBy?.login || null,
    coauthors: p.coauthors || [],
    mergedAt: p.mergedAt || null,
    closedAt: p.closedAt || null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    baseRefName: p.baseRefName,
    additions: p.additions || 0,
    deletions: p.deletions || 0,
    changedFiles: p.changedFiles || 0,
    files: (p.files?.nodes || []).map((f) =>
      typeof f === "string"
        ? { path: f }
        : { path: f.path, additions: f.additions || 0, deletions: f.deletions || 0 }
    ),
    filesTruncated: Boolean(p.filesTruncated),
    labels: (p.labels?.nodes || []).map((l) => (typeof l === "string" ? l : l.name)),
  };
}

function toReviewRecords(p) {
  return (p.reviews?.nodes || [])
    .filter((r) => r?.id)
    .map((r) => ({
      id: r.id,
      prId: p.id,
      repo: p.repo,
      number: p.number,
      author: r.author?.login || null,
      state: r.state,
      bodyLength: (r.body || "").trim().length,
      submittedAt: r.submittedAt,
    }));
}

function toIssueRecord(i) {
  return {
    id: i.id,
    repo: i.repo,
    number: i.number,
    title: i.title,
    state: i.state,
    closed: Boolean(i.closed || i.state === "CLOSED"),
    closedAt: i.closedAt || null,
    closedBy: i.closedBy || null,
    closedByMergedPr: Boolean(i.closedByMergedPr),
    stateReason: i.stateReason || null,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    author: i.author?.login || null,
    labels: (i.labels?.nodes || []).map((l) => (typeof l === "string" ? l : l.name)),
    // { "imp:8": "MantisCartography", ... } — who applied each label, so the
    // scorer can ignore severity labels the filer put on their own issue.
    labelActors: i.labelActors || null,
  };
}

export function activityFromStore(store, sinceIso) {
  const reviewsByPr = {};
  for (const r of Object.values(store.reviews || {})) {
    if (!r.prId) continue;
    (reviewsByPr[r.prId] ||= []).push({
      id: r.id,
      state: r.state,
      body: "x".repeat(r.bodyLength || 0),
      submittedAt: r.submittedAt,
      author: r.author ? { login: r.author } : null,
    });
  }
  const commentsByPr = {};
  const commentsByKey = {};
  for (const c of Object.values(store.reviewComments || {})) {
    const rec = {
      id: c.id,
      author: c.author ? { login: c.author } : null,
      body: "x".repeat(c.bodyLength || 0),
      createdAt: c.createdAt,
    };
    if (c.prId) (commentsByPr[c.prId] ||= []).push(rec);
    if (c.repo && c.number) (commentsByKey[`${c.repo}#${c.number}`] ||= []).push(rec);
  }

  const pullRequests = Object.values(store.prs || {}).map((p) => ({
    id: p.id,
    number: p.number,
    title: p.title,
    additions: p.additions,
    deletions: p.deletions,
    changedFiles: p.changedFiles,
    mergedAt: p.mergedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    closedAt: p.closedAt,
    baseRefName: p.baseRefName,
    state: p.state,
    author: p.author ? { login: p.author } : null,
    mergedBy: p.mergedBy ? { login: p.mergedBy } : null,
    coauthors: p.coauthors || [],
    repository: { nameWithOwner: p.repo },
    labels: { nodes: (p.labels || []).map((name) => ({ name })) },
    files: {
      nodes: (p.files || []).map((f) =>
        typeof f === "string" ? { path: f } : { path: f.path, additions: f.additions, deletions: f.deletions }
      ),
    },
    reviews: { nodes: reviewsByPr[p.id] || [] },
    reviewComments: { nodes: commentsByPr[p.id] || commentsByKey[`${p.repo}#${p.number}`] || [] },
  }));

  const issues = Object.values(store.issues || {}).map((i) => ({
    number: i.number,
    title: i.title,
    state: i.state,
    closed: i.closed,
    closedAt: i.closedAt,
    closedBy: i.closedBy ? { login: i.closedBy } : null,
    stateReason: i.stateReason,
    createdAt: i.createdAt,
    author: i.author ? { login: i.author } : null,
    repository: { nameWithOwner: i.repo },
    labels: { nodes: (i.labels || []).map((name) => ({ name })) },
  }));

  return { pullRequests, issues, since: sinceIso.slice(0, 10) };
}

function mergedInWindow(store, repo, sinceIso) {
  return Object.values(store.prs).filter(
    (p) => p.repo === repo && p.mergedAt && p.mergedAt >= sinceIso && p.state === "MERGED"
  ).length;
}

function issuesCreatedInWindow(store, repo, sinceIso) {
  return Object.values(store.issues).filter(
    (i) => i.repo === repo && i.createdAt && i.createdAt >= sinceIso
  ).length;
}

export async function resolveRepos(token, rules) {
  const warnings = [];
  const discovery = await discoverOrgRepos(token, rules.org, rules.repo_discovery || {});
  warnings.push(...discovery.warnings);
  const extra = rules.repo_discovery?.extra || [];
  const repos = mergeRepoLists(rules.repos, discovery.repos, extra);
  const configured = new Set((rules.repos || []).map((r) => r.toLowerCase()));
  const added = repos.filter((r) => !configured.has(r.toLowerCase()));
  if (added.length) {
    warnings.push(`discovery added ${added.length} repo(s): ${added.join(", ")}`);
  }
  if (discovery.repos.length && rules.repo_discovery) {
    const visible = new Set(discovery.repos.map((r) => r.toLowerCase()));
    for (const r of rules.repos || []) {
      if (!visible.has(r.toLowerCase()) && repoMatchesDiscovery(r, rules.repo_discovery)) {
        warnings.push(
          `${r} is in config and matches discovery patterns but was not returned by the org listing — token may not see it`
        );
      }
    }
  }
  return { repos, warnings };
}

export async function fetchActivity(token, repos, lookbackDays, options = {}) {
  const rules = options.rules || { repos, lookback_days: lookbackDays };
  const storeDir = options.storeDir;
  if (!storeDir && !options.store) {
    throw new Error("fetchActivity requires options.storeDir (the event log path)");
  }
  const requestedMode = options.mode || process.env.SYNC_MODE || "incremental";
  const store = options.store || loadStore(storeDir);

  const runStartedAt = new Date().toISOString();
  const lookbackIso = lookbackSinceIso(lookbackDays);
  const lookbackDate = lookbackSinceDate(lookbackDays);
  const overlap = rules.sync?.overlap_minutes ?? 120;
  const empty = isEmptyStore(store);
  const mode = empty || requestedMode === "full" ? "full" : "incremental";
  if (empty && requestedMode !== "full") {
    console.log("  empty event store — forcing full backfill");
  }

  const resolved = options.reposResolved || (await resolveRepos(token, { ...rules, repos }));
  const targetRepos = resolved.repos;
  const quality = {
    mode,
    run_started_at: runStartedAt,
    lookback_days: lookbackDays,
    lookback_since: lookbackIso,
    repos: targetRepos,
    warnings: [...(resolved.warnings || [])],
    checksums: [],
    checksum_ok: true,
  };

  console.log(`Sync mode=${mode} repos=${targetRepos.length} lookback=${lookbackDays}d`);

  for (const repo of targetRepos) {
    const meta = await assertRepoVisible(token, repo);
    console.log(`  ${repo} (merged-all-time=${meta.pullRequests.totalCount}, issues-all-time=${meta.issues.totalCount})`);

    const repoState = store.state.repos?.[repo] || {};
    const updatedSince =
      mode === "full" || !repoState.lastSuccessAt
        ? lookbackIso
        : subtractMinutes(repoState.lastSuccessAt, overlap);
    const fetchSince = updatedSince < lookbackIso ? lookbackIso : updatedSince;

    const listed = await listPullRequests(token, repo, fetchSince);
    quality.warnings.push(...listed.warnings);
    const hydrated = await hydratePullRequests(token, listed.nodes);
    quality.warnings.push(...hydrated.warnings);

    const comments = await listReviewComments(token, repo, fetchSince);
    attachCommentsToPrs(hydrated.prs, comments);

    const issues = await listIssues(token, repo, fetchSince);
    quality.warnings.push(...issues.warnings);

    const prRecords = hydrated.prs.map(toPrRecord);
    const reviewRecords = hydrated.prs.flatMap(toReviewRecords);

    if (mode === "full") {
      replaceRepoSlice(store.prs, repo, prRecords);
      replaceRepoSlice(store.issues, repo, issues.nodes.map(toIssueRecord));
      replaceRepoSlice(store.reviewComments, repo, comments);
      replaceReviewsForPrs(
        store.reviews,
        prRecords.map((p) => p.id),
        reviewRecords
      );
    } else {
      upsertById(store.prs, prRecords);
      upsertById(store.issues, issues.nodes.map(toIssueRecord));
      upsertById(store.reviewComments, comments);
      replaceReviewsForPrs(
        store.reviews,
        prRecords.map((p) => p.id),
        reviewRecords
      );
    }

    for (const p of prRecords) {
      if (p.author && p.mergedAt) noteFirstMerge(store.identities, p.author, p.mergedAt);
    }

    if (mode === "full" && rules.sync?.checksum_search !== false) {
      const search = await checksumSearch(token, repo, lookbackDate);
      const listedMerged = mergedInWindow(store, repo, lookbackIso);
      const listedIssues = issuesCreatedInWindow(store, repo, lookbackIso);
      const prDelta = search.merged == null ? 0 : search.merged - listedMerged;
      const issueDelta = search.issuesCreated == null ? 0 : search.issuesCreated - listedIssues;
      const row = {
        repo,
        search_merged: search.merged,
        listed_merged: listedMerged,
        search_issues_created: search.issuesCreated,
        listed_issues_created: listedIssues,
        pr_delta: prDelta,
        issue_delta: issueDelta,
      };
      quality.checksums.push(row);
      // Search lag can undercount. Search > listed means we missed rows.
      if (prDelta > 2 || issueDelta > 2) {
        quality.checksum_ok = false;
        quality.warnings.push(
          `${repo} checksum miss: search has ${prDelta} more merged PRs and ${issueDelta} more created issues than the listing`
        );
      } else if (prDelta > 0 || issueDelta > 0) {
        quality.warnings.push(
          `${repo} small checksum gap (PRs ${prDelta}, issues ${issueDelta}) — likely Search index lag`
        );
      }
      console.log(
        `    listed ${hydrated.prs.length} PRs touched, ${issues.nodes.length} issues touched, ${comments.length} inline comments; window merged=${listedMerged} (search=${search.merged}) issues-created=${listedIssues} (search=${search.issuesCreated})`
      );
    } else {
      console.log(
        `    listed ${hydrated.prs.length} PRs touched, ${issues.nodes.length} issues touched, ${comments.length} inline comments`
      );
    }

    store.state.repos = store.state.repos || {};
    store.state.repos[repo] = {
      lastSuccessAt: runStartedAt,
      lastMode: mode,
      nameWithOwner: meta.nameWithOwner,
    };
  }

  if (rules.sync?.fail_on_checksum_miss && !quality.checksum_ok) {
    throw new Error(`Checksum failed:\n${quality.warnings.join("\n")}`);
  }

  store.state.lastSuccessAt = runStartedAt;
  if (mode === "full") store.state.lastFullSyncAt = runStartedAt;
  store.state.lookback_days = lookbackDays;

  quality.event_counts = {
    prs: Object.keys(store.prs).length,
    issues: Object.keys(store.issues).length,
    reviews: Object.keys(store.reviews).length,
    review_comments: Object.keys(store.reviewComments).length,
  };

  if (storeDir) saveStore(storeDir, store);

  const activity = activityFromStore(store, lookbackIso);
  activity.quality = quality;
  activity.store = store;
  activity.repos = targetRepos;
  return activity;
}

export { loadStore, saveStore, rememberName };
