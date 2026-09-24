// Pulls every source, runs the analysis and stores the resulting snapshot.

import type { Alert, FPPlayer, LeagueData, PlayerInfo, Settings, Snapshot, SourceStatus } from './types.ts';
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
} from './analysis.ts';
import { dynastyValue } from './names.ts';
import { fetchEspnLeague } from './providers/espn.ts';
import { fetchFantasyProsRankings } from './providers/fantasypros.ts';
import { fetchMflLeague } from './providers/mfl.ts';
import { fetchSleeperLeague, loadSleeperPlayers, PLAYER_CACHE, playerInfoIndex, type PlayerDb } from './providers/sleeper.ts';
import { loadSettings } from './settings.ts';
import type { Store } from './store.ts';

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

type Rankings = { source: string; at: string; players: FPPlayer[] };

export const loadWatchlist = (store: Store) => store.get<string[]>('watchlist', []);
export const saveWatchlist = (store: Store, names: string[]) =>
  store.set('watchlist', [...new Set(names.map((n) => n.trim()).filter(Boolean))]);
export const loadRankings = (store: Store) => store.get<Rankings | null>('rankings', null);
export const saveRankings = (store: Store, source: string, players: FPPlayer[]) =>
  store.set('rankings', { source, at: new Date().toISOString(), players });

/** True when the scheduled job should run a refresh now. */
export async function refreshDue(store: Store, now = Date.now()): Promise<boolean> {
  const settings = await loadSettings(store);
  if (settings.autoRefreshMinutes <= 0 || settings.leagues.length === 0) return false;
  const last = (await store.get<Snapshot>('snapshot', EMPTY_SNAPSHOT)).refreshedAt;
  // Small slack so an hourly setting isn't skipped when the cron tick lands a few seconds early.
  return !last || now - Date.parse(last) >= settings.autoRefreshMinutes * 60000 - 120000;
}

/**
 * fetchRemote=false recomputes the snapshot from cached league data (after a settings,
 * watchlist or rankings change) without calling any external API.
 */
export async function refresh(store: Store, opts: { fetchRemote?: boolean } = {}): Promise<Snapshot> {
  const fetchRemote = opts.fetchRemote ?? true;
  const settings = await loadSettings(store);
  const sources: SourceStatus[] = [];
  const errors = new Map<string, string>();
  const leagueCache = await store.get<Record<string, LeagueData>>('leagues', {});

  // Rankings: API when a key is set, otherwise the last CSV import.
  let rankings = await loadRankings(store);
  if (fetchRemote && settings.fpApiKey) {
    try {
      const players = await fetchFantasyProsRankings({
        apiKey: settings.fpApiKey,
        season: settings.season,
        type: settings.fpType,
        scoring: settings.fpScoring,
      });
      const source = `FantasyPros API (${settings.fpType}, ${settings.fpScoring})`;
      await saveRankings(store, source, players);
      rankings = { source, at: new Date().toISOString(), players };
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
  let sleeperDb: PlayerDb = {};
  let info = new Map<string, PlayerInfo>();
  if (fetchRemote && settings.leagues.length > 0) {
    try {
      sleeperDb = await loadSleeperPlayers(store);
      info = playerInfoIndex(sleeperDb);
    } catch (err) {
      sources.push({ source: 'Sleeper players', ok: false, message: (err as Error).message });
    }
  } else {
    const cached = await store.get<{ players: PlayerDb } | null>(PLAYER_CACHE, null);
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
        const data = await fetchLeague(cfg, settings, sleeperDb, store);
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
  const order = (id: string) => settings.leagues.findIndex((l) => l.id === id);
  leagues.sort((a, b) => order(a.configId) - order(b.configId));
  const configured = new Set(settings.leagues.map((l) => l.id));
  if (fetchRemote) {
    await store.set('leagues', Object.fromEntries(Object.entries(leagueCache).filter(([id]) => configured.has(id))));
  }

  const watchlist = await loadWatchlist(store);
  const ctx = makeContext(settings, fp, info, watchlist);

  // Drop alerts: compare against the previous roster snapshot for leagues fetched live this run.
  let alerts = await store.get<Alert[]>('alerts', []);
  if (fetchRemote) {
    const live = leagues.filter((l) => !errors.has(l.configId));
    const prev = await store.get<RosterState>('roster-state', {});
    const fresh = fp.length ? detectDrops(ctx, prev, live, new Date()) : [];
    if (fresh.length) {
      alerts = [...fresh, ...alerts].slice(0, MAX_ALERTS);
      await store.set('alerts', alerts);
      await notify(settings.alertWebhookUrl, fresh).catch((err) =>
        sources.push({ source: 'Alert webhook', ok: false, message: (err as Error).message }),
      );
    }
    await store.set('roster-state', { ...prev, ...rosterState(live) });
  }

  const previous = await store.get<Snapshot>('snapshot', EMPTY_SNAPSHOT);
  const snapshot: Snapshot = {
    refreshedAt: fetchRemote ? new Date().toISOString() : previous.refreshedAt,
    // A local recompute keeps the last live run's source statuses, refreshing the rankings line.
    sources: fetchRemote ? sources : [...sources.slice(0, 1), ...previous.sources.filter((s) => s.source !== 'FantasyPros')],
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
      leagues.map((l) => [
        l.configId,
        l.teams.map((t) => ({ id: t.id, name: t.owner && t.owner !== t.name ? `${t.name} (${t.owner})` : t.name })),
      ]),
    ),
  };
  await store.set('snapshot', snapshot);
  return snapshot;
}

function fetchLeague(cfg: Settings['leagues'][number], settings: Settings, sleeperDb: PlayerDb, store: Store) {
  switch (cfg.platform) {
    case 'sleeper':
      if (!Object.keys(sleeperDb).length) throw new Error('Sleeper player database unavailable');
      return fetchSleeperLeague(cfg, settings.season, sleeperDb);
    case 'espn':
      return fetchEspnLeague(cfg, settings.season, settings);
    case 'mfl':
      return fetchMflLeague(cfg, settings.season, settings.mflApiKey, store);
  }
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
