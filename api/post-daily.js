// /api/post-daily — cron endpoint that posts the leaderboard to Slack.
// Self-contained CommonJS function (no imports from other project files).

const DEFAULT_CHANNEL = "C0B2CQPFM4G";

const SEED_MONTH = "2026-05";
const SEEDS_AS_OF_TS = 1778044007;
const SEED_TOTALS = [
  { slackId: "U08SCMV3886", name: "Mark Holder",      count: 80 },
  { slackId: "U0CU3LV6U",   name: "Robert",           count: 900 },
  { slackId: "U07063Z2JAZ", name: "Marshall Sharpe",  count: 400 },
  { slackId: "U0CU4H9RD",   name: "Richard Sullivan", count: 510 },
  { slackId: "U0AQD7TR7MG", name: "Nate Cortés",      count: 255 },
  { slackId: "seed:gord",   name: "Gord Sharpe",      count: 400 }
];

const BOT_NAME_PATTERN = /^pushup\s+(leaderboard|challenge|bot)$/i;
const MEDALS = ["🥇", "🥈", "🥉"];
const BAR_WIDTH = 16;

function parsePushups(text) {
  const t = (text || "").trim();
  if (!t) return null;
  if (/has joined|has left/i.test(t)) return null;
  const plain = t.match(/^\s*(-?\d{1,4})\s*$/);
  if (plain) return parseInt(plain[1], 10);
  if (/\bpush[\s-]?ups?\b|\bpushup\b|\bpu\b/i.test(t)) {
    const n = t.match(/(?:^|[^\d])(-?\d{1,4})/);
    if (n) return parseInt(n[1], 10);
  }
  const start = t.match(/^\s*(-?\d{1,4})\b[^\d]{0,20}$/);
  if (start) return parseInt(start[1], 10);
  return null;
}

async function slackFetch(path, params, token) {
  const url = new URL("https://slack.com/api/" + path);
  for (const k of Object.keys(params)) {
    if (params[k] !== undefined && params[k] !== null) {
      url.searchParams.set(k, params[k]);
    }
  }
  const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  const data = await r.json();
  if (!data.ok) throw new Error("Slack API error: " + (data.error || "unknown"));
  return data;
}

async function fetchAllMessages(channel, token) {
  const messages = [];
  let cursor;
  for (let i = 0; i < 30; i++) {
    const data = await slackFetch(
      "conversations.history",
      { channel: channel, limit: 200, cursor: cursor },
      token
    );
    for (const m of (data.messages || [])) messages.push(m);
    cursor = data.response_metadata && data.response_metadata.next_cursor;
    if (!cursor) break;
  }
  return messages;
}

async function fetchUserNames(userIds, token) {
  const names = {};
  await Promise.all(userIds.map(async function (uid) {
    try {
      const d = await slackFetch("users.info", { user: uid }, token);
      const u = d.user || {};
      names[uid] = u.real_name ||
        (u.profile && u.profile.display_name) ||
        u.name || uid;
    } catch (e) {
      names[uid] = uid;
    }
  }));
  return names;
}

function rank(totals, names) {
  const out = [];
  for (const uid of Object.keys(totals)) {
    out.push({ name: names[uid] || uid, count: totals[uid] });
  }
  out.sort(function (a, b) { return b.count - a.count; });
  return out;
}

async function getLeaderboardData() {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID || DEFAULT_CHANNEL;
  if (!token) throw new Error("SLACK_BOT_TOKEN env var is not set");

  const now = new Date();
  const monthStartTs = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;

  const messages = await fetchAllMessages(channel, token);
  const userIdSet = {};
  for (const m of messages) if (m.user) userIdSet[m.user] = true;
  const userIds = Object.keys(userIdSet);
  const names = await fetchUserNames(userIds, token);

  const botUserIds = {};
  for (const uid of Object.keys(names)) {
    if (BOT_NAME_PATTERN.test(names[uid])) botUserIds[uid] = true;
  }

  const monthly = {};
  for (const m of messages) {
    if (!m.user || !m.text) continue;
    if (m.bot_id || m.app_id || m.subtype === "bot_message") continue;
    if (botUserIds[m.user]) continue;
    if (/pushup leaderboard\s*[—-]/i.test(m.text)) continue;
    const ts = parseFloat(m.ts);
    if (ts <= SEEDS_AS_OF_TS) continue;
    const n = parsePushups(m.text);
    if (n == null || n === 0 || Math.abs(n) > 5000) continue;
    if (ts >= monthStartTs) {
      monthly[m.user] = (monthly[m.user] || 0) + n;
    }
  }

  const currentMonthKey = now.getFullYear() + "-" +
    String(now.getMonth() + 1).padStart(2, "0");
  for (const s of SEED_TOTALS) {
    if (currentMonthKey === SEED_MONTH) {
      monthly[s.slackId] = (monthly[s.slackId] || 0) + s.count;
    }
    if (!names[s.slackId]) names[s.slackId] = s.name;
  }

  const lb = rank(monthly, names);
  let total = 0;
  for (const k of Object.keys(monthly)) total += monthly[k];

  return { channel: channel, leaderboard: lb, total: total };
}

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
    weekday: "long", month: "long", day: "numeric"
  });
  const lb = data.leaderboard;
  const max = lb.length > 0 ? Math.max.apply(null, lb.map(function (r) { return r.count; }).concat([1])) : 1;

  let table;
  if (lb.length === 0) {
    table = "_No pushups counted yet this month._";
  } else {
    const lines = lb.map(function (r, i) {
      const prefix = i < 3 ? MEDALS[i] : padLeft(String(i + 1) + ".", 3);
      const name = pad(r.name, 18);
      const count = padLeft(r.count.toLocaleString(), 5);
      const bar = makeBar(r.count, max);
      return prefix + " " + name + count + "  " + bar;
    });
    table = "```\n" + lines.join("\n") + "\n```";
  }

  const top = lb[0];
  return [
    { type: "header", text: { type: "plain_text", text: "🏋️ Pushup Leaderboard — " + today, emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: "Total this month: *" + data.total.toLocaleString() + "* pushups · Top: *" + (top ? top.name : "—") + "*" } },
    { type: "section", text: { type: "mrkdwn", text: table } },
    { type: "context", elements: [{ type: "mrkdwn", text: "Post your number in this channel to add to your total. Use a negative number (e.g. `-10`) to subtract." }] }
  ];
}

async function postToSlack(channel, blocks, token, fallbackText) {
  const r = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: "Bearer " + token
    },
    body: JSON.stringify({
      channel: channel,
      blocks: blocks,
      text: fallbackText,
      unfurl_links: false,
      unfurl_media: false
    })
  });
  const data = await r.json();
  if (!data.ok) throw new Error("Slack post failed: " + (data.error || "unknown"));
  return data;
}

module.exports = async function handler(req, res) {
  // Require Vercel's CRON_SECRET to prevent unauthorized triggers (if set)
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
    const top = data.leaderboard[0];
    const fallback = top
      ? "Pushup standings — " + top.name + " leads with " + top.count
      : "Pushup standings — no posts yet";
    const result = await postToSlack(channel, blocks, token, fallback);
    res.status(200).json({ ok: true, ts: result.ts });
  } catch (e) {
    res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
