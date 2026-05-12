// /api/leaderboard — returns JSON leaderboard data.
// Self-contained CommonJS function (no imports from other project files).

const DEFAULT_CHANNEL = "C0B2CQPFM4G";

// --- Starting totals ------------------------------------------------------
// Each entry is the person's CURRENT total as of SEEDS_AS_OF_TS.
// Slack messages posted at or before that timestamp are ignored. Slack
// messages posted AFTER add to these totals.
const SEED_MONTH = "2026-05";
const SEEDS_AS_OF_TS = 1778044007; // 2026-05-06 05:06 UTC
const MONTHLY_GOAL = 1000; // pushups per person per month
const SEED_TOTALS = [
  { slackId: "U08SCMV3886", name: "Mark Holder",      count: 80 },
  { slackId: "U0CU3LV6U",   name: "Robert",           count: 900 },
  { slackId: "U07063Z2JAZ", name: "Marshall Sharpe",  count: 400 },
  { slackId: "U0CU4H9RD",   name: "Richard Sullivan", count: 510 },
  { slackId: "U0AQD7TR7MG", name: "Nate Cortés",      count: 255 },
  { slackId: "seed:gord",   name: "Gord Sharpe",      count: 400 }
];

// Manual daily entries — for participants not on Slack.
// Each entry contributes to that user's daily/monthly/all-time totals.
// Date is Pacific time (YYYY-MM-DD).
const MANUAL_ENTRIES = [
  { userId: "seed:gord", date: "2026-05-07", count: 240 },
  { userId: "seed:gord", date: "2026-05-08", count: 220 }
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
    out.push({ uid: uid, name: names[uid] || uid, count: totals[uid] });
  }
  out.sort(function (a, b) { return b.count - a.count; });
  return out;
}

function pacificDateKey(tsSeconds) {
  // Returns YYYY-MM-DD in America/Los_Angeles for a Unix timestamp (seconds).
  const d = new Date(tsSeconds * 1000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(d);
  let y = "", m = "", day = "";
  for (const p of parts) {
    if (p.type === "year") y = p.value;
    else if (p.type === "month") m = p.value;
    else if (p.type === "day") day = p.value;
  }
  return y + "-" + m + "-" + day;
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
  const dailyByUser = {}; // dailyByUser[userId][YYYY-MM-DD] = total pushups that day
  const userGoals = {}; // userGoals[userId] = goal number
  const userGoalTs = {}; // userGoalTs[userId] = timestamp of latest goal-set message
  const GOAL_PATTERN = /\bgoal[:\s]+\s*(\d{2,5})\b/i;

  for (const m of messages) {
    if (!m.user || !m.text) continue;
    if (m.bot_id || m.app_id || m.subtype === "bot_message") continue;
    if (botUserIds[m.user]) continue;
    if (/pushup leaderboard\s*[—-]/i.test(m.text)) continue;

    const ts = parseFloat(m.ts);

    // Goal-setting message: "Goal: 1500" — track latest per user, don't count as pushups
    const goalMatch = m.text.match(GOAL_PATTERN);
    if (goalMatch) {
      const goalNum = parseInt(goalMatch[1], 10);
      if (goalNum >= 50 && goalNum <= 100000) {
        if (!userGoalTs[m.user] || ts > userGoalTs[m.user]) {
          userGoals[m.user] = goalNum;
          userGoalTs[m.user] = ts;
        }
      }
      continue;
    }

    if (ts <= SEEDS_AS_OF_TS) continue;

    const n = parsePushups(m.text);
    if (n == null || n === 0 || Math.abs(n) > 5000) continue;

    allTime[m.user] = (allTime[m.user] || 0) + n;
    if (ts >= monthStartTs) {
      monthly[m.user] = (monthly[m.user] || 0) + n;
    }

    const dateKey = pacificDateKey(ts);
    if (!dailyByUser[m.user]) dailyByUser[m.user] = {};
    dailyByUser[m.user][dateKey] = (dailyByUser[m.user][dateKey] || 0) + n;
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

  // Apply manual daily entries (non-Slack participants)
  for (const entry of MANUAL_ENTRIES) {
    if (!dailyByUser[entry.userId]) dailyByUser[entry.userId] = {};
    dailyByUser[entry.userId][entry.date] =
      (dailyByUser[entry.userId][entry.date] || 0) + entry.count;
    allTime[entry.userId] = (allTime[entry.userId] || 0) + entry.count;
    if (entry.date.slice(0, 7) === currentMonthKey) {
      monthly[entry.userId] = (monthly[entry.userId] || 0) + entry.count;
    }
  }

  const todayKey = pacificDateKey(Date.now() / 1000);
  const seedKey = pacificDateKey(SEEDS_AS_OF_TS);

  // Yesterday in Pacific = today's date minus 1 day (pure date math, no TZ math)
  const yesterdayKey = (function () {
    const p = todayKey.split("-").map(Number);
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    d.setUTCDate(d.getUTCDate() - 1);
    return d.getUTCFullYear() + "-" +
      String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
      String(d.getUTCDate()).padStart(2, "0");
  })();

  // Days elapsed since the seed cutoff (inclusive of today)
  function dateDelta(d1, d2) {
    const t1 = new Date(d1 + "T00:00:00Z").getTime();
    const t2 = new Date(d2 + "T00:00:00Z").getTime();
    return Math.floor((t2 - t1) / 86400000) + 1;
  }
  const daysElapsed = Math.max(1, dateDelta(seedKey, todayKey));

  function annotate(entries) {
    return entries.map(function (e) {
      const days = dailyByUser[e.uid] || {};
      const todayTotal = days[todayKey] || 0;
      let bestCount = 0, bestDate = null;
      let postSeedTotal = 0;
      const dayList = Object.keys(days);
      for (const d of dayList) {
        postSeedTotal += days[d];
        if (days[d] > bestCount) { bestCount = days[d]; bestDate = d; }
      }
      const goalTarget = userGoals[e.uid] || MONTHLY_GOAL;
      return {
        name: e.name,
        count: e.count,
        today: todayTotal,
        yesterday: days[yesterdayKey] || 0,
        bestDay: bestCount > 0 ? { count: bestCount, date: bestDate } : null,
        avgPerDay: dayList.length > 0 ? Math.round(postSeedTotal / dayList.length) : 0,
        daysActive: dayList.length,
        goalTarget: goalTarget,
        goalPercent: Math.min(100, Math.round((e.count / goalTarget) * 100)),
        customGoal: !!userGoals[e.uid]
      };
    });
  }

  const monthlyRanked = annotate(rank(monthly, names));
  const allTimeRanked = annotate(rank(allTime, names));

  let monthlyTotal = 0;
  for (const k of Object.keys(monthly)) monthlyTotal += monthly[k];
  let allTimeTotal = 0;
  for (const k of Object.keys(allTime)) allTimeTotal += allTime[k];

  // Today's grand total
  let todayTotal = 0;
  for (const uid of Object.keys(dailyByUser)) {
    todayTotal += dailyByUser[uid][todayKey] || 0;
  }

  // Today's leader (highest "today" value among monthly leaderboard, ignoring zeros)
  let todayLeader = null;
  for (const r of monthlyRanked) {
    if (r.today > 0 && (!todayLeader || r.today > todayLeader.count)) {
      todayLeader = { name: r.name, count: r.today };
    }
  }

  return {
    period: now.toLocaleString("en-US", { month: "long", year: "numeric" }),
    today: todayKey,
    todayTotal: todayTotal,
    todayLeader: todayLeader,
    daysElapsed: daysElapsed,
    monthlyGoal: MONTHLY_GOAL,
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
