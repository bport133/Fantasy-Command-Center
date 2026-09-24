// Pulls every source, runs the analysis and stores the resulting snapshot.

import type { Alert, FPPlayer, LeagueData, PlayerInfo, Snapshot, SourceStatus } from '../shared/types.js';
import {
  detectDrops,
  draftPicks,
  freeAgents,
  leagueSummaries,
  makeContext,
  mflCap,
  mflExpiring,
  rosterGroups,
  rosterState,
  teamValues,
  tradeFinder,
  watchRows,
  type RosterState,
} from './analysis.js';
import { dynastyValue } from './names.js';
import { fetchEspnLeague } from './providers/espn.js';
import { fetchFantasyProsRankings } from './providers/fantasypros.js';
import { fetchMflLeague } from './providers/mfl.js';
import { fetchSleeperLeague, loadSleeperPlayers, playerInfoIndex } from './providers/sleeper.js';
import { loadSettings, readJson, writeJson } from './store.js';

const MAX_ALERTS = 500;

export const EMPTY_SNAPSHOT: Snapshot = {
  refreshedAt: null,
  sources: [],
  fpCount: 0,
  leagues: [],
  rosters: [],
  freeAgents: [],
  teamValues: [],
  tradeFinder: [],
  picks: [],
  mflCap: [],
  mflExpiring: [],
  watchlist: [],
  alerts: [],
  rankings: [],
  teamChoices: {},
};

export const loadWatchlist = () => readJson<string[]>('watchlist.json', []);
export const saveWatchlist = (names: string[]) =>
  writeJson('watchlist.json', [...new Set(names.map((n) => n.trim()).filter(Boolean))]);
export const loadRankings = () => readJson<{ source: string; at: string; players: FPPlayer[] } | null>('rankings.json', null);
export const saveRankings = (source: string, players: FPPlayer[]) =>
  writeJson('rankings.json', { source, at: new Date().toISOString(), players });

const loadLeagueCache = () => readJson<Record<string, LeagueData>>('leagues.json', {});

let running: Promise<Snapshot> | null = null;

/** Runs a refresh, or joins the one already in flight. */
export function refresh(opts: { fetchRemote?: boolean } = {}): Promise<Snapshot> {
  running ??= doRefresh(opts.fetchRemote ?? true).finally(() => (running = null));
  return running;
}

async function doRefresh(fetchRemote: boolean): Promise<Snapshot> {
  const settings = loadSettings();
  const sources: SourceStatus[] = [];
  const errors = new Map<string, string>();
  const leagueCache = loadLeagueCache();

  // Rankings: API when a key is set, otherwise the last CSV import.
  let rankings = loadRankings();
  if (fetchRemote && settings.fpApiKey) {
    try {
      const players = await fetchFantasyProsRankings({
        apiKey: settings.fpApiKey,
        season: settings.season,
        type: settings.fpType,
        scoring: settings.fpScoring,
      });
      saveRankings(`FantasyPros API (${settings.fpType}, ${settings.fpScoring})`, players);
      rankings = loadRankings();
      sources.push({ source: 'FantasyPros', ok: true, message: `Synced ${players.length} players (${settings.fpType}, ${settings.fpScoring})` });
    } catch (err) {
      sources.push({ source: 'FantasyPros', ok: false, message: `${(err as Error).message}${rankings ? ' — using last saved rankings' : ''}` });
    }
  } else if (rankings) {
    sources.push({ source: 'FantasyPros', ok: true, message: `${rankings.players.length} players from ${rankings.source}` });
  } else {
    sources.push({ source: 'FantasyPros', ok: false, message: 'No rankings yet: add an API key or import a CSV in Settings' });
  }
  const fp = rankings?.players ?? [];

  // Sleeper player DB supplies ages/experience for every platform and names for Sleeper rosters.
  let sleeperDb: Awaited<ReturnType<typeof loadSleeperPlayers>> = {};
  let info = new Map<string, PlayerInfo>();
  const needsDb = fetchRemote && settings.leagues.length > 0;
  if (needsDb) {
    try {
      sleeperDb = await loadSleeperPlayers();
      info = playerInfoIndex(sleeperDb);
    } catch (err) {
      sources.push({ source: 'Sleeper players', ok: false, message: (err as Error).message });
    }
  } else {
    const cached = readJson<{ players: typeof sleeperDb } | null>('cache-sleeper-players.json', null);
    if (cached) info = playerInfoIndex(cached.players);
  }

  const leagues: LeagueData[] = [];
  await Promise.all(
    settings.leagues.map(async (cfg) => {
      const label = `${cfg.platform.toUpperCase()} ${cfg.leagueId}`;
      if (!cfg.leagueId) {
        errors.set(cfg.id, 'No league id');
        return;
      }
      if (!fetchRemote) {
        if (leagueCache[cfg.id]) leagues.push(leagueCache[cfg.id]);
        return;
      }
      try {
        let data: LeagueData;
        if (cfg.platform === 'sleeper') {
          if (!Object.keys(sleeperDb).length) throw new Error('Sleeper player database unavailable');
          data = await fetchSleeperLeague(cfg, settings.season, sleeperDb);
        } else if (cfg.platform === 'espn') {
          data = await fetchEspnLeague(cfg, settings.season, settings);
        } else {
          data = await fetchMflLeague(cfg, settings.season, settings.mflApiKey);
        }
        leagues.push(data);
        leagueCache[cfg.id] = data;
        sources.push({ source: data.name, ok: true, message: `${label}: ${data.teams.length} teams` });
      } catch (err) {
        const msg = (err as Error).message;
        errors.set(cfg.id, msg);
        sources.push({ source: label, ok: false, message: msg });
        if (leagueCache[cfg.id]) leagues.push(leagueCache[cfg.id]); // show last good data
      }
    }),
  );
  // Keep the configured order.
  leagues.sort(
    (a, b) =>
      settings.leagues.findIndex((l) => l.id === a.configId) - settings.leagues.findIndex((l) => l.id === b.configId),
  );
  const configured = new Set(settings.leagues.map((l) => l.id));
  writeJson('leagues.json', Object.fromEntries(Object.entries(leagueCache).filter(([id]) => configured.has(id))));

  const watchlist = loadWatchlist();
  const ctx = makeContext(settings, fp, info, watchlist);

  // Drop alerts: compare against the previous roster snapshot for leagues fetched live this run.
  let alerts = readJson<Alert[]>('alerts.json', []);
  if (fetchRemote) {
    const live = leagues.filter((l) => !errors.has(l.configId));
    const prev = readJson<RosterState>('roster-state.json', {});
    const fresh = fp.length ? detectDrops(ctx, prev, live, new Date()) : [];
    if (fresh.length) {
      alerts = [...fresh, ...alerts].slice(0, MAX_ALERTS);
      writeJson('alerts.json', alerts);
      await notify(settings.alertWebhookUrl, fresh).catch((err) =>
        sources.push({ source: 'Alert webhook', ok: false, message: (err as Error).message }),
      );
    }
    writeJson('roster-state.json', { ...prev, ...rosterState(live) });
  }

  const snapshot: Snapshot = {
    refreshedAt: new Date().toISOString(),
    sources,
    fpCount: fp.length,
    leagues: leagueSummaries(ctx, leagues, errors),
    rosters: rosterGroups(ctx, leagues),
    freeAgents: freeAgents(ctx, leagues, fp),
    teamValues: leagues.map((l) => ({ configId: l.configId, league: l.name, rows: teamValues(ctx, l) })),
    tradeFinder: leagues.map((l) => tradeFinder(ctx, l)),
    picks: leagues.map((l) => draftPicks(ctx, l)),
    mflCap: leagues.filter((l) => l.platform === 'mfl').map((l) => mflCap(ctx, l)).filter((v) => v !== null),
    mflExpiring: leagues.filter((l) => l.platform === 'mfl').map((l) => mflExpiring(ctx, l)),
    watchlist: watchRows(ctx, leagues, watchlist),
    alerts,
    rankings: fp.map((p) => ({ ...p, age: info.get(p.key)?.age ?? p.age, value: dynastyValue(p.rank) })),
    teamChoices: Object.fromEntries(
      leagues.map((l) => [l.configId, l.teams.map((t) => ({ id: t.id, name: t.owner && t.owner !== t.name ? `${t.name} (${t.owner})` : t.name }))]),
    ),
  };
  if (!fetchRemote) snapshot.refreshedAt = readJson<Snapshot>('snapshot.json', EMPTY_SNAPSHOT).refreshedAt;
  writeJson('snapshot.json', snapshot);
  return snapshot;
}

/** Posts new drop alerts to a Discord or Slack incoming webhook. */
async function notify(url: string, alerts: Alert[]): Promise<void> {
  if (!url) return;
  const lines = alerts.map(
    (a) =>
      `${a.watchlist ? '👀 ' : ''}${a.league}: ${a.player} (${a.pos}${a.rank ? ` #${a.rank}` : ''}) dropped by ${a.droppedBy}`,
  );
  const text = `🔔 Dynasty drop alert\n${lines.join('\n')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Discord reads `content`, Slack reads `text`.
    body: JSON.stringify({ content: text.slice(0, 1900), text }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
