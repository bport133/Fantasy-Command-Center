// MyFantasyLeague export API: https://api.myfantasyleague.com/2026/api_info

import type { DraftPick, LeagueConfig, LeagueData, RosterPlayer, Slot, Team } from '../../shared/types.js';
import { asArray, getJson } from '../http.js';
import { displayName, normalizeName } from '../names.js';
import { readJson, writeJson } from '../store.js';

const PLAYER_CACHE_MS = 24 * 60 * 60 * 1000;

export function mflHost(host: string | undefined): string {
  const h = (host || 'api.myfantasyleague.com').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9-]+\.myfantasyleague\.com$/i.test(h)) throw new Error(`MFL: "${h}" is not a myfantasyleague.com host`);
  return h;
}

function exportUrl(host: string, season: number, type: string, params: Record<string, string>): string {
  const q = new URLSearchParams({ TYPE: type, JSON: '1', ...params });
  return `https://${host}/${season}/export?${q}`;
}

interface MflPlayer {
  name: string;
  pos: string;
  nfl: string;
}

async function loadMflPlayers(host: string, season: number, apiKey: string, fetchJson: typeof getJson) {
  const file = `cache-mfl-players-${season}.json`;
  const cached = readJson<{ at: number; players: Record<string, MflPlayer> } | null>(file, null);
  if (cached && Date.now() - cached.at < PLAYER_CACHE_MS) return cached.players;
  const params: Record<string, string> = {};
  if (apiKey) params.APIKEY = apiKey;
  const data = await fetchJson(exportUrl(host, season, 'players', params), { label: 'MFL players', timeoutMs: 60000 });
  const players: Record<string, MflPlayer> = {};
  for (const p of asArray<any>(data?.players?.player)) {
    players[p.id] = { name: displayName(p.name ?? ''), pos: p.position === 'Def' ? 'DEF' : p.position, nfl: p.team || 'FA' };
  }
  writeJson(file, { at: Date.now(), players });
  return players;
}

export async function fetchMflLeague(
  cfg: LeagueConfig,
  season: number,
  apiKey: string,
  fetchJson = getJson,
): Promise<LeagueData> {
  const host = mflHost(cfg.host);
  const base: Record<string, string> = { L: cfg.leagueId };
  if (apiKey) base.APIKEY = apiKey;
  const opts = { label: 'MFL' };
  const [league, rosters, standings, picks, players] = await Promise.all([
    fetchJson(exportUrl(host, season, 'league', base), opts),
    fetchJson(exportUrl(host, season, 'rosters', base), opts),
    fetchJson(exportUrl(host, season, 'leagueStandings', base), opts).catch(() => null),
    fetchJson(exportUrl(host, season, 'futureDraftPicks', base), opts).catch(() => null),
    loadMflPlayers(host, season, apiKey, fetchJson),
  ]);
  for (const d of [league, rosters]) {
    if (d?.error) throw new Error(`MFL: ${d.error.$t ?? JSON.stringify(d.error)}`);
  }
  return parseMflLeague(cfg, season, league, rosters, standings, picks, players);
}

export function parseMflLeague(
  cfg: LeagueConfig,
  season: number,
  league: any,
  rosters: any,
  standings: any,
  futurePicks: any,
  players: Record<string, MflPlayer>,
): LeagueData {
  const l = league?.league ?? {};
  const names = new Map<string, string>(asArray<any>(l.franchises?.franchise).map((f) => [f.id, f.name]));
  const records = new Map<string, string>();
  for (const f of asArray<any>(standings?.leagueStandings?.franchise)) {
    const w = f.h2hw ?? f.W;
    const lo = f.h2hl ?? f.L;
    const t = Number(f.h2ht ?? f.T ?? 0);
    if (w !== undefined && lo !== undefined) records.set(f.id, `${w}-${lo}${t ? `-${t}` : ''}`);
  }

  const teams: Team[] = asArray<any>(rosters?.rosters?.franchise).map((f) => {
    const roster: RosterPlayer[] = [];
    for (const rp of asArray<any>(f.player)) {
      const p = players[rp.id];
      if (!p) continue;
      const slot: Slot =
        rp.status === 'TAXI_SQUAD' ? 'Taxi' : rp.status === 'INJURED_RESERVE' ? 'IR' : 'Active';
      roster.push({
        name: p.name,
        key: normalizeName(p.name),
        pos: p.pos,
        nfl: p.nfl,
        slot,
        salary: Number(rp.salary) || 0,
        contractYears: Number(rp.contractYear) || 0,
      });
    }
    return { id: f.id, name: names.get(f.id) ?? `Franchise ${f.id}`, record: records.get(f.id), players: roster };
  });

  let picks: DraftPick[] | null = null;
  if (futurePicks?.futureDraftPicks) {
    picks = [];
    for (const f of asArray<any>(futurePicks.futureDraftPicks.franchise)) {
      for (const p of asArray<any>(f.futureDraftPick)) {
        picks.push({
          season: Number(p.year),
          round: Number(p.round),
          originalTeamId: String(p.originalPickFor),
          ownerTeamId: String(f.id),
        });
      }
    }
  }

  const cap = Number(l.salaryCapAmount);
  return {
    configId: cfg.id,
    platform: 'mfl',
    name: l.name ?? 'MFL league',
    season,
    teams,
    picks,
    salaryCap: cap > 0 ? cap : undefined,
  };
}
