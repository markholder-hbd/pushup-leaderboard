// Vercel serverless function: GET /api/leaderboard
// Reads messages from a Slack channel, parses pushup counts, and returns
// monthly + all-time leaderboards.
//
// Env vars required:
//   SLACK_BOT_TOKEN   xoxb-... bot token with channels:history and users:read
//   SLACK_CHANNEL_ID  e.g. C0B2CQPFM4G  (defaults to the 2026-pushup-challenge channel)

const DEFAULT_CHANNEL = "C0B2CQPFM4G";

function parsePushups(text) {
  const t = (text || "").trim();
  if (!t) return null;
  if (/has joined|has left/i.test(t)) return null;

  // Plain number only: "20"
  const plain = t.match(/^\s*(\d{1,4})\s*$/);
  if (plain) return parseInt(plain[1], 10);

  // Pushup keyword + a number anywhere: "did 30 pushups"
  if (/\bpush[\s-]?ups?\b|\bpushup\b|\bpu\b/i.test(t)) {
    const n = t.match(/\b(\d{1,4})\b/);
    if (n) return parseInt(n[1], 10);
  }

  // Number followed by short tail: "50 done!", "75 today"
  const start = t.match(/^\s*(\d{1,4})\b[^\d]{0,20}$/);
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

export default async function handler(req, res) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID || DEFAULT_CHANNEL;

  if (!token) {
    res.status(500).json({ error: "SLACK_BOT_TOKEN env var is not set" });
    return;
  }

  try {
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
      const n = parsePushups(m.text);
      if (n == null || n <= 0 || n > 5000) continue;

      allTime[m.user] = (allTime[m.user] || 0) + n;
      const ts = parseFloat(m.ts);
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

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({
      period: now.toLocaleString("en-US", { month: "long", year: "numeric" }),
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
    });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}
