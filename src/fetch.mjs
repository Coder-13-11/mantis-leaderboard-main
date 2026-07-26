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

// `files` and `reviews` each only fetch one page inline (100 items). That
// covers the overwhelming majority of PRs, but a very active PR (lots of
// files touched, or lots of re-review rounds) can have more than that -- so
// each connection's pageInfo comes along too, and fetchActivity() below
// follows up with extra paginated requests for any PR that actually needs
// them. Silently truncating past 100 previously undercounted reviews (and
// misjudged PR size) on those PRs without any way to tell it had happened.
const PR_FIELDS = `
  ... on PullRequest {
    id
    number
    title
    additions
    deletions
    mergedAt
    baseRefName
    author { login }
    repository { nameWithOwner }
    labels(first: 20) { nodes { name } }
    files(first: 100) {
      pageInfo { hasNextPage endCursor }
      nodes { path }
    }
    reviews(first: 100) {
      pageInfo { hasNextPage endCursor }
      nodes {
        state
        body
        submittedAt
        author { login }
      }
    }
  }`;

// Follow-up pagination for a single PR's `files` or `reviews` connection,
// for the rare PR whose inline first page (100) wasn't everything. Keeps
// pulling pages via `node(id:)` until exhausted, then hands back every node.
async function paginateConnection(token, prId, connection, selection, startCursor) {
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
    }`;
  let cursor = startCursor;
  const out = [];
  let hasNext = true;
  while (hasNext) {
    const data = await graphql(token, query, { id: prId, cursor });
    const conn = data.node[connection];
    out.push(...conn.nodes);
    hasNext = conn.pageInfo.hasNextPage;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}

// Top off any PR whose inline `files`/`reviews` page was incomplete, so
// nothing gets silently dropped just because a PR was unusually large or
// unusually re-reviewed.
async function completeTruncatedConnections(token, pullRequests) {
  for (const p of pullRequests) {
    if (p.files?.pageInfo?.hasNextPage) {
      const rest = await paginateConnection(token, p.id, "files", "path", p.files.pageInfo.endCursor);
      p.files.nodes.push(...rest);
    }
    if (p.reviews?.pageInfo?.hasNextPage) {
      const rest = await paginateConnection(
        token,
        p.id,
        "reviews",
        "state body submittedAt author { login }",
        p.reviews.pageInfo.endCursor
      );
      p.reviews.nodes.push(...rest);
    }
  }
}

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

  await completeTruncatedConnections(token, pullRequests);

  return { pullRequests, issues, since };
}
