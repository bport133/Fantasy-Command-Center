// ESPN Fantasy Football (unofficial v3 API). Private leagues need the espn_s2 and SWID
// cookies from a logged-in browser session.

import type { LeagueConfig, LeagueData, RosterPlayer, Slot, Team } from '../types.ts';
import { getJson } from '../http.ts';
import { normalizeName } from '../names.ts';

const POS: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };

const NFL: Record<number, string> = {
  0: 'FA', 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
  9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN',
  17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
  25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};

const BENCH_SLOT = 20;
const IR_SLOT = 21;

/**
 * Accepts the SWID either bare ("{ABC-...}") or in the {"swid":"{...}"} form some cookie
 * export tools produce, and returns the braced GUID ESPN expects.
 */
export function cleanSwid(raw: string): string {
  const m = raw.match(/\{?([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\}?/);
  return m ? `{${m[1].toUpperCase()}}` : raw.trim();
}

export function espnHeaders(espnS2: string, swid: string): Record<string, string> {
  if (!espnS2 || !swid) return {};
  return { cookie: `espn_s2=${espnS2.trim()}; SWID=${cleanSwid(swid)}` };
}

export async function fetchEspnLeague(
  cfg: LeagueConfig,
  season: number,
  creds: { espnS2: string; espnSwid: string },
  fetchJson = getJson,
): Promise<LeagueData> {
  const url =
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}` +
    `/segments/0/leagues/${encodeURIComponent(cfg.leagueId)}?view=mTeam&view=mRoster&view=mSettings`;
  const data = await fetchJson(url, { label: 'ESPN', headers: espnHeaders(creds.espnS2, creds.espnSwid) });
  return parseEspnLeague(cfg, season, data);
}

export function parseEspnLeague(cfg: LeagueConfig, season: number, data: any): LeagueData {
  if (!data?.teams) throw new Error('ESPN: no teams in response (private league? add espn_s2 and SWID)');
  const members = new Map<string, any>((data.members ?? []).map((m: any) => [m.id, m]));
  const teams: Team[] = data.teams.map((t: any) => {
    const players: RosterPlayer[] = [];
    for (const e of t.roster?.entries ?? []) {
      const p = e.playerPoolEntry?.player;
      if (!p?.fullName) continue;
      const slot: Slot = e.lineupSlotId === IR_SLOT ? 'IR' : e.lineupSlotId === BENCH_SLOT ? 'Bench' : 'Starter';
      players.push({
        name: p.fullName,
        key: normalizeName(p.fullName),
        pos: POS[p.defaultPositionId] ?? '?',
        nfl: NFL[p.proTeamId] ?? 'FA',
        slot,
      });
    }
    const owner = members.get(t.primaryOwner ?? t.owners?.[0]);
    const rec = t.record?.overall;
    return {
      id: String(t.id),
      name: t.name || `${t.location ?? ''} ${t.nickname ?? ''}`.trim() || `Team ${t.id}`,
      owner: owner ? `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim() || owner.displayName : undefined,
      record: rec ? `${rec.wins}-${rec.losses}${rec.ties ? `-${rec.ties}` : ''}` : undefined,
      players,
    };
  });
  return {
    configId: cfg.id,
    platform: 'espn',
    name: data.settings?.name ?? 'ESPN league',
    season,
    teams,
    picks: null,
  };
}
