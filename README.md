# 🏈 Dynasty Command Center

A web app version of the *Dynasty Command Center* spreadsheet. It pulls your leagues directly from
**Sleeper**, **ESPN** and **MyFantasyLeague**, values every player with **FantasyPros** dynasty
rankings, and rebuilds every tab of the workbook:

| Tab | What it shows |
| --- | --- |
| 🏠 Dashboard | Each league's record, where you rank by dynasty value, top-100 players, average age, MFL cap snapshot, best free agents and recent drop alerts |
| 📋 My Rosters | Your team in each league sorted by dynasty value, with FP rank and tier, age, experience, lineup status, and MFL salary and contract years |
| 🆓 Free Agents | The best FantasyPros-ranked players not rostered in each league. Star a player to watch him |
| 👀 Watchlist | Who holds each watched player in every league, or whether he's a free agent |
| 💰 MFL Cap | 5-year salary-cap and contract-year projection, cap allocation by position, and every contract by season |
| 📅 MFL Expiring | League-wide contracts ending after this season or next, plus each team's cap room next season (your bidding rivals) |
| 📊 Team Values | Dynasty power rankings: total value and QB/RB/WR/TE value for every team |
| 🤝 Trade Finder | Teams whose surplus position matches your need and vice versa, with targets to ask for and players you could offer |
| 🎯 Draft Picks | Future picks you own, picks you acquired, and your picks other teams now hold (Sleeper and MFL; ESPN doesn't expose them) |
| 🔔 Alerts | Top-N ranked or watchlisted players dropped between refreshes, optionally pushed to Discord or Slack |
| 🏆 FP Rankings | The full consensus rankings driving the values |
| ⚙️ Settings | Leagues, credentials, FantasyPros options, cap settings and alert settings |

Dynasty value uses the spreadsheet's curve: `10000 × e^(−(rank−1)/75)`, which gives 10,000 for #1,
about 6,400 for #34 and about 690 for #202.

## Run it

Requires Node 20+.

```bash
npm install
npm run build     # build the web UI
npm start         # http://localhost:8787
```

For development with hot reload, run `npm run dev` and open http://localhost:5173.

Then open **Settings**:

1. **Add your leagues.**
   - *Sleeper*: the league id from `sleeper.com/leagues/<id>`.
   - *ESPN*: `leagueId=` from your league URL. Private leagues also need the `espn_s2` and `SWID`
     cookies. To find them, log in at fantasy.espn.com, open DevTools → Application → Cookies.
   - *MFL*: the league id and host (for example `www42.myfantasyleague.com`). Add an MFL API key
     only if data comes back blank.
2. **FantasyPros.** Paste an API key (from secure.fantasypros.com/api-keys/request), or download
   the rankings CSV from the FantasyPros dynasty rankings page and import it.
3. Click **Save & refresh**, then pick **My team** for each league from the dropdown and save again.

The server refreshes automatically every 60 minutes while it's running (change this in Settings, or
set it to 0 to turn it off). Drop alerts compare each refresh against the previous one.

## Where your data lives

Everything is stored as JSON files in `./data` (set `DATA_DIR` to change it). That includes settings,
cached player databases, the last snapshot, your watchlist and alerts. The folder is gitignored.
ESPN cookies and API keys are never sent back to the browser. The server listens on `127.0.0.1`
only. Set `HOST=0.0.0.0` to reach it from other devices on your network, but only on a network you
trust, because anyone who can reach the server can use your saved credentials.

## Project layout

```
server/
  index.ts            Express API + static hosting + auto-refresh timer
  refresh.ts          Fetches every source, runs the analysis, stores the snapshot, sends alerts
  analysis.ts         All spreadsheet calculations (values, trade finder, cap, picks, drops)
  names.ts            Cross-platform player-name matching and the dynasty value curve
  store.ts            JSON persistence and settings (secret masking)
  providers/          sleeper.ts, espn.ts, mfl.ts, fantasypros.ts
shared/types.ts       Types shared by the server and the UI
client/src/           React UI (one page per spreadsheet tab)
test/                 Vitest unit tests (npm test)
```

## Notes on the data sources

- **Sleeper**: public API, no key needed. The ~5 MB player database is cached for a day and also
  supplies ages and years of experience for players on every platform.
- **ESPN**: unofficial `lm-api-reads.fantasy.espn.com` v3 API. `espn_s2` cookies expire now and
  then. If ESPN starts returning 401/403, paste fresh ones.
- **MFL**: the official export API (`league`, `rosters`, `leagueStandings`, `futureDraftPicks`,
  `players`).
- **FantasyPros**: `public/v2/json/nfl/{season}/consensus-rankings` with your API key. If the API
  fails, the app keeps using the last rankings it saved.
