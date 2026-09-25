# 🏈 Dynasty Command Center

A web app version of the *Dynasty Command Center* spreadsheet. It pulls your leagues directly from
**Sleeper**, **ESPN** and **MyFantasyLeague**, values every player with **FantasyPros** dynasty
rankings, and rebuilds every tab of the workbook.

It runs entirely in the cloud: the website is hosted on **GitHub Pages**, and the data connections,
database and hourly refresh run on **Supabase**. There's nothing to install.

| Tab | What it shows |
| --- | --- |
| 🏠 Dashboard | Each league's record, where you rank by dynasty value, top-100 players, average age, MFL cap snapshot, best free agents and recent drop alerts |
| 📋 My Rosters | Your team in each league sorted by dynasty value, with FP rank and tier, age, experience, lineup status, and MFL salary and contract years |
| 🆓 Free Agents | The best FantasyPros-ranked players not rostered in each league. Star a player to watch him |
| 👀 Watchlist | Who holds each watched player in every league, or whether he's a free agent |
| 💰 MFL Cap | 5-year salary-cap and contract-year projection, cap allocation by position, and every contract by season |
| 🏟️ MFL League | This week's matchup and projections, standings, 30-day transactions feed, trade bait, your pending trades, salary adjustments, league calendar, MFL-wide trending adds/drops, roster rules and scoring |
| 📅 MFL Expiring | League-wide contracts ending after this season or next, plus each team's cap room next season |
| 📊 Team Values | Dynasty power rankings: total value and QB/RB/WR/TE value for every team |
| 🤝 Trade Finder | Teams whose surplus position matches your need and vice versa, with targets and offers |
| 🎯 Draft Picks | Future picks you own, picks you acquired, and your picks other teams hold (Sleeper and MFL) |
| 🔔 Alerts | Top-N ranked or watchlisted players dropped between refreshes, optionally pushed to Discord or Slack |
| 🏆 FP Rankings | The full consensus rankings driving the values |
| ⚙️ Settings | Leagues, credentials, FantasyPros options, cap settings and alert settings |

Dynasty value uses the spreadsheet's curve: `10000 × e^(−(rank−1)/75)`.

## Setup (all in your browser, about 15 minutes)

### 1. Create a Supabase project
1. Sign up at https://supabase.com (the free plan is enough).
2. Click **New project**. Pick any name, choose a region near you, and **set a database
   password. Save it**, because you'll need it in step 3.
3. When the project is ready, open **Project Settings → General** and copy the **Project ID**
   (a string like `abcdefghijklmnopqrst`).
4. Open https://supabase.com/dashboard/account/tokens, click **Generate new token**, name it
   `github`, and copy the token.

### 2. Create your login
1. In your Supabase project, open **Authentication → Users → Add user → Create new user**.
2. Enter your email and a password, tick **Auto Confirm User**, and click **Create user**.
3. Optional but recommended: **Authentication → Sign In / Providers**, turn off
   **Allow new users to sign up**. (The app already refuses anyone except the email you set in
   step 3, so this is an extra safeguard.)

### 3. Add four secrets to GitHub
In this repo on GitHub, open **Settings → Secrets and variables → Actions → New repository secret**
and add:

| Name | Value |
| --- | --- |
| `SUPABASE_PROJECT_ID` | The Project ID from step 1.3 |
| `SUPABASE_ACCESS_TOKEN` | The token from step 1.4 |
| `SUPABASE_DB_PASSWORD` | The database password from step 1.2 |
| `OWNER_EMAIL` | The email you used in step 2 |

### 4. Turn on GitHub Pages
**Settings → Pages → Build and deployment → Source: GitHub Actions.**

### 5. Deploy
Open the **Actions** tab, choose **Test & deploy** on the left, click **Run workflow**, and then
**Run workflow** again. After 2–4 minutes, all three jobs should show green checks. The **pages** job
shows your site's link, which will look like `https://bport133.github.io/F2-Command-Center/`.

Every later push to the default branch redeploys automatically.

### 6. Sign in and configure
Open your site, sign in, and go to **⚙️ Settings**:

1. **Add your leagues.**
   - *Sleeper*: the league id from `sleeper.com/leagues/<id>`.
   - *ESPN*: `leagueId=` from your league URL. Private leagues also need the `espn_s2` and `SWID`
     cookies. To find them, log in at fantasy.espn.com and open DevTools → Application → Cookies.
   - *MFL*: the league id and host (for example `www42.myfantasyleague.com`). Then use **Sign in to MFL**
     (Settings → MFL) with your MFL username and password so the app can see owner-only data
     like your pending trades and the league calendar. The password goes to MFL once and is not
     saved; the app keeps only MFL's login cookie. (Alternatively paste your league API key from
     MFL's Help → Developer's API page.)
2. **FantasyPros.** Paste an API key, or import the rankings CSV from the FantasyPros website.
3. Click **Save & refresh**. Then pick **My team** for each league from the dropdown and click
   **Save & refresh** again.

The hourly auto-refresh and drop alerts start on their own once you've opened the app. They run
in Supabase whether or not your computer is on.

## How it's built

```
client/src/                    React website (GitHub Pages)
supabase/functions/api/        Edge Function entry: database access, sign-in check, background jobs
supabase/functions/_shared/    All app logic, shared with the tests
  app.ts                       API routes (snapshot, refresh, settings, watchlist, CSV, alerts, cron)
  refresh.ts                   Fetches every source, runs the analysis, stores the snapshot, sends alerts
  analysis.ts                  Spreadsheet calculations (values, trade finder, cap, picks, drops)
  providers/                   sleeper.ts, espn.ts, mfl.ts, fantasypros.ts
supabase/migrations/           Database table + 15-minute pg_cron schedule
.github/workflows/deploy.yml   Tests, Supabase deploy and GitHub Pages publish
test/                          Vitest tests (npm test)
```

**Sharing with friends:** the owner (`OWNER_EMAIL`) sees a **👥 Members** page. Add a friend's email and
a starting password, then send them the site link. Each member has their own leagues, settings,
keys, watchlist and alerts (stored per user in `user_state`), and can change their password under
Settings → Account. Only the owner and listed members can use the app, even if someone creates a
Supabase account another way. Removing a member deletes their account and data.

**Security:**
- Settings, including ESPN cookies, MFL sign-in and API keys, live in tables with row-level security
  and no access policies. Only the Edge Function (using the service role) can read them, and it
  only ever reads the signed-in person's own rows.
- The function only answers the owner and invited members, and it never returns stored secrets to
  the browser.
- The key built into the website is Supabase's public anon key, which is designed to be public.

**Data sources:**
- **Sleeper**: public API. The ~5 MB player database is cached for a day and supplies ages and
  experience for every platform.
- **ESPN**: unofficial v3 API. `espn_s2` cookies expire now and then. If ESPN starts failing with
  401/403, paste fresh ones.
- **MFL**: official export API.
- **FantasyPros**: consensus-rankings API with your key. If a call fails, the app keeps the last
  good rankings and league data.

## Developing locally (optional)

```bash
npm install
npm test
echo "VITE_SUPABASE_URL=https://<project-id>.supabase.co" >  .env.local
echo "VITE_SUPABASE_ANON_KEY=<anon key>"                  >> .env.local
npm run dev
```
