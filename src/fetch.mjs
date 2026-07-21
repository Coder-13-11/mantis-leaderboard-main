// -----------------------------------------------------------------------------
// fetch.mjs — READ-ONLY data collection from the GitHub GraphQL API.
//
// This module NEVER writes to any repo. It only runs `search` queries to
// collect merged PRs (with their reviews) and issues across the tracked repos.
// -----------------------------------------------------------------------------

const GQL = "https://api.github.com/graphql";

// GitHub's API gateway occasionally times out on heavier queries (returns a
// 5xx with an HTML error page instead of JSON). Retry those a couple times
// with backoff instead of failing the whole run.
async function graphql(token, query, variables, attempt = 1) {
  const res = await fetch(GQL, {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "mantis-leaderboard",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    if (res.status >= 500 && attempt < 3) {
      await new Promise((r) => setTimeout(r, attempt * 3000));
      return graphql(token, query, variables, attempt + 1);
    }
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// Paginate any `search` query. `searchQuery` is a GitHub search string.
// `pageSize` is deliberately small for the PR query below: each PR node also
// pulls its files + reviews, so a big page size multiplies into a query
// heavy enough to trip GitHub's gateway timeout (seen in practice).
async function searchAll(token, searchQuery, nodeFields, pageSize = 50) {
  const query = `
    query($q: String!, $cursor: String) {
      search(query: $q, type: ISSUE, first: ${pageSize}, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { ${nodeFields} }
      }
      rateLimit { remaining }
    }`;
  let cursor = null;
  const out = [];
  do {
    const data = await graphql(token, query, { q: searchQuery, cursor });
    out.push(...data.search.nodes);
    cursor = data.search.pageInfo.hasNextPage ? data.search.pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

const PR_FIELDS = `
  ... on PullRequest {
    number
    title
    additions
    deletions
    mergedAt
    baseRefName
    author { login }
    repository { nameWithOwner }
    labels(first: 20) { nodes { name } }
    files(first: 50) { nodes { path } }
    reviews(first: 20) {
      nodes {
        state
        body
        submittedAt
        author { login }
      }
    }
  }`;

const ISSUE_FIELDS = `
  ... on Issue {
    number
    title
    state
    closed
    closedAt
    stateReason
    createdAt
    author { login }
    repository { nameWithOwner }
    labels(first: 20) { nodes { name } }
  }`;

// Fetch everything the scorer needs, one repo at a time so each search query
// stays short (GitHub's search API caps query length; a single query listing
// 15 repos would blow past that). Returns { pullRequests, issues }.
export async function fetchActivity(token, repos, lookbackDays) {
  const since = new Date(Date.now() - lookbackDays * 86400_000)
    .toISOString()
    .slice(0, 10);

  const pullRequests = [];
  const issues = [];
  for (const repo of repos) {
    pullRequests.push(
      ...(await searchAll(token, `repo:${repo} is:pr is:merged merged:>=${since}`, PR_FIELDS, 15))
    );
    issues.push(
      ...(await searchAll(token, `repo:${repo} is:issue created:>=${since}`, ISSUE_FIELDS))
    );
  }

  return { pullRequests, issues, since };
}
