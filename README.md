# Pushup Leaderboard

A small web app that pulls messages from a Slack channel, parses pushup counts, and shows a monthly leaderboard at a public URL.

## How it works

- `api/leaderboard.js` — Vercel serverless function. On request, calls Slack's `conversations.history` and `users.info`, parses pushup counts from messages, returns ranked JSON. Cached at the edge for 60s.
- `public/index.html` — static front-end that fetches `/api/leaderboard` and renders the board.

## One-time setup

### 1. Create a Slack app

1. Go to https://api.slack.com/apps and click **Create New App** → **From scratch**.
2. Name it "Pushup Leaderboard" and pick your workspace.
3. In **OAuth & Permissions**, under **Bot Token Scopes**, add:
   - `channels:history` (read public channel messages)
   - `channels:read`
   - `users:read` (look up display names)
4. Click **Install to Workspace**, approve.
5. Copy the **Bot User OAuth Token** (starts with `xoxb-`).
6. In Slack, run `/invite @Pushup Leaderboard` in `#2026-pushup-challenge` so the bot can read messages.

### 2. Deploy to Vercel

The fastest path:

```bash
npm i -g vercel
cd pushup-leaderboard
vercel
```

Follow the prompts (link to your Vercel account, accept defaults). Then add the env vars:

```bash
vercel env add SLACK_BOT_TOKEN     # paste the xoxb- token
vercel env add SLACK_CHANNEL_ID    # C0B2CQPFM4G  (already the default)
vercel --prod                       # deploy to production
```

You'll get a URL like `https://pushup-leaderboard.vercel.app` — share that.

Alternatively: drag the `pushup-leaderboard/` folder onto https://vercel.com/new and set the env vars in the dashboard under **Settings → Environment Variables**.

## Local dev

```bash
npm i -g vercel
vercel dev
```

Set env vars in `.env.local`:

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL_ID=C0B2CQPFM4G
```

Open http://localhost:3000.

## Parsing rules

A message contributes to a user's total this month if its text matches one of:

- a plain number on its own (`20`)
- contains a pushup keyword and a number (`did 30 pushups`)
- starts with a number followed by a short tail (`50 done!`)

System messages (`has joined the channel`) and conversational replies without a clear count are skipped. Counts above 5000 are rejected as parse errors.

If you want different rules, edit `parsePushups()` in `api/leaderboard.js`.

## Notes

- Only top-level messages are counted (threaded replies are excluded).
- The Slack API call is cached at Vercel's edge for 60s — the page is fast and Slack rate limits are not a concern.
- To run multiple monthly challenges, deploy a second Vercel project with a different `SLACK_CHANNEL_ID`.
