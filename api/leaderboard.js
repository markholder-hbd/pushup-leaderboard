// /api/leaderboard — returns JSON leaderboard data.
// Self-contained CommonJS function (no imports from other project files).

const DEFAULT_CHANNEL = "C0B2CQPFM4G";

// --- Starting totals ------------------------------------------------------
// Each entry is the person's CURRENT total as of SEEDS_AS_OF_TS.
// Slack messages posted at or before that timestamp are ignored. Slack
// messages posted AFTER add to these totals.
const SEED_MONTH = "2026-05";
const SEEDS_AS_OF_TS = 1778044007; // 2026-05-06 05:06 UTC
const SEED_TOTALS = [
  { slackId: "U08SCMV3886", name: "Mark Holder",      count: 80 },
  { slackId: "U0CU3LV6U",   name: "Robert",           count: 900 },
  { slackId: "U07063Z2JAZ", name: "Marshall Sharpe",  count: 400 },
  { slackId: "U0CU4H9RD",   name: "Richard Sullivan", count: 510 },
  { slackId: "U0AQD7TR7MG", name: "Nate Cortés",      count: 255 },
  { slackId: "seed:gord",   name: "Gord Sharpe",      count: 400 }
];

const BOT_NAME_PATTERN = /^pushup\s+(leaderboard|challenge|bot)$/i;

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

  // Identify any user whose name looks like the bot itself
  const botUserIds = {};
  for (const uid of Object.keys(names)) {
    if (BOT_NAME_PATTERN.test(names[uid])) botUserIds[uid] = true;
  }

  const monthly = {};
  const allTime = {};

  for (const m of messages) {
    if (!m.user || !m.text) continue;
    if (m.bot_id || m.app_id || m.subtype === "bot_message") continue;
    if (botUserIds[m.user]) continue;
    if (/pushup leaderboard\s*[—-]/i.test(m.text)) continue;

    const ts = parseFloat(m.ts);
    if (ts <= SEEDS_AS_OF_TS) continue;

    const n = parsePushups(m.text);
    if (n == null || n === 0 || Math.abs(n) > 5000) continue;

    allTime[m.user] = (allTime[m.user] || 0) + n;
    if (ts >= monthStartTs) {
      monthly[m.user] = (monthly[m.user] || 0) + n;
    }
  }

  // Apply starting totals
  const currentMonthKey = now.getFullYear() + "-" +
    String(now.getMonth() + 1).padStart(2, "0");
  for (const s of SEED_TOTALS) {
    allTime[s.slackId] = (allTime[s.slackId] || 0) + s.count;
    if (currentMonthKey === SEED_MONTH) {
      monthly[s.slackId] = (monthly[s.slackId] || 0) + s.count;
    }
    if (!names[s.slackId]) names[s.slackId] = s.name;
  }

  const monthlyRanked = rank(monthly, names);
  const allTimeRanked = rank(allTime, names);

  let monthlyTotal = 0;
  for (const k of Object.keys(monthly)) monthlyTotal += monthly[k];
  let allTimeTotal = 0;
  for (const k of Object.keys(allTime)) allTimeTotal += allTime[k];

  return {
    period: now.toLocaleString("en-US", { month: "long", year: "numeric" }),
    channel: channel,
    monthly: { leaderboard: monthlyRanked, total: monthlyTotal },
    allTime: { leaderboard: allTimeRanked, total: allTimeTotal },
    updated: new Date().toISOString()
  };
}

module.exports = async function handler(req, res) {
  try {
    const data = await getLeaderboardData();
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
