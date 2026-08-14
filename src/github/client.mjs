// GitHub GraphQL + REST client. Read-only. Retries gateway timeouts and waits
// out primary rate limits instead of dying mid-sync.

import { sleep } from "../util.mjs";

const GQL = "https://api.github.com/graphql";
const REST = "https://api.github.com";
const UA = "mantis-leaderboard";

export class GitHubError extends Error {
  constructor(message, { status, retryable = false } = {}) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
    this.retryable = retryable;
  }
}

function authHeaders(token, extra = {}) {
  return {
    Authorization: `bearer ${token}`,
    "User-Agent": UA,
    Accept: "application/vnd.github+json",
    ...extra,
  };
}

async function waitForReset(res, attempt) {
  const retryAfter = Number(res.headers.get("retry-after"));
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  let ms = 0;
  if (Number.isFinite(retryAfter) && retryAfter > 0) ms = retryAfter * 1000;
  else if (Number.isFinite(reset)) ms = Math.max(0, reset * 1000 - Date.now());
  else ms = attempt * 4000;
  ms = Math.min(Math.max(ms, 2000), 90_000);
  console.warn(`  GitHub rate-limited (HTTP ${res.status}); waiting ${Math.ceil(ms / 1000)}s`);
  await sleep(ms);
}

export async function graphql(token, query, variables = {}, attempt = 1) {
  const res = await fetch(GQL, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ query, variables }),
  });

  if (res.status === 502 || res.status === 503 || res.status === 504) {
    if (attempt < 5) {
      await sleep(attempt * 3000);
      return graphql(token, query, variables, attempt + 1);
    }
    throw new GitHubError(`GitHub gateway ${res.status}: ${await res.text()}`, {
      status: res.status,
      retryable: true,
    });
  }

  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (attempt < 6 && (remaining === "0" || res.status === 429)) {
      await waitForReset(res, attempt);
      return graphql(token, query, variables, attempt + 1);
    }
  }

  if (!res.ok) {
    throw new GitHubError(`GitHub API ${res.status}: ${await res.text()}`, { status: res.status });
  }

  const json = await res.json();
  const remaining = json?.data?.rateLimit?.remaining;
  const resetAt = json?.data?.rateLimit?.resetAt;
  if (Number.isFinite(remaining) && remaining < 80 && resetAt) {
    const wait = Date.parse(resetAt) - Date.now() + 1500;
    if (wait > 0 && wait < 95_000) {
      console.warn(`  GraphQL remaining=${remaining}; waiting for reset`);
      await sleep(wait);
    }
  }

  if (json.errors?.length) {
    const fatal = json.errors.filter((e) => e.type !== "NOT_FOUND" && e.type !== "FORBIDDEN");
    if (fatal.length && !json.data) {
      const timeout = fatal.some((e) => /timeout|something went wrong/i.test(e.message || ""));
      if (timeout && attempt < 4) {
        await sleep(attempt * 3000);
        return graphql(token, query, variables, attempt + 1);
      }
      throw new GitHubError(`GraphQL errors: ${JSON.stringify(fatal)}`, { retryable: timeout });
    }
    if (fatal.length && json.data) {
      // Partial data — caller decides. Keep going unless it's a timeout with empty search.
      const timeout = fatal.some((e) => /timeout/i.test(e.message || ""));
      if (timeout && attempt < 4) {
        await sleep(attempt * 3000);
        return graphql(token, query, variables, attempt + 1);
      }
    }
  }
  return json.data;
}

export async function rest(token, pathOrUrl, attempt = 1) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${REST}${pathOrUrl}`;
  const res = await fetch(url, { headers: authHeaders(token) });

  if (res.status === 502 || res.status === 503 || res.status === 504) {
    if (attempt < 5) {
      await sleep(attempt * 3000);
      return rest(token, pathOrUrl, attempt + 1);
    }
    throw new GitHubError(`GitHub REST gateway ${res.status}`, { status: res.status, retryable: true });
  }

  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (attempt < 6 && (remaining === "0" || res.status === 429)) {
      await waitForReset(res, attempt);
      return rest(token, pathOrUrl, attempt + 1);
    }
  }

  if (!res.ok) {
    throw new GitHubError(`GitHub REST ${res.status}: ${await res.text()}`, { status: res.status });
  }

  const json = await res.json();
  return { json, headers: res.headers };
}

/** Paginate a REST list endpoint that uses Link: rel="next". */
export async function restPaginate(token, path, { onPage } = {}) {
  const { parseLinkNext } = await import("../util.mjs");
  const out = [];
  let url = path;
  while (url) {
    const { json, headers } = await rest(token, url);
    const batch = Array.isArray(json) ? json : [];
    out.push(...batch);
    if (onPage) onPage(batch, out.length);
    const next = parseLinkNext(headers.get("link"));
    url = next;
  }
  return out;
}
