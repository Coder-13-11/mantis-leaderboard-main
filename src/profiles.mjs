// -----------------------------------------------------------------------------
// profiles.mjs — Resolve human display names for GitHub logins.
//
// Uses the GraphQL API when a token is available (batched), falling back to
// the public REST users endpoint. Each user gets `name` (string | null).
// -----------------------------------------------------------------------------

const GQL = "https://api.github.com/graphql";
const REST = "https://api.github.com";

async function graphql(token, query) {
  const res = await fetch(GQL, {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "mantis-leaderboard",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data;
}

// Batch GraphQL with aliases, 40 at a time (keeps the query under size limits).
async function fetchBatchGraphql(token, logins) {
  const out = {};
  const chunkSize = 40;
  for (let i = 0; i < logins.length; i += chunkSize) {
    const chunk = logins.slice(i, i + chunkSize);
    const fields = chunk
      .map((login, idx) => {
        const safe = login.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        return `u${idx}: user(login: "${safe}") { login name }`;
      })
      .join("\n");
    try {
      const data = await graphql(token, `query {\n${fields}\n}`);
      for (const node of Object.values(data || {})) {
        if (node?.login) out[node.login] = (node.name || "").trim() || null;
      }
    } catch (err) {
      console.warn(`  profile batch failed, falling back to REST: ${err.message}`);
      Object.assign(out, await fetchBatchRest(chunk));
    }
  }
  return out;
}

async function fetchBatchRest(logins) {
  const out = {};
  // Gentle sequential fetch so unauthenticated rate limits don't vanish.
  // Space requests ~120ms apart and stop early on a 403 rate-limit so we
  // don't stomp previously resolved names for everyone.
  for (const login of logins) {
    try {
      const res = await fetch(`${REST}/users/${encodeURIComponent(login)}`, {
        headers: { "User-Agent": "mantis-leaderboard", Accept: "application/vnd.github+json" },
      });
      if (res.status === 403 || res.status === 429) {
        console.warn(`  REST rate limited at @${login}; keeping remaining names unresolved`);
        break;
      }
      if (!res.ok) {
        // Don't set null on hard 404s? User gone — no name.
        out[login] = null;
        continue;
      }
      const json = await res.json();
      out[login] = (json.name || "").trim() || null;
    } catch {
      // Network blip — omit key so existing names are preserved
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}

/**
 * Attach `name` (full name, or null when GitHub has none) to each ranked user.
 * Mutates and returns the same array. Preserves an existing `name` when the
 * network lookup fails or is rate-limited so a partial refresh can't wipe
 * previously resolved names.
 */
export async function enrichUserNames(users, token) {
  if (!users?.length) return users;
  const logins = users.map((u) => u.login).filter(Boolean);
  let map = {};
  if (token) {
    map = await fetchBatchGraphql(token, logins);
  } else {
    console.warn("  no token for profiles — trying public REST (rate-limited)");
    map = await fetchBatchRest(logins);
  }
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w]/g, "");

  for (const u of users) {
    const fetched = Object.prototype.hasOwnProperty.call(map, u.login) ? map[u.login] : undefined;
    // undefined = lookup never returned this login (network / rate limit);
    // null     = GitHub has no public name.
    let name = fetched;
    if (fetched === undefined && u.name) name = u.name;

    if (name && norm(name) !== norm(u.login)) {
      u.name = name;
    } else if (fetched === null || (name && norm(name) === norm(u.login))) {
      u.name = null;
    } else if (!u.name) {
      u.name = null;
    }
    // else: leave existing u.name as-is when fetch was a miss
  }
  return users;
}
