// List activity from repository connections (not Search). Search is used only
// as a checksum of issueCount — it cannot retrieve more than 1,000 hits, but
// it still reports how many matches exist.

import { graphql, restPaginate } from "./client.mjs";
import { pageWatermark, parsePullNumberFromUrl, splitRepo } from "../util.mjs";

const PR_LIST_FIELDS = `
  id
  databaseId
  number
  title
  state
  additions
  deletions
  changedFiles
  mergedAt
  closedAt
  createdAt
  updatedAt
  baseRefName
  author { login }
  mergedBy { login }
  labels(first: 20) { nodes { name } }
`;

const ISSUE_LIST_FIELDS = `
  id
  databaseId
  number
  title
  state
  closed
  closedAt
  stateReason
  createdAt
  updatedAt
  author { login }
  labels(first: 20) { nodes { name } }
`;

async function paginateRepoConnection(token, { owner, name }, connection, extraArgs, nodeFields, sinceIso) {
  const query = `
    query($owner: String!, $name: String!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        nameWithOwner
        ${connection}(${extraArgs}, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { ${nodeFields} }
        }
      }
      rateLimit { remaining resetAt }
    }`;
  const out = [];
  let cursor = null;
  let pages = 0;
  const warnings = [];
  do {
    const data = await graphql(token, query, { owner, name, cursor });
    const repo = data?.repository;
    if (!repo) {
      throw new Error(`repository ${owner}/${name} not visible to this token (null). Check ORG_READ_TOKEN scope.`);
    }
    const conn = repo[connection];
    const nodes = (conn.nodes || []).filter(Boolean);
    pages += 1;
    const { keep, done, monotonic } = pageWatermark(nodes, sinceIso, "updatedAt");
    if (!monotonic) {
      warnings.push(`${owner}/${name} ${connection} page ${pages} not UPDATED_AT-monotonic; not stopping early`);
      out.push(...nodes.filter((n) => n.updatedAt && n.updatedAt >= sinceIso));
      cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
      continue;
    }
    out.push(...keep);
    if (done) break;
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);
  return { nodes: out, warnings, pages };
}

export async function assertRepoVisible(token, repo) {
  const { owner, name } = splitRepo(repo);
  const data = await graphql(
    token,
    `query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        nameWithOwner
        isArchived
        pullRequests { totalCount }
        issues { totalCount }
      }
      rateLimit { remaining resetAt }
    }`,
    { owner, name }
  );
  if (!data?.repository) {
    throw new Error(`Configured repo ${repo} is invisible to ORG_READ_TOKEN — refusing to treat that as zero activity.`);
  }
  return data.repository;
}

export async function listPullRequests(token, repo, sinceIso) {
  const { owner, name } = splitRepo(repo);
  const warnings = [];
  const merged = await paginateRepoConnection(
    token,
    { owner, name },
    "pullRequests",
    "first: 50, states: [MERGED], orderBy: {field: UPDATED_AT, direction: DESC}",
    PR_LIST_FIELDS,
    sinceIso
  );
  const open = await paginateRepoConnection(
    token,
    { owner, name },
    "pullRequests",
    "first: 50, states: [OPEN], orderBy: {field: UPDATED_AT, direction: DESC}",
    PR_LIST_FIELDS,
    sinceIso
  );
  const closed = await paginateRepoConnection(
    token,
    { owner, name },
    "pullRequests",
    "first: 50, states: [CLOSED], orderBy: {field: UPDATED_AT, direction: DESC}",
    PR_LIST_FIELDS,
    sinceIso
  );
  warnings.push(...merged.warnings, ...open.warnings, ...closed.warnings);
  const byId = new Map();
  for (const n of [...merged.nodes, ...open.nodes, ...closed.nodes]) {
    if (n?.id) byId.set(n.id, { ...n, repo, repository: { nameWithOwner: repo } });
  }
  return { nodes: [...byId.values()], warnings };
}

export async function listIssues(token, repo, sinceIso) {
  const { owner, name } = splitRepo(repo);
  const query = `
    query($owner: String!, $name: String!, $cursor: String, $since: DateTime) {
      repository(owner: $owner, name: $name) {
        nameWithOwner
        issues(
          first: 50
          states: [OPEN, CLOSED]
          filterBy: { since: $since }
          orderBy: { field: UPDATED_AT, direction: DESC }
          after: $cursor
        ) {
          pageInfo { hasNextPage endCursor }
          nodes { ${ISSUE_LIST_FIELDS} }
        }
      }
      rateLimit { remaining resetAt }
    }`;
  const nodes = [];
  let cursor = null;
  do {
    const data = await graphql(token, query, { owner, name, cursor, since: sinceIso });
    if (!data?.repository) {
      throw new Error(`repository ${repo} not visible to this token (null). Check ORG_READ_TOKEN scope.`);
    }
    const conn = data.repository.issues;
    for (const n of conn.nodes || []) {
      if (n?.id) nodes.push({ ...n, repo, repository: { nameWithOwner: repo } });
    }
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);
  await hydrateIssueClosers(token, nodes);
  return { nodes, warnings: [] };
}

// Pulls the close actor AND who applied each label, for closed issues only.
//
// The label actor matters because severity labels are only trustworthy when
// somebody other than the filer applied them: measured across Mantis +
// MantisAPI, 44 of 55 `diff:N` labelling events were the issue's own author
// labelling their own ticket. Scoring a self-applied severity label would let
// people set their own payout. Both event types come back in one query on the
// same chunks, so this costs no extra round trips.
async function hydrateIssueClosers(token, issues) {
  const closed = issues.filter((i) => i.closed || i.state === "CLOSED");
  const query = `
    query($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Issue {
          id
          timelineItems(last: 5, itemTypes: [CLOSED_EVENT]) {
            nodes {
              ... on ClosedEvent {
                createdAt
                actor { login }
              }
            }
          }
          labelEvents: timelineItems(first: 60, itemTypes: [LABELED_EVENT]) {
            nodes {
              ... on LabeledEvent {
                actor { login }
                label { name }
              }
            }
          }
        }
      }
      rateLimit { remaining resetAt }
    }`;
  for (let i = 0; i < closed.length; i += 20) {
    const chunk = closed.slice(i, i + 20);
    const data = await graphql(token, query, { ids: chunk.map((x) => x.id) });
    const byId = new Map((data?.nodes || []).filter(Boolean).map((n) => [n.id, n]));
    for (const issue of chunk) {
      const node = byId.get(issue.id);
      const events = node?.timelineItems?.nodes || [];
      const last = [...events].reverse().find((e) => e?.actor || e?.createdAt) || events[events.length - 1];
      issue.closedBy = last?.actor?.login || null;

      // label name (lowercased) -> login that applied it. Last writer wins.
      const actors = {};
      for (const e of node?.labelEvents?.nodes || []) {
        const name = e?.label?.name;
        if (name) actors[String(name).toLowerCase()] = e?.actor?.login || null;
      }
      issue.labelActors = actors;
    }
  }
}

const HYDRATE_FIELDS = `
  ... on PullRequest {
    id
    files(first: 100) {
      pageInfo { hasNextPage endCursor }
      nodes { path additions deletions }
    }
    reviews(first: 100) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        state
        body
        submittedAt
        author { login }
      }
    }
    commits(first: 80) {
      pageInfo { hasNextPage endCursor }
      nodes {
        commit {
          authors(first: 12) {
            nodes { user { login } }
          }
        }
      }
    }
  }`;

async function paginatePrConnection(token, prId, connection, selection, startCursor) {
  const query = `
    query($id: ID!, $cursor: String) {
      node(id: $id) {
        ... on PullRequest {
          ${connection}(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes { ${selection} }
          }
        }
      }
      rateLimit { remaining resetAt }
    }`;
  let cursor = startCursor;
  const out = [];
  let hasNext = true;
  while (hasNext) {
    const data = await graphql(token, query, { id: prId, cursor });
    const conn = data?.node?.[connection];
    if (!conn) break;
    out.push(...(conn.nodes || []).filter(Boolean));
    hasNext = conn.pageInfo.hasNextPage;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}

async function hydrateBatch(token, ids) {
  const query = `
    query($ids: [ID!]!) {
      nodes(ids: $ids) { ${HYDRATE_FIELDS} }
      rateLimit { remaining resetAt }
    }`;
  const data = await graphql(token, query, { ids });
  return (data?.nodes || []).filter(Boolean);
}

export async function hydratePullRequests(token, prs, { batchSize = 8 } = {}) {
  const warnings = [];
  const byId = new Map(prs.map((p) => [p.id, p]));
  const ids = prs.map((p) => p.id).filter(Boolean);
  for (let i = 0; i < ids.length; i += batchSize) {
    const chunk = ids.slice(i, i + batchSize);
    let nodes;
    try {
      nodes = await hydrateBatch(token, chunk);
    } catch (err) {
      if (chunk.length > 1) {
        console.warn(`  hydrate batch failed (${err.message}); retrying one-by-one`);
        nodes = [];
        for (const id of chunk) {
          try {
            nodes.push(...(await hydrateBatch(token, [id])));
          } catch (inner) {
            warnings.push(`hydrate failed for ${id}: ${inner.message}`);
          }
        }
      } else {
        warnings.push(`hydrate failed for ${chunk[0]}: ${err.message}`);
        continue;
      }
    }
    for (const n of nodes) {
      const p = byId.get(n.id);
      if (!p) continue;
      let files = n.files?.nodes || [];
      if (n.files?.pageInfo?.hasNextPage) {
        files = files.concat(
          await paginatePrConnection(token, n.id, "files", "path additions deletions", n.files.pageInfo.endCursor)
        );
      }
      let reviews = n.reviews?.nodes || [];
      if (n.reviews?.pageInfo?.hasNextPage) {
        reviews = reviews.concat(
          await paginatePrConnection(
            token,
            n.id,
            "reviews",
            "id state body submittedAt author { login }",
            n.reviews.pageInfo.endCursor
          )
        );
      }
      let commitNodes = n.commits?.nodes || [];
      if (n.commits?.pageInfo?.hasNextPage) {
        commitNodes = commitNodes.concat(
          await paginatePrConnection(
            token,
            n.id,
            "commits",
            "commit { authors(first: 12) { nodes { user { login } } } }",
            n.commits.pageInfo.endCursor
          )
        );
      }
      const coauthors = new Set();
      for (const c of commitNodes) {
        for (const a of c?.commit?.authors?.nodes || []) {
          const login = a?.user?.login;
          if (login && login !== p.author?.login) coauthors.add(login);
        }
      }
      p.files = { nodes: files };
      p.reviews = { nodes: reviews };
      p.coauthors = [...coauthors];
      p.filesTruncated = Boolean(p.changedFiles && files.length < p.changedFiles);
      if (p.filesTruncated) {
        warnings.push(
          `${p.repo}#${p.number} files truncated (${files.length}/${p.changedFiles}) — GitHub caps file lists`
        );
      }
    }
  }
  return { prs: [...byId.values()], warnings };
}

export async function listReviewComments(token, repo, sinceIso) {
  const { owner, name } = splitRepo(repo);
  const path = `/repos/${owner}/${name}/pulls/comments?since=${encodeURIComponent(sinceIso)}&per_page=100`;
  const raw = await restPaginate(token, path);
  return raw.map((c) => {
    const number = parsePullNumberFromUrl(c.pull_request_url);
    return {
      id: c.node_id || `rest:${c.id}`,
      restId: c.id,
      repo,
      number,
      prId: null,
      author: c.user?.login || null,
      bodyLength: (c.body || "").trim().length,
      createdAt: c.created_at,
      reviewRestId: c.pull_request_review_id || null,
    };
  });
}

export async function checksumSearch(token, repo, sinceDate) {
  const qMerged = `repo:${repo} is:pr is:merged merged:>=${sinceDate}`;
  const qIssues = `repo:${repo} is:issue created:>=${sinceDate}`;
  const data = await graphql(
    token,
    `query($qMerged: String!, $qIssues: String!) {
      merged: search(query: $qMerged, type: ISSUE, first: 1) { issueCount }
      issues: search(query: $qIssues, type: ISSUE, first: 1) { issueCount }
      rateLimit { remaining resetAt }
    }`,
    { qMerged, qIssues }
  );
  return {
    merged: data?.merged?.issueCount ?? null,
    issuesCreated: data?.issues?.issueCount ?? null,
  };
}

export function attachCommentsToPrs(prs, comments) {
  const byKey = new Map();
  for (const p of prs) {
    byKey.set(`${p.repo}#${p.number}`, p);
    if (p.id) byKey.set(p.id, p);
  }
  for (const c of comments) {
    const p = byKey.get(`${c.repo}#${c.number}`);
    if (p) c.prId = p.id;
  }
}
