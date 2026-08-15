// -----------------------------------------------------------------------------
// notify-discord.mjs — Posts a daily leaderboard digest to a Discord channel
// via an Incoming Webhook. Read-only: reads the already-committed
// data/leaderboard.json (kept fresh by the hourly refresh workflow) and makes
// ONE outbound POST to the webhook URL. No bot token, no gateway connection,
// nothing to host — this is the whole integration.
//
// Env:
//   DISCORD_WEBHOOK_URL   the channel's Incoming Webhook URL (required)
//   SITE_URL              optional; linked at the bottom of the digest
// -----------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TOP_N = 10;

const MEDALS = ["🥇", "🥈", "🥉"];
function rankPrefix(i) {
  return MEDALS[i] || `**#${i + 1}**`;
}

function buildEmbed(data) {
  const days = data.windows_days?.[0] ?? 7;
  const ranked = [...data.leaderboard].sort(
    (a, b) => (b.windows?.[days] ?? b.rolling_total ?? 0) - (a.windows?.[days] ?? a.rolling_total ?? 0)
  );
  const top = ranked.slice(0, TOP_N);

  const lines = top.map((u, i) => {
    const pts = u.windows?.[days] ?? u.rolling_total ?? 0;
    const wb = u.windowBreakdown?.[days] || {};
    const split = `code ${wb.pr ?? 0} · reviews ${wb.review ?? 0} · issues ${wb.issue ?? 0}`;
    return `${rankPrefix(i)} **${u.login}** — ${pts} pts _(${split})_`;
  });

  const siteUrl = process.env.SITE_URL || "https://mantis-leaderboard.vercel.app";

  return {
    username: "Mantis Leaderboard",
    embeds: [
      {
        title: `🏆 Mantis Contributor Leaderboard — Past ${days} Days`,
        description: lines.join("\n") || "No activity yet this window.",
        color: 0x3346c4, // brand indigo
        url: siteUrl,
        footer: { text: `${data.repos?.length ?? "?"} repos · ${ranked.length} contributors` },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

async function main() {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) throw new Error("DISCORD_WEBHOOK_URL is required.");

  const data = JSON.parse(readFileSync(join(ROOT, "data/leaderboard.json"), "utf8"));
  const payload = buildEmbed(data);

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Discord webhook ${res.status}: ${await res.text()}`);
  }
  console.log(`Posted top ${Math.min(TOP_N, data.leaderboard.length)} to Discord.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
