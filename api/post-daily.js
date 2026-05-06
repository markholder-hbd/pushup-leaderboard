// Vercel cron endpoint: posts a formatted leaderboard message to Slack.
// Triggered daily by the cron schedule in vercel.json.
//
// Env vars required:
//   SLACK_BOT_TOKEN   xoxb-...  (must include the chat:write scope now)
//   SLACK_CHANNEL_ID  e.g. C0B2CQPFM4G
//   CRON_SECRET       random string; Vercel sends it in the Authorization header

import { getLeaderboardData, DEFAULT_CHANNEL } from "../lib/leaderboard.js";

const MEDALS = ["🥇", "🥈", "🥉"];
const BAR_WIDTH = 16;

function pad(s, w) {
  s = String(s);
  if (s.length >= w) return s.slice(0, w);
  return s + " ".repeat(w - s.length);
}

function padLeft(s, w) {
  s = String(s);
  return s.length >= w ? s : " ".repeat(w - s.length) + s;
}

function makeBar(count, max) {
  if (count <= 0 || max <= 0) return "░".repeat(BAR_WIDTH);
  const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round((count / max) * BAR_WIDTH)));
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

function buildBlocks(data) {
  const today = new Date().toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const lb = data.monthly.leaderboard;
  const max = lb.length > 0 ? Math.max(...lb.map((r) => r.count), 1) : 1;

  let table;
  if (lb.length === 0) {
    table = "_No pushups counted yet this month._";
  } else {
    const lines = lb.map((r, i) => {
      const prefix = i < 3 ? MEDALS[i] : padLeft(String(i + 1) + ".", 3);
      const name = pad(r.name, 18);
      const count = padLeft(r.count.toLocaleString(), 5);
      const bar = makeBar(r.count, max);
      return `${prefix} ${name}${count}  ${bar}`;
    });
    table = "```\n" + lines.join("\n") + "\n```";
  }

  return [
    {
      type: "header",
      text: { type: "plain_text", text: `🏋️ Pushup Leaderboard — ${today}`, emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Total this month: *${data.monthly.total.toLocaleString()}* pushups · Top: *${
          lb[0]?.name || "—"
        }*`,
      },
    },
    { type: "section", text: { type: "mrkdwn", text: table } },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            "Post your number in this channel to add to your total. Use a negative number (e.g. `-10`) to subtract.",
        },
      ],
    },
  ];
}

async function postToSlack(channel, blocks, token, fallbackText) {
  const r = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({
      channel,
      blocks,
      text: fallbackText, // shown in notifications
      unfurl_links: false,
      unfurl_media: false,
    }),
  });
  const data = await r.json();
  if (!data.ok) {
    const err = new Error("Slack post failed: " + (data.error || "unknown"));
    err.slackError = data.error;
    throw err;
  }
  return data;
}

export default async function handler(req, res) {
  // Require Vercel's CRON_SECRET to prevent unauthorized triggers.
  // Vercel automatically sends this header on cron-invoked requests.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization || "";
    if (auth !== "Bearer " + secret) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }

  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID || DEFAULT_CHANNEL;
  if (!token) {
    res.status(500).json({ error: "SLACK_BOT_TOKEN env var is not set" });
    return;
  }

  try {
    const data = await getLeaderboardData();
    const blocks = buildBlocks(data);
    const top = data.monthly.leaderboard[0];
    const fallback = top
      ? `Pushup Leaderboard — ${top.name} leads with ${top.count}`
      : "Pushup Leaderboard — no posts yet";

    const result = await postToSlack(channel, blocks, token, fallback);
    res.status(200).json({ ok: true, ts: result.ts });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}
