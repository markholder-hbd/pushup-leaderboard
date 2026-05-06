# Daily Slack Post — Setup Guide

This adds an automated daily post to `#2026-pushup-challenge` showing the current standings. Posts at **6:00 AM Pacific** (13:00 UTC) every day.

You'll need to do three things, all clickable, ~10 minutes total. This assumes you've already done the main `SETUP-GUIDE.md` (Slack app + Vercel deploy).

---

## 1 — Add the `chat:write` scope to your Slack app

Your bot can already read messages; now it needs permission to post too.

1. Go to **https://api.slack.com/apps** and click into your "Pushup Leaderboard" app.
2. In the left sidebar click **OAuth & Permissions**.
3. Scroll to **Scopes → Bot Token Scopes** and click **Add an OAuth Scope**.
4. Type and select **`chat:write`**.
5. Scroll up to the yellow banner that says "you've changed the permissions" and click **Reinstall to Workspace** → **Allow**.

(Your bot token doesn't change — it's the same `xoxb-...` you used before.)

---

## 2 — Add a CRON_SECRET to Vercel

This stops random people from hitting the URL and spamming your channel.

1. Make up a long random string. Anything works — e.g. open https://1password.com/password-generator/ or just mash some keys: `j4K9pL2mQ8xZ5vN7bC3hG6fT1`.
2. In Vercel, go to your project → **Settings → Environment Variables**.
3. Click **Add New**:
   - Name: `CRON_SECRET`
   - Value: paste the random string
   - Environment: leave all three checked
   - Click **Save**.

---

## 3 — Re-upload the updated project files to GitHub

The project has new files (`lib/leaderboard.js`, `api/post-daily.js`) and updated files (`package.json`, `vercel.json`, `api/leaderboard.js`).

Easiest path: re-upload the whole zip.

1. Unzip `pushup-leaderboard.zip` on your Mac (the new one I just generated).
2. Go to your GitHub repo (`https://github.com/<your-username>/pushup-leaderboard`).
3. For each file/folder that's new or changed, do one of:
   - **New file** (`api/post-daily.js`, `lib/leaderboard.js`) — click **Add file → Upload files**, drag it in, **Commit changes**.
   - **Changed file** (`package.json`, `vercel.json`, `api/leaderboard.js`) — click into the file, click the pencil ✏️, paste the new contents, **Commit changes**.

   Or simplest: in GitHub, click **Add file → Upload files**, drag the **entire unzipped folder contents** in (yes, GitHub will overwrite matching files), **Commit changes**. Just be sure to drag the *contents* of the unzipped folder, not the folder itself.

4. Vercel auto-deploys in ~30 seconds. Watch the **Deployments** tab to confirm it succeeded.

---

## Verify it works

You don't have to wait until tomorrow morning. From the Vercel dashboard:

1. Go to your project → **Deployments** → click the latest one.
2. Click **Functions** in the top tabs → click **`/api/post-daily`**.
3. Click **Logs** to watch for output.
4. In a new tab, open `https://<your-project>.vercel.app/api/post-daily` — you'll get `unauthorized` (good — that means the auth check works).
5. To trigger a real post manually, run this in your Mac's Terminal (paste your CRON_SECRET in place):
   ```
   curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://<your-project>.vercel.app/api/post-daily
   ```
   You should see `{"ok":true,"ts":"..."}` and a new message in the Slack channel.

If you don't want to use Terminal: just wait until 6:00 AM PT tomorrow and check the channel.

---

## Daylight saving caveat

The cron schedule is `0 13 * * *` — that's **13:00 UTC = 6:00 AM PDT** (March–November). When PDT ends in November and we're back on PST, this will fire at **5:00 AM PT** instead. To fix, edit `vercel.json` and change `"0 13 * * *"` to `"0 14 * * *"` (then push to GitHub).

## Stopping or changing the schedule

- **Pause** posts: in Vercel, project → **Settings → Cron Jobs** → toggle off.
- **Change time**: edit the schedule in `vercel.json`. Format is `minute hour * * *`, all UTC. Example: `"30 14 * * *"` = 14:30 UTC = 7:30 AM PDT.
- **Stop entirely**: delete `api/post-daily.js` and remove the `crons` block from `vercel.json`.
