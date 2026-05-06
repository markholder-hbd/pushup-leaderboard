# Setup Guide (no coding required)

Total time: about 15 minutes. You'll click through three websites: Slack, GitHub, and Vercel. No terminal, no commands.

At the end you'll have a URL like `https://pushup-leaderboard.vercel.app` to share with the team.

---

## Part 1 — Create the Slack app (5 min)

This creates a "bot" that can read messages from your channel.

1. Go to **https://api.slack.com/apps** and sign in with your Slack workspace.
2. Click the green **Create New App** button → **From scratch**.
3. App Name: `Pushup Leaderboard` · Pick your workspace · Click **Create App**.
4. In the left sidebar, click **OAuth & Permissions**.
5. Scroll to **Scopes → Bot Token Scopes**. Click **Add an OAuth Scope** three times and add:
   - `channels:history`
   - `channels:read`
   - `users:read`
6. Scroll back up. Click the green **Install to Workspace** button → **Allow**.
7. You'll see a **Bot User OAuth Token** that starts with `xoxb-`. Click **Copy** and paste it somewhere safe (a notes app). You'll need it in Part 3.
8. Open Slack, go to `#2026-pushup-challenge`, and type `/invite @Pushup Leaderboard` and hit enter. (This lets the bot read the channel.)

---

## Part 2 — Put the project on GitHub (5 min)

GitHub will host the project files. Vercel reads from there.

1. Go to **https://github.com** and sign up if you don't have an account (free).
2. Click the **+** in the top-right → **New repository**.
3. Repository name: `pushup-leaderboard` · Set it to **Public** · Click **Create repository**.
4. On the next page, click **uploading an existing file** (it's a link in the middle of the page).
5. Open the `pushup-leaderboard` folder I gave you on your Mac. Select **all the files inside it** (including the `api` and `public` folders) and drag them onto the GitHub upload area.
6. Scroll down, click **Commit changes**.

---

## Part 3 — Deploy on Vercel (5 min)

Vercel is the host that turns the project into a public web URL.

1. Go to **https://vercel.com** and click **Sign Up** → **Continue with GitHub**.
2. On the dashboard, click **Add New… → Project**.
3. Find `pushup-leaderboard` in the list and click **Import**.
4. Before clicking Deploy, expand **Environment Variables** and add these two:
   - Name: `SLACK_BOT_TOKEN` · Value: paste the `xoxb-...` token from Part 1
   - Name: `SLACK_CHANNEL_ID` · Value: `C0B2CQPFM4G`
5. Click **Deploy**. Wait ~30 seconds.
6. You'll see a "Congratulations" screen with a URL like `https://pushup-leaderboard-xyz.vercel.app`. Click it to verify the leaderboard loads.

That URL is yours to share. Done.

---

## Tips

- **Custom URL**: in the Vercel dashboard for the project, click **Settings → Domains** to use a friendlier URL (you can buy a domain or use a free Vercel subdomain by renaming the project).
- **Updating later**: any time I (or anyone) edits a file in the GitHub repo, Vercel automatically redeploys within ~30 seconds. You don't need to do anything.
- **If something looks wrong**: check the Vercel **Deployments** tab → click the latest deployment → **Functions** tab to see error logs.

## Common stumbles

- *Leaderboard shows zero people* → The bot probably wasn't invited to the channel. Run `/invite @Pushup Leaderboard` in `#2026-pushup-challenge`.
- *"channel_not_found" error* → The `SLACK_CHANNEL_ID` is wrong. Open the channel in Slack, click the channel name at the top, scroll to the bottom of the popup — the ID is at the very bottom.
- *"not_authed" or "invalid_auth"* → The `SLACK_BOT_TOKEN` is missing or wrong. Re-copy it from Slack and update in Vercel **Settings → Environment Variables**, then redeploy from the **Deployments** tab.
