// Shared logic: fetch Slack messages, parse pushup counts, return ranked totals.
// Used by both /api/leaderboard (web view) and /api/post-daily (cron post).

export const DEFAULT_CHANNEL = "C0B2CQPFM4G";

// --- Starting totals (seeds) ----------------------------------------------
// Each entry is the person's CURRENT total as of SEEDS_AS_OF_TS. Slack
// messages posted at or before that timestamp are ignored. Slack messages
// posted AFTER add to these.
export const SEED_MONTH = "2026-05";
export const SEEDS_AS_OF_TS = 1778044007; // 2026-05-06 05:06 UTC
export const SEED_TOTALS = [
  { slackId: "U08SCMV3886", name: "Mark Holder",      count: 80 },
  { slackId: "U0CU3LV6U",   name: "Robert",           count: 900 },
  { slackId: "U07063Z2JAZ", name: "Marshall Sharpe",  count: 400 },
  { slackId: "U0CU4H9RD",   name: "Richard Sullivan", count: 510 },
  { slackId: "U0AQD7TR7MG", name: "Nate Cortés",      count: 255 },
  { slackId: "seed:gord",   name: "Gord Sharpe",      count: 400 },
];

export function parsePushups(text) {
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
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  const data = await r.json();
  if (!data.ok) {
    const err = new Error("Slack API error: " + (data.error || "unknown"));
    err.slackError = data.error;
    throw err;
  }
  return data;
}

async function fetchAllMessages(channel, token) {
  const messages = [];
  let cursor;
  for (let i = 0; i < 30; i++) {
    const data = await slackFetch(
      "conversations.history",
      { channel, limit: 200, cursor },
      token
    );
    messages.push(...(data.messages || []));
    cursor = data.response_metadata && data.response_metadata.next_cursor;
    if (!cursor) break;
  }
  return messages;
}

async function fetchUserNames(userIds, token) {
  const names = {};
  const results = await Promise.all(
    userIds.map(async (uid) => {
      try {
        const d = await slackFetch("users.info", { user: uid }, token);
        const u = d.user || {};
        return [
          uid,
          u.real_name ||
            (u.profile && u.profile.display_name) ||
            u.name ||
            uid,
        ];
      } catch {
        return [uid, uid];
      }
    })
  );
  for (const [uid, name] of results) names[uid] = name;
  return names;
}

function rank(totals, names) {
  return Object.entries(totals)
    .map(([uid, count]) => ({ name: names[uid] || uid, count }))
    .sort((a, b) => b.count - a.count);
}

export async function getLeaderboardData() {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID || DEFAULT_CHANNEL;
  if (!token) throw new Error("SLACK_BOT_TOKEN env var is not set");

  const now = new Date();
  const monthStartTs =
    new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;

  const messages = await fetchAllMessages(channel, token);
  const userIds = [...new Set(messages.map((m) => m.user).filter(Boolean))];
  const names = await fetchUserNames(userIds, token);

  const monthly = {};
  const allTime = {};
  const recent = [];

  for (const m of messages) {
    if (!m.user || !m.text) continue;
    const ts = parseFloat(m.ts);
    if (ts <= SEEDS_AS_OF_TS) continue;
    const n = parsePushups(m.text);
    if (n == null || n === 0 || Math.abs(n) > 5000) continue;

    allTime[m.user] = (allTime[m.user] || 0) + n;
    if (ts >= monthStartTs) {
      monthly[m.user] = (monthly[m.user] || 0) + n;
    }
    recent.push({
      user: names[m.user] || m.user,
      count: n,
      ts: m.ts,
      when: new Date(ts * 1000).toISOString(),
    });
  }

  recent.sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts));

  // Apply starting totals
  const currentMonthKey =
    now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  for (const s of SEED_TOTALS) {
    allTime[s.slackId] = (allTime[s.slackId] || 0) + s.count;
    if (currentMonthKey === SEED_MONTH) {
      monthly[s.slackId] = (monthly[s.slackId] || 0) + s.count;
    }
    if (!names[s.slackId]) names[s.slackId] = s.name;
  }

  return {
    period: now.toLocaleString("en-US", { month: "long", year: "numeric" }),
    channel,
    monthly: {
      leaderboard: rank(monthly, names),
      total: Object.values(monthly).reduce((s, v) => s + v, 0),
    },
    allTime: {
      leaderboard: rank(allTime, names),
      total: Object.values(allTime).reduce((s, v) => s + v, 0),
    },
    recent: recent.slice(0, 10),
    updated: new Date().toISOString(),
  };
}
