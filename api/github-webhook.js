// POST /api/github-webhook
// Org/repo GitHub webhook → repository_dispatch on THIS leaderboard repo.
// The Actions job does the real incremental sync. This endpoint never talks
// to Mantis repos; it only wakes the existing workflow if it isn't already running.

import { createHmac, timingSafeEqual } from "node:crypto";

export const config = {
  api: { bodyParser: false },
};

function readRaw(req) {
  if (typeof req.body === "string") return Promise.resolve(req.body);
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString("utf8"));
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const INTERESTING = new Set([
  "ping",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "issues",
]);

function signOk(secret, rawBody, signature) {
  if (!secret || !signature || !signature.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function leaderboardBusy(token, repo) {
  const url = `https://api.github.com/repos/${repo}/actions/runs?per_page=10`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "mantis-leaderboard",
    },
  });
  if (!res.ok) return false;
  const json = await res.json();
  const active = (json.workflow_runs || []).filter(
    (r) =>
      (r.status === "queued" || r.status === "in_progress" || r.status === "pending") &&
      /leaderboard/i.test(r.name || r.path || "")
  );
  return active.length > 0;
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    res.status(200).json({ ok: true, hint: "GitHub webhook endpoint (POST)" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }

  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const dispatchToken = process.env.LEADERBOARD_DISPATCH_TOKEN;
  const repo =
    process.env.LEADERBOARD_REPO ||
    (process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
      ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
      : null);

  const event = req.headers["x-github-event"] || req.headers["X-GitHub-Event"];
  const signature = req.headers["x-hub-signature-256"] || req.headers["X-Hub-Signature-256"];
  const raw = await readRaw(req);

  if (!secret || !signOk(secret, raw, signature)) {
    res.status(401).json({ ok: false, error: "bad signature" });
    return;
  }

  if (!INTERESTING.has(String(event))) {
    res.status(202).json({ ok: true, skipped: true, reason: `ignored event ${event}` });
    return;
  }
  if (event === "ping") {
    res.status(200).json({ ok: true, pong: true });
    return;
  }

  if (!dispatchToken || !repo) {
    res.status(501).json({
      ok: false,
      error: "Dispatch not configured",
      hint: "Set LEADERBOARD_DISPATCH_TOKEN and LEADERBOARD_REPO on Vercel",
    });
    return;
  }

  if (await leaderboardBusy(dispatchToken, repo)) {
    res.status(202).json({ ok: true, skipped: true, reason: "workflow already running" });
    return;
  }

  let payload = {};
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    payload = {};
  }
  const srcRepo = payload.repository?.full_name || null;

  const dispatch = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${dispatchToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "mantis-leaderboard",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_type: "github-activity",
      client_payload: { github_event: event, repo: srcRepo, action: payload.action || null },
    }),
  });

  if (!dispatch.ok && dispatch.status !== 204) {
    res.status(502).json({ ok: false, error: `dispatch ${dispatch.status}: ${await dispatch.text()}` });
    return;
  }
  res.status(202).json({ ok: true, dispatched: true, repo: srcRepo, event });
}
