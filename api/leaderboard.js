// Vercel serverless function: GET /api/leaderboard
// Returns monthly + all-time leaderboards as JSON.
// Logic lives in lib/leaderboard.js so it can be shared with the daily cron post.

import { getLeaderboardData } from "../lib/leaderboard.js";

export default async function handler(req, res) {
  try {
    const data = await getLeaderboardData();
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}
