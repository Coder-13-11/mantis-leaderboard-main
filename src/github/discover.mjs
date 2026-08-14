// Discover org repos the token can see, then union with the explicit config list.
// Fine-grained PATs scoped to "selected repos" will only return those — discovery
// of brand-new Mantis repos requires All-repository read access.

import { graphql } from "./client.mjs";

function compilePatterns(patterns) {
  return (patterns || []).map((p) => {
    try {
      return new RegExp(p);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

export function repoMatchesDiscovery(nameWithOwner, cfg) {
  const name = String(nameWithOwner).split("/")[1] || "";
  const exclude = new Set((cfg.exclude || []).map((r) => r.toLowerCase()));
  if (exclude.has(String(nameWithOwner).toLowerCase())) return false;
  const pats = compilePatterns(cfg.include_patterns || cfg.name_patterns || []);
  if (!pats.length) return false;
  return pats.some((re) => re.test(name) || re.test(nameWithOwner));
}

export async function discoverOrgRepos(token, org, cfg = {}) {
  if (!org || cfg.enabled === false) return { repos: [], warnings: [] };
  const warnings = [];
  const found = [];
  const query = `
    query($login: String!, $cursor: String) {
      organization(login: $login) {
        repositories(first: 100, after: $cursor, orderBy: {field: NAME, direction: ASC}) {
          pageInfo { hasNextPage endCursor }
          nodes { nameWithOwner isArchived isFork }
        }
      }
      rateLimit { remaining resetAt }
    }`;
  let cursor = null;
  try {
    do {
      const data = await graphql(token, query, { login: org, cursor });
      const conn = data?.organization?.repositories;
      if (!data?.organization) {
        warnings.push(
          `org ${org} not visible to this token — discovery skipped (using config.repos only)`
        );
        return { repos: [], warnings };
      }
      for (const n of conn.nodes || []) {
        if (!n?.nameWithOwner) continue;
        if (n.isArchived && cfg.include_archived !== true) continue;
        if (n.isFork && cfg.include_forks !== true) continue;
        if (repoMatchesDiscovery(n.nameWithOwner, cfg)) found.push(n.nameWithOwner);
      }
      cursor = conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
    } while (cursor);
  } catch (err) {
    warnings.push(`repo discovery failed: ${err.message}`);
    return { repos: [], warnings };
  }
  return { repos: found, warnings };
}

export function mergeRepoLists(configured, discovered, extra = []) {
  const out = [];
  const seen = new Set();
  for (const r of [...(configured || []), ...(discovered || []), ...extra]) {
    const key = String(r).trim();
    if (!key) continue;
    const id = key.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(key);
  }
  return out;
}
