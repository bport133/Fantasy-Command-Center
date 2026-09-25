// Sleeper public API (no auth): https://docs.sleeper.com

import type { DraftPick, LeagueConfig, LeagueData, PlayerInfo, RosterPlayer, Slot, Team } from '../types.ts';
import { getJson } from '../http.ts';
import { normalizeName } from '../names.ts';
import type { Store } from '../store.ts';

const BASE = 'https://api.sleeper.app/v1';
export const PLAYER_CACHE = 'cache:sleeper-players';
const PLAYER_CACHE_MS = 24 * 60 * 60 * 1000;
const FANTASY_POS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

export interface SleeperPlayer {
  name: string;
  pos: string;
  nfl: string;
  birthDate?: string;
  age?: number;
  yearsExp?: number;
}

export type PlayerDb = Record<string, SleeperPlayer>;

/**
 * The full Sleeper player database (~5 MB). Sleeper asks callers to fetch it at most once a
 * day, so it is cached in the database. It doubles as the age/experience source for every platform.
 */
export async function loadSleeperPlayers(store: Store, fetchJson = getJson): Promise<PlayerDb> {
  const cached = await store.get<{ at: number; players: PlayerDb } | null>(PLAYER_CACHE, null);
  const usable = (db?: PlayerDb) => !!db && Object.keys(db).length > 0;
  if (cached && usable(cached.players) && Date.now() - cached.at < PLAYER_CACHE_MS) return cached.players;
  try {
    const raw = await fetchJson<Record<string, any>>(`${BASE}/players/nfl`, {
      label: 'Sleeper players',
      timeoutMs: 90000,
    });
    const players = trimPlayerDb(raw ?? {});
    if (!usable(players)) throw new Error('Sleeper players: empty response');
    await store.set(PLAYER_CACHE, { at: Date.now(), players });
    return players;
  } catch (err) {
    if (cached && usable(cached.players)) return cached.players; // stale beats nothing
    throw err;
  }
}

export function trimPlayerDb(raw: Record<string, any>): PlayerDb {
  const out: PlayerDb = {};
  for (const [id, p] of Object.entries(raw)) {
    if (!p || !FANTASY_POS.has(p.position)) continue;
    const name = p.full_name ?? (p.position === 'DEF' ? `${p.team} D/ST` : `${p.first_name} ${p.last_name}`);
    out[id] = {
      name,
      pos: p.position,
      nfl: p.team ?? 'FA',
      birthDate: p.birth_date ?? undefined,
      age: p.age ?? undefined,
      yearsExp: p.years_exp ?? undefined,
    };
  }
  return out;
}

export function ageFrom(birthDate: string | undefined, now = new Date()): number | undefined {
  if (!birthDate) return undefined;
  const t = Date.parse(birthDate);
  if (Number.isNaN(t)) return undefined;
  return Math.round(((now.getTime() - t) / (365.25 * 86400000)) * 10) / 10;
}

/** Name-keyed age/experience lookup built from the Sleeper database. */
export function playerInfoIndex(db: PlayerDb): Map<string, PlayerInfo> {
  const index = new Map<string, PlayerInfo>();
  for (const p of Object.values(db)) {
    const key = normalizeName(p.name);
    const info = { age: ageFrom(p.birthDate) ?? p.age, yearsExp: p.yearsExp };
    // Prefer the rostered (team != FA) player when two share a name.
    if (!index.has(key) || p.nfl !== 'FA') index.set(key, info);
  }
  return index;
}

export async function fetchSleeperLeague(
  cfg: LeagueConfig,
  season: number,
  players: PlayerDb,
  fetchJson = getJson,
): Promise<LeagueData> {
  const id = encodeURIComponent(cfg.leagueId);
  const opts = { label: 'Sleeper' };
  const [league, users, rosters, traded] = await Promise.all([
    fetchJson(`${BASE}/league/${id}`, opts),
    fetchJson<any[]>(`${BASE}/league/${id}/users`, opts),
    fetchJson<any[]>(`${BASE}/league/${id}/rosters`, opts),
    fetchJson<any[]>(`${BASE}/league/${id}/traded_picks`, opts),
  ]);
  if (!league) throw new Error('Sleeper: league not found (check the league id)');
  return parseSleeperLeague(cfg, season, league, users ?? [], rosters ?? [], traded ?? [], players);
}

export function parseSleeperLeague(
  cfg: LeagueConfig,
  season: number,
  league: any,
  users: any[],
  rosters: any[],
  traded: any[],
  players: PlayerDb,
): LeagueData {
  const userById = new Map(users.map((u) => [u.user_id, u]));
  const teams: Team[] = rosters.map((r) => {
    const user = userById.get(r.owner_id);
    const starters = new Set<string>(r.starters ?? []);
    const reserve = new Set<string>(r.reserve ?? []);
    const taxi = new Set<string>(r.taxi ?? []);
    const roster: RosterPlayer[] = [];
    for (const pid of (r.players ?? []) as string[]) {
      const p = players[pid];
      if (!p) continue;
      const slot: Slot = reserve.has(pid) ? 'IR' : taxi.has(pid) ? 'Taxi' : starters.has(pid) ? 'Starter' : 'Bench';
      roster.push({ name: p.name, key: normalizeName(p.name), pos: p.pos, nfl: p.nfl, slot });
    }
    const s = r.settings ?? {};
    return {
      id: String(r.roster_id),
      name: user?.metadata?.team_name || user?.display_name || `Team ${r.roster_id}`,
      owner: user?.display_name,
      record: `${s.wins ?? 0}-${s.losses ?? 0}${s.ties ? `-${s.ties}` : ''}`,
      players: roster,
    };
  });

  // Sleeper only lists picks that changed hands; every other future pick is still with its original team.
  const rounds = Number(league.settings?.draft_rounds) || 4;
  const firstSeason = league.status === 'pre_draft' ? season : season + 1;
  const owner = new Map<string, string>();
  for (const t of traded) {
    owner.set(`${t.season}:${t.round}:${t.roster_id}`, String(t.owner_id));
  }
  const picks: DraftPick[] = [];
  for (let yr = firstSeason; yr < firstSeason + 3; yr++) {
    for (let round = 1; round <= rounds; round++) {
      for (const t of teams) {
        picks.push({
          season: yr,
          round,
          originalTeamId: t.id,
          ownerTeamId: owner.get(`${yr}:${round}:${t.id}`) ?? t.id,
        });
      }
    }
  }

  return { configId: cfg.id, platform: 'sleeper', name: league.name ?? 'Sleeper league', season, teams, picks };
}
