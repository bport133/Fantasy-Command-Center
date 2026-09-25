// Pulls every source, runs the analysis and stores the resulting snapshot.

import {
  RANKING_LABELS,
  type Alert,
  type DfsPlayer,
  type DfsSlate,
  type FPPlayer,
  type LeagueData,
  type NewsItem,
  type NflState,
  type PlayerInfo,
  type ProjectionSet,
  type RankingSet,
  type RankingType,
  type Scoring,
  type Settings,
  type Snapshot,
  type SourceStatus,
} from './types.ts';
import { rankingFor, rankingKey, rankingLabel, type RankingChoice } from './formats.ts';
import { parseFanDuelCsv } from './dfs.ts';
import {
  detectDrops,
  draftPicks,
  findMyTeam,
  freeAgents,
  leagueSummaries,
  makeContext,
  mflCap,
  mflExpiring,
  mflLeagueView,
  rosterGroups,
  rosterState,
  teamValues,
  tradeFinder,
  watchRows,
  type RosterState,
} from './analysis.ts';
import { dynastyValue, normalizeName } from './names.ts';
import { fetchEspnLeague } from './providers/espn.ts';
import { fetchFantasyProsNews, fetchFantasyProsProjections, fetchFantasyProsRankings } from './providers/fantasypros.ts';
import { fetchMflLeague } from './providers/mfl.ts';
import { fetchNflState, fetchSleeperLeague, fetchSleeperScores, loadSleeperPlayers, PLAYER_CACHE, playerInfoIndex, type PlayerDb } from './providers/sleeper.ts';
import { defaultRecordFormat, loadSettings } from './settings.ts';
import { buildScoreboard } from './scoreboard.ts';
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
  mflLeague: [],
  scoreboard: [],
  watchlist: [],
  alerts: [],
  rankings: [],
  rankingSets: [],
  projections: null,
  news: [],
  nflState: null,
  dfs: null,
  teamChoices: {},
};

type Rankings = { source: string; at: string; players: FPPlayer[] };

const RANKINGS_TTL_MS = 6 * 3600 * 1000;
const WEEKLY_TTL_MS = 3 * 3600 * 1000;
const NEWS_TTL_MS = 3600 * 1000;
const NFL_STATE_TTL_MS = 3600 * 1000;
const setKey = (c: RankingChoice) => `fp:${rankingKey(c)}`;

export const loadWatchlist = (store: Store) => store.get<string[]>('watchlist', []);
export const saveWatchlist = (store: Store, names: string[]) =>
  store.set('watchlist', [...new Set(names.map((n) => n.trim()).filter(Boolean))]);
/** Rankings imported from a FantasyPros CSV are stored like API rankings, for the chosen type. */
export const saveRankings = (store: Store, source: string, players: FPPlayer[], choice: RankingChoice) =>
  store.set(setKey(choice), { source, at: new Date().toISOString(), players });

/** FanDuel player list uploaded on the DFS page. */
export const saveDfsSlate = (store: Store, csv: string) =>
  store.set('dfs-slate', { uploadedAt: new Date().toISOString(), players: parseFanDuelCsv(csv) });

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
export async function refresh(store: Store, opts: { fetchRemote?: boolean; cache?: Store } = {}): Promise<Snapshot> {
  const fetchRemote = opts.fetchRemote ?? true;
  // Public lookup data (player databases) is shared by every user; everything else is per user.
  const cache = opts.cache ?? store;
  const settings = await loadSettings(store);
  const sources: SourceStatus[] = [];
  const errors = new Map<string, string>();
  const leagueCache = await store.get<Record<string, LeagueData>>('leagues', {});

  // NFL calendar (preseason vs in-season, current week), shared by everyone.
  let nflState = await cache.get<(NflState & { at: number }) | null>('cache:nfl-state', null);
  if (fetchRemote && (!nflState || Date.now() - nflState.at > NFL_STATE_TTL_MS)) {
    try {
      nflState = { ...(await fetchNflState()), at: Date.now() };
      await cache.set('cache:nfl-state', nflState);
    } catch (err) {
      sources.push({ source: 'NFL calendar', ok: false, message: (err as Error).message });
    }
  }

  // Rankings: every set a league needs plus the ones picked in Settings.
  const defaultScoring = settings.fpScoring as Scoring;
  const needed = new Map<string, RankingChoice>();
  const want = (c: RankingChoice) => needed.set(rankingKey(c), c);
  for (const type of settings.fpTypes) want({ type, scoring: defaultScoring });
  for (const cfg of settings.leagues) {
    const c = rankingFor(cfg, settings, nflState);
    want(c);
    if (cfg.format === 'keeper') want({ type: 'dynasty', scoring: c.scoring });
  }
  const sets = new Map<string, RankingSet>();
  const fpNotes: string[] = [];
  let fpFailed = false;
  for (const c of needed.values()) {
    let saved = await store.get<Rankings | null>(setKey(c), null);
    // Rankings saved before ranking sets existed were the dynasty set at the default scoring.
    if (!saved && c.type === 'dynasty' && c.scoring === defaultScoring) saved = await store.get<Rankings | null>('rankings', null);
    const ttl = c.type === 'weekly' ? WEEKLY_TTL_MS : RANKINGS_TTL_MS;
    const stale = !saved || saved.source === 'CSV import' ? !saved : Date.now() - Date.parse(saved.at) > ttl;
    if (fetchRemote && settings.fpApiKey && stale) {
      try {
        const players = await fetchFantasyProsRankings({
          apiKey: settings.fpApiKey,
          season: settings.season,
          type: c.type,
          scoring: c.scoring,
          week: nflState?.week,
        });
        saved = { source: 'FantasyPros API', at: new Date().toISOString(), players };
        await store.set(setKey(c), saved);
      } catch (err) {
        fpFailed = true;
        fpNotes.push(`${RANKING_LABELS[c.type]} failed (${(err as Error).message})${saved ? ', using last saved' : ''}`);
      }
    }
    if (saved?.players.length) {
      sets.set(rankingKey(c), {
        type: c.type,
        scoring: c.scoring,
        label: rankingLabel(c),
        source: saved.source,
        at: saved.at,
        players: saved.players.map((p) => ({ ...p, value: dynastyValue(p.rank) })),
      });
    }
  }
  if (!sets.size) {
    sources.push({
      source: 'FantasyPros',
      ok: false,
      message: fpNotes.length ? fpNotes.join('; ') : 'No rankings yet: add an API key or import a CSV in Settings',
    });
  } else {
    const loaded = [...sets.values()].map((r) => `${RANKING_LABELS[r.type]} ${r.scoring} (${r.players.length})`).join(', ');
    sources.push({ source: 'FantasyPros', ok: !fpFailed, message: [`Rankings: ${loaded}`, ...fpNotes].join('; ') });
  }

  // Weekly projections (half PPR = FanDuel scoring) and news: FantasyPros API only, cached.
  let projections = await store.get<ProjectionSet | null>('fp-projections', null);
  let news = await store.get<{ at: string; items: Omit<NewsItem, 'mine'>[] } | null>('fp-news', null);
  if (fetchRemote && settings.fpApiKey && nflState) {
    const week = nflState.week;
    if (!projections || projections.week !== week || Date.now() - Date.parse(projections.at) > WEEKLY_TTL_MS) {
      try {
        const players = await fetchFantasyProsProjections({ apiKey: settings.fpApiKey, season: settings.season, week, scoring: 'HALF' });
        projections = { week, scoring: 'HALF', at: new Date().toISOString(), players };
        await store.set('fp-projections', projections);
      } catch (err) {
        sources.push({ source: 'FantasyPros projections', ok: false, message: (err as Error).message });
      }
    }
    if (!news || Date.now() - Date.parse(news.at) > NEWS_TTL_MS) {
      try {
        news = { at: new Date().toISOString(), items: await fetchFantasyProsNews({ apiKey: settings.fpApiKey }) };
        await store.set('fp-news', news);
      } catch (err) {
        sources.push({ source: 'FantasyPros news', ok: false, message: (err as Error).message });
      }
    }
  }

  // Default set: the one most leagues use (for the watchlist and name suggestions), else dynasty.
  const usage = new Map<string, number>();
  for (const cfg of settings.leagues) {
    const k = rankingKey(rankingFor(cfg, settings, nflState));
    usage.set(k, (usage.get(k) ?? 0) + 1);
  }
  const defaultKey =
    [...usage.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).find((k) => sets.has(k)) ??
    (sets.has(`dynasty:${defaultScoring}`) ? `dynasty:${defaultScoring}` : [...sets.keys()][0]);
  const fp: FPPlayer[] = (defaultKey && sets.get(defaultKey)?.players) || [];

  // Sleeper player DB supplies ages/experience for every platform and names for Sleeper rosters.
  let sleeperDb: PlayerDb = {};
  let info = new Map<string, PlayerInfo>();
  if (fetchRemote && settings.leagues.length > 0) {
    try {
      sleeperDb = await loadSleeperPlayers(cache);
      info = playerInfoIndex(sleeperDb);
    } catch (err) {
      sources.push({ source: 'Sleeper players', ok: false, message: (err as Error).message });
    }
  } else {
    const cached = await cache.get<{ players: PlayerDb } | null>(PLAYER_CACHE, null);
    if (cached) info = playerInfoIndex(cached.players);
  }

  // Week whose scores are live (none before the regular season starts).
  const scoringWeek = nflState && nflState.seasonType !== 'pre' && nflState.seasonType !== 'off' ? nflState.week : null;

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
        const data = await fetchLeague(cfg, settings, sleeperDb, cache);
        // Sleeper keeps weekly scores in a separate endpoint; finished weeks are reused from the cache.
        if (cfg.platform === 'sleeper' && scoringWeek) {
          try {
            data.scores = await fetchSleeperScores(cfg.leagueId, scoringWeek, leagueCache[cfg.id]?.scores);
          } catch (err) {
            data.scores = leagueCache[cfg.id]?.scores;
            sources.push({ source: `${label} scores`, ok: false, message: (err as Error).message });
          }
        }
        leagues.push(data);
        leagueCache[cfg.id] = data;
        const rostered = data.teams.reduce((n, t) => n + t.players.length, 0);
        if (data.teams.length && !rostered) throw new Error(`${data.name}: ${data.teams.length} teams but no rostered players came back`);
        sources.push({ source: data.name, ok: true, message: `${label}: ${data.teams.length} teams, ${rostered} rostered players` });
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
  const ctx = makeContext(settings, fp, info, watchlist, { rankingLabel: defaultKey ? sets.get(defaultKey)?.label : undefined });
  // Each league values players with the rankings for its format (falling back to the default set).
  const contexts = new Map<string, ReturnType<typeof makeContext>>();
  const listFor = (configId: string): FPPlayer[] => {
    const cfg = settings.leagues.find((l) => l.id === configId);
    return (cfg && sets.get(rankingKey(rankingFor(cfg, settings, nflState)))?.players) || fp;
  };
  const ctxFor = (configId: string) => {
    if (contexts.has(configId)) return contexts.get(configId)!;
    const cfg = settings.leagues.find((l) => l.id === configId);
    if (!cfg) return ctx;
    const choice = rankingFor(cfg, settings, nflState);
    const set = sets.get(rankingKey(choice));
    const longTerm = cfg.format === 'keeper' ? sets.get(`dynasty:${choice.scoring}`)?.players : undefined;
    const c = makeContext(settings, set?.players ?? fp, info, watchlist, {
      rankingLabel: set ? set.label : `${rankingLabel(choice)} (not loaded; using ${ctx.rankingLabel ?? 'default'})`,
      longTerm,
    });
    contexts.set(configId, c);
    return c;
  };

  // Drop alerts: compare against the previous roster snapshot for leagues fetched live this run.
  let alerts = await store.get<Alert[]>('alerts', []);
  if (fetchRemote) {
    const live = leagues.filter((l) => !errors.has(l.configId));
    const prev = await store.get<RosterState>('roster-state', {});
    const fresh = fp.length ? live.flatMap((l) => detectDrops(ctxFor(l.configId), prev, [l], new Date())) : [];
    if (fresh.length) {
      alerts = [...fresh, ...alerts].slice(0, MAX_ALERTS);
      await store.set('alerts', alerts);
      await notify(settings.alertWebhookUrl, fresh).catch((err) =>
        sources.push({ source: 'Alert webhook', ok: false, message: (err as Error).message }),
      );
    }
    await store.set('roster-state', { ...prev, ...rosterState(live) });
  }

  const slate = await store.get<{ uploadedAt: string; players: Omit<DfsPlayer, 'projection' | 'projectionSource'>[] } | null>('dfs-slate', null);
  const dfs = slate ? mergeDfsProjections(slate, projections) : null;

  const previous = await store.get<Snapshot>('snapshot', EMPTY_SNAPSHOT);
  const snapshot: Snapshot = {
    refreshedAt: fetchRemote ? new Date().toISOString() : previous.refreshedAt,
    // A local recompute keeps the last live run's source statuses, refreshing the rankings line.
    sources: fetchRemote ? sources : [...sources.slice(0, 1), ...previous.sources.filter((s) => s.source !== 'FantasyPros')],
    fpCount: fp.length,
    leagues: settings.leagues.map((cfg) => leagueSummaries(ctxFor(cfg.id), leagues, errors).find((x) => x.configId === cfg.id)!),
    rosters: leagues.flatMap((l) => rosterGroups(ctxFor(l.configId), [l])),
    freeAgents: leagues.flatMap((l) => freeAgents(ctxFor(l.configId), [l], listFor(l.configId))),
    teamValues: leagues.map((l) => ({ configId: l.configId, league: l.name, rankingLabel: ctxFor(l.configId).rankingLabel ?? '', rows: teamValues(ctxFor(l.configId), l) })),
    tradeFinder: leagues.map((l) => tradeFinder(ctxFor(l.configId), l)),
    picks: leagues.map((l) => draftPicks(ctxFor(l.configId), l)),
    mflCap: leagues.filter((l) => l.platform === 'mfl').map((l) => mflCap(ctxFor(l.configId), l)).filter((v) => v !== null),
    mflExpiring: leagues.filter((l) => l.platform === 'mfl').map((l) => mflExpiring(ctxFor(l.configId), l)),
    mflLeague: leagues.map((l) => mflLeagueView(ctxFor(l.configId), l)).filter((v) => v !== null),
    scoreboard: leagues.map((l) => {
      const cfg = settings.leagues.find((c) => c.id === l.configId);
      const mine = cfg ? findMyTeam(l, cfg.myTeam) : null;
      return buildScoreboard(l, cfg?.recordFormat ?? defaultRecordFormat(l.platform), scoringWeek, mine?.id ?? null);
    }),
    watchlist: watchRows(ctx, leagues, watchlist),
    alerts,
    rankings: fp.map((p) => ({ ...p, age: info.get(p.key)?.age ?? p.age, value: dynastyValue(p.rank) })),
    rankingSets: [...sets.values()].map((r) => ({
      ...r,
      players: r.players.map((p) => ({ ...p, age: info.get(p.key)?.age ?? p.age })),
    })),
    projections,
    news: markMyNews(news?.items ?? [], leagues, settings),
    nflState: nflState ? { season: nflState.season, week: nflState.week, seasonType: nflState.seasonType } : null,
    dfs,
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
      return fetchMflLeague(cfg, settings.season, { apiKey: settings.mflApiKey, cookie: settings.mflCookie, userAgent: settings.mflUserAgent }, store);
  }
}

/** Posts new drop alerts to a Discord or Slack incoming webhook. */
async function notify(url: string, alerts: Alert[]): Promise<void> {
  if (!url) return;
  const lines = alerts.map(
    (a) =>
      `${a.watchlist ? '👀 ' : ''}${a.league}: ${a.player} (${a.pos}${a.rank ? ` #${a.rank}` : ''}) dropped by ${a.droppedBy}`,
  );
  const text = `🔔 Fantasy Football Command Center drop alert\n${lines.join('\n')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Discord reads `content`, Slack reads `text`.
    body: JSON.stringify({ content: text.slice(0, 1900), text }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Joins FantasyPros projections onto the FanDuel player list (DEF matched by team). */
export function mergeDfsProjections(
  slate: { uploadedAt: string; players: Omit<DfsPlayer, 'projection' | 'projectionSource'>[] },
  projections: ProjectionSet | null,
): DfsSlate {
  const byKey = new Map((projections?.players ?? []).map((p) => [p.key, p]));
  const dstByTeam = new Map((projections?.players ?? []).filter((p) => p.pos === 'DST').map((p) => [p.team.toUpperCase(), p]));
  let matched = 0;
  const players: DfsPlayer[] = slate.players.map((p) => {
    const proj = p.pos === 'DEF' ? dstByTeam.get(p.team.toUpperCase()) ?? byKey.get(p.key) : byKey.get(p.key);
    if (proj) matched++;
    return proj
      ? { ...p, projection: proj.points, projectionSource: 'FantasyPros' as const }
      : { ...p, projection: Math.round(p.fppg * 10) / 10, projectionSource: 'FanDuel FPPG' as const };
  });
  const games = [...new Set(slate.players.map((p) => p.game).filter(Boolean))].sort();
  const projectionNote = projections
    ? `FantasyPros week ${projections.week} half-PPR projections for ${matched} of ${players.length} players; the rest use FanDuel's season average (FPPG).`
    : "Using FanDuel's season average (FPPG). Add a FantasyPros API key for weekly projections.";
  return { uploadedAt: slate.uploadedAt, games, projectionNote, players };
}

/** Flags news about players on any of the user's teams. */
function markMyNews(items: Omit<NewsItem, 'mine'>[], leagues: LeagueData[], settings: Settings): NewsItem[] {
  const mine = new Set<string>();
  for (const l of leagues) {
    const cfg = settings.leagues.find((c) => c.id === l.configId);
    const team = cfg && findMyTeam(l, cfg.myTeam);
    for (const p of team?.players ?? []) mine.add(p.key);
  }
  return items.map((n) => ({ ...n, mine: !!n.player && mine.has(normalizeName(n.player)) }));
}
