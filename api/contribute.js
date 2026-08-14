// POST /api/contribute
// Forwards a contribution payload to CONTRIBUTE_WEBHOOK_URL (Vercel env).
// Wire that to Discord / Slack / n8n / your own API.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const login = String(body.login || "").trim().replace(/^@/, "");
  if (!login) {
    res.status(400).json({ ok: false, error: "login is required" });
    return;
  }

  const payload = {
    login,
    type: body.type || "other",
    points: Number.isFinite(Number(body.points)) ? Number(body.points) : null,
    description: String(body.description || "").trim(),
    date: body.date || new Date().toISOString().slice(0, 10),
    source: String(body.source || "").trim() || null,
    submitted_at: new Date().toISOString(),
  };

  const url = process.env.CONTRIBUTE_WEBHOOK_URL;
  if (!url) {
    res.status(501).json({
      ok: false,
      error: "Backend not connected",
      hint: "Set CONTRIBUTE_WEBHOOK_URL in Vercel project env, or set window.MANTIS_CONTRIBUTE_URL in site/config.js",
      received: payload,
    });
    return;
  }

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await upstream.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* keep text */
    }
    if (!upstream.ok) {
      res.status(502).json({ ok: false, error: "Upstream failed", status: upstream.status, data });
      return;
    }
    res.status(200).json({ ok: true, payload, upstream: data });
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}
