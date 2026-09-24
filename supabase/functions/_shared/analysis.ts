// Everything the spreadsheet computed, as pure functions over normalized league data.

import {
  POSITIONS,
  type Alert,
  type CapPositionRow,
  type CapRoomRow,
  type CapYear,
  type ContractRow,
  type EnrichedPlayer,
  type ExpiringRow,
  type FPPlayer,
  type FreeAgentRow,
  type LeagueData,
  type LeagueSummary,
  type MflCapView,
  type MflExpiringView,
  type PicksLeague,
  type PlayerInfo,
  type Position,
  type RosterGroup,
  type Settings,
  type Team,
  type TeamValueRow,
  type TradeFinderLeague,
  type TradeTarget,
  type WatchRow,
} from './types.ts';
import { dynastyValue, normalizeName } from './names.ts';

export interface Context {
  settings: Settings;
  fp: Map<string, FPPlayer>;
  info: Map<string, PlayerInfo>;
  watch: Set<string>;
}

export function makeContext(
  settings: Settings,
  fpList: FPPlayer[],
  info: Map<string, PlayerInfo>,
  watchlist: string[],
): Context {
  return {
    settings,
    fp: new Map(fpList.map((p) => [p.key, p])),
    info,
    watch: new Set(watchlist.map(normalizeName)),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function findMyTeam(league: LeagueData, myTeam: string): Team | null {
  const want = myTeam.trim().toLowerCase();
  if (!want) return null;
  return (
    league.teams.find((t) => t.id.toLowerCase() === want) ??
    league.teams.find((t) => t.name.toLowerCase() === want) ??
    league.teams.find((t) => t.owner?.toLowerCase() === want) ??
    null
  );
}

export function enrich(ctx: Context, p: { key: string } & Record<string, any>): EnrichedPlayer {
  const fp = ctx.fp.get(p.key);
  const info = ctx.info.get(p.key);
  return {
    ...(p as any),
    age: info?.age ?? fp?.age,
    yearsExp: info?.yearsExp,
    rank: fp?.rank,
    tier: fp?.tier,
    value: dynastyValue(fp?.rank),
  };
}

const byValue = (a: EnrichedPlayer, b: EnrichedPlayer) =>
  b.value - a.value || a.name.localeCompare(b.name);

// ---------- Rosters & team values ----------

export function rosterGroups(ctx: Context, leagues: LeagueData[]): RosterGroup[] {
  const out: RosterGroup[] = [];
  for (const league of leagues) {
    const cfg = ctx.settings.leagues.find((l) => l.id === league.configId);
    const mine = cfg && findMyTeam(league, cfg.myTeam);
    if (!mine) continue;
    out.push({
      configId: league.configId,
      platform: league.platform,
      league: league.name,
      team: mine.name,
      hasContracts: league.platform === 'mfl',
      players: mine.players.map((p) => enrich(ctx, p)).sort(byValue),
    });
  }
  return out;
}

export function teamValues(ctx: Context, league: LeagueData): TeamValueRow[] {
  const cfg = ctx.settings.leagues.find((l) => l.id === league.configId);
  const mine = cfg ? findMyTeam(league, cfg.myTeam) : null;
  const rows = league.teams.map((t) => {
    const players = t.players.map((p) => enrich(ctx, p));
    const byPos = Object.fromEntries(POSITIONS.map((pos) => [pos, 0])) as Record<Position, number>;
    for (const p of players) if (p.pos in byPos) byPos[p.pos as Position] += p.value;
    const ranked = players.filter((p) => p.rank);
    return {
      rank: 0,
      teamId: t.id,
      team: t.name,
      record: t.record,
      total: players.reduce((s, p) => s + p.value, 0),
      byPos,
      top100: ranked.filter((p) => p.rank! <= 100).length,
      avgAge: (() => {
        const a = avg(ranked.map((p) => p.age).filter((x): x is number => x !== undefined));
        return a === null ? null : round1(a);
      })(),
      mine: t === mine,
    };
  });
  rows.sort((a, b) => b.total - a.total);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

export function leagueSummaries(
  ctx: Context,
  leagues: LeagueData[],
  errors: Map<string, string>,
): LeagueSummary[] {
  return ctx.settings.leagues.map((cfg) => {
    const league = leagues.find((l) => l.configId === cfg.id);
    const platformName = { sleeper: 'Sleeper', espn: 'ESPN', mfl: 'MFL' }[cfg.platform];
    if (!league) {
      return {
        configId: cfg.id,
        platform: cfg.platform,
        name: `${platformName} ${cfg.leagueId}`,
        myTeam: null,
        valueRank: null,
        teamCount: 0,
        top100: 0,
        avgAge: null,
        status: `❌ ${errors.get(cfg.id) ?? 'Not loaded yet'}`,
      };
    }
    const values = teamValues(ctx, league);
    const me = values.find((r) => r.mine);
    return {
      configId: cfg.id,
      platform: cfg.platform,
      name: league.name,
      myTeam: me?.team ?? null,
      record: me?.record,
      valueRank: me?.rank ?? null,
      teamCount: values.length,
      top100: me?.top100 ?? 0,
      avgAge: me?.avgAge ?? null,
      status: errors.has(cfg.id)
        ? `⚠️ Showing last good data: ${errors.get(cfg.id)}`
        : me
          ? '✅ OK'
          : '⚠️ Pick your team in Settings',
    };
  });
}

// ---------- Free agents & watchlist ----------

export function rosteredKeys(league: LeagueData): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of league.teams) for (const p of t.players) m.set(p.key, t.name);
  return m;
}

export function freeAgents(ctx: Context, leagues: LeagueData[], fpList: FPPlayer[]): FreeAgentRow[] {
  const out: FreeAgentRow[] = [];
  for (const league of leagues) {
    const taken = rosteredKeys(league);
    let n = 0;
    for (const p of fpList) {
      if (n >= ctx.settings.freeAgentsPerLeague) break;
      if (taken.has(p.key)) continue;
      const info = ctx.info.get(p.key);
      out.push({
        configId: league.configId,
        league: league.name,
        rank: p.rank,
        tier: p.tier,
        name: p.name,
        pos: p.pos,
        nfl: p.nfl,
        age: info?.age ?? p.age,
        yearsExp: info?.yearsExp,
        watched: ctx.watch.has(p.key),
      });
      n++;
    }
  }
  return out;
}

export function watchRows(ctx: Context, leagues: LeagueData[], watchlist: string[]): WatchRow[] {
  const holders = leagues.map((l) => ({ id: l.configId, taken: rosteredKeys(l) }));
  return watchlist.map((name) => {
    const key = normalizeName(name);
    const fp = ctx.fp.get(key);
    const status: Record<string, string> = {};
    for (const h of holders) status[h.id] = h.taken.get(key) ?? 'FA';
    return { name: fp?.name ?? name, pos: fp?.pos, rank: fp?.rank, status };
  });
}

// ---------- Trade finder ----------

/** Position strengths relative to the league average; >1 means above average. */
function positionIndex(rows: TeamValueRow[]): Map<string, Record<Position, number>> {
  const leagueAvg = Object.fromEntries(
    POSITIONS.map((pos) => [pos, avg(rows.map((r) => r.byPos[pos])) || 1]),
  ) as Record<Position, number>;
  return new Map(
    rows.map((r) => [
      r.teamId,
      Object.fromEntries(POSITIONS.map((pos) => [pos, r.byPos[pos] / leagueAvg[pos]])) as Record<Position, number>,
    ]),
  );
}

function extremes(idx: Record<Position, number>): { surplus: Position; need: Position } {
  const sorted = [...POSITIONS].sort((a, b) => idx[b] - idx[a]);
  return { surplus: sorted[0], need: sorted[sorted.length - 1] };
}

export function tradeFinder(ctx: Context, league: LeagueData): TradeFinderLeague {
  const cfg = ctx.settings.leagues.find((l) => l.id === league.configId);
  const mine = cfg ? findMyTeam(league, cfg.myTeam) : null;
  const base = { configId: league.configId, league: league.name };
  if (!mine) return { ...base, myStrength: null, myNeed: null, rows: [] };

  const rows = teamValues(ctx, league);
  const idx = positionIndex(rows);
  const me = extremes(idx.get(mine.id)!);
  const top = (team: Team, pos: Position) =>
    team.players
      .map((p) => enrich(ctx, p))
      .filter((p) => p.pos === pos && p.rank)
      .sort(byValue)
      .slice(0, 3)
      .map((p) => ({ name: p.name, rank: p.rank! }));

  const out: (TradeTarget & { score: number })[] = [];
  for (const team of league.teams) {
    if (team === mine) continue;
    const them = extremes(idx.get(team.id)!);
    const gives = them.surplus === me.need;
    const wants = them.need === me.surplus;
    if (!gives && !wants) continue;
    const targets = top(team, me.need);
    const offers = top(mine, them.need);
    if (!targets.length || !offers.length) continue;
    out.push({
      fit: gives && wants ? 'Strong' : 'Partial',
      team: team.name,
      theirSurplus: them.surplus,
      theirNeed: them.need,
      targets,
      offers,
      score: (gives && wants ? 1e6 : 0) + dynastyValue(targets[0].rank),
    });
  }
  out.sort((a, b) => b.score - a.score);
  return { ...base, myStrength: me.surplus, myNeed: me.need, rows: out.map(({ score, ...r }) => r) };
}

// ---------- Draft picks ----------

export function draftPicks(ctx: Context, league: LeagueData): PicksLeague {
  const base = { configId: league.configId, league: league.name };
  const cfg = ctx.settings.leagues.find((l) => l.id === league.configId);
  const mine = cfg ? findMyTeam(league, cfg.myTeam) : null;
  if (!league.picks) return { ...base, supported: false, picks: [] };
  if (!mine) return { ...base, supported: true, picks: [] };
  const name = new Map(league.teams.map((t) => [t.id, t.name]));
  const held = league.picks
    .filter((p) => p.ownerTeamId === mine.id)
    .map((p) => ({
      season: p.season,
      round: p.round,
      source: p.originalTeamId === mine.id ? 'Own' : `via ${name.get(p.originalTeamId) ?? p.originalTeamId}`,
    }))
    .sort((a, b) => a.season - b.season || a.round - b.round);
  const gone = league.picks
    .filter((p) => p.originalTeamId === mine.id && p.ownerTeamId !== mine.id)
    .map((p) => ({ season: p.season, round: p.round, source: `Owned by ${name.get(p.ownerTeamId) ?? p.ownerTeamId}` }))
    .sort((a, b) => a.season - b.season || a.round - b.round);
  return { ...base, supported: true, picks: [...held, ...gone] };
}

// ---------- MFL contracts ----------

/** Contract years remaining in a given season: 4.5 years now -> 3.5 next season, etc. */
export function yearsIn(contractYears: number, offset: number): number {
  return Math.max(0, contractYears - offset);
}

/** Final season a contract covers: 1 or 1.5 years left -> this season... */
export function finalSeason(season: number, contractYears: number): number {
  return season + Math.max(1, Math.ceil(contractYears)) - 1;
}

export function mflCap(ctx: Context, league: LeagueData): MflCapView | null {
  const cfg = ctx.settings.leagues.find((l) => l.id === league.configId);
  const mine = cfg ? findMyTeam(league, cfg.myTeam) : null;
  if (!mine) return null;
  const n = Math.max(1, ctx.settings.projectionYears);
  const seasons = Array.from({ length: n }, (_, i) => league.season + i);
  const cap = league.salaryCap ?? ctx.settings.mflSalaryCap;
  const yearsCap = ctx.settings.mflContractYearCap;

  const contracts: ContractRow[] = mine.players
    .map((p) => {
      const e = enrich(ctx, p);
      const yrs = p.contractYears ?? 0;
      const salary = p.salary ?? 0;
      return {
        name: p.name,
        pos: p.pos,
        nfl: p.nfl,
        slot: p.slot,
        rank: e.rank,
        salary,
        contractYears: yrs,
        finalSeason: finalSeason(league.season, yrs),
        bySeason: seasons.map((_, i) => (yearsIn(yrs, i) > 0 ? salary : null)),
        yearsBySeason: seasons.map((_, i) => yearsIn(yrs, i)),
      };
    })
    .sort(
      (a, b) =>
        POSITIONS.indexOf(a.pos as Position) - POSITIONS.indexOf(b.pos as Position) ||
        b.salary - a.salary ||
        a.name.localeCompare(b.name),
    );

  const years: CapYear[] = seasons.map((season, i) => {
    const active = contracts.filter((c) => c.bySeason[i] !== null);
    const committed = active.reduce((s, c) => s + c.salary, 0);
    const yearsCommitted = contracts.reduce((s, c) => s + c.yearsBySeason[i], 0);
    return {
      season,
      cap,
      committed,
      remaining: cap - committed,
      contracts: active.length,
      pctUsed: cap ? committed / cap : 0,
      avgSalary: active.length ? Math.round(committed / active.length) : 0,
      yearsCap,
      yearsCommitted,
      yearsRemaining: yearsCap - yearsCommitted,
      pctYearsUsed: yearsCap ? yearsCommitted / yearsCap : 0,
    };
  });

  const thisYear = contracts.filter((c) => c.bySeason[0] !== null);
  const positions: CapPositionRow[] = POSITIONS.map((pos) => {
    const ps = thisYear.filter((c) => c.pos === pos);
    const total = ps.reduce((s, c) => s + c.salary, 0);
    return { pos, players: ps.length, total, avg: ps.length ? Math.round(total / ps.length) : 0, pct: cap ? total / cap : 0, capRank: 0 };
  });
  [...positions].sort((a, b) => b.total - a.total).forEach((p, i) => (p.capRank = i + 1));

  return { configId: league.configId, league: league.name, seasons, years, positions, contracts };
}

export function mflExpiring(ctx: Context, league: LeagueData): MflExpiringView {
  const cfg = ctx.settings.leagues.find((l) => l.id === league.configId);
  const mine = cfg ? findMyTeam(league, cfg.myTeam) : null;
  const cap = league.salaryCap ?? ctx.settings.mflSalaryCap;
  const expiring: ExpiringRow[] = [];
  const capRoom: CapRoomRow[] = [];

  for (const team of league.teams) {
    let committed = 0;
    let yearsCommitted = 0;
    let expiringValue = 0;
    for (const p of team.players) {
      const yrs = p.contractYears ?? 0;
      const salary = p.salary ?? 0;
      const ends = finalSeason(league.season, yrs);
      const e = enrich(ctx, p);
      if (ends <= league.season + 1) {
        expiring.push({
          endsAfter: ends,
          rank: e.rank,
          name: p.name,
          pos: p.pos,
          age: e.age,
          team: team.name,
          salary,
          contractYears: yrs,
          mine: team === mine,
        });
      }
      if (yearsIn(yrs, 1) > 0) committed += salary;
      yearsCommitted += yearsIn(yrs, 1);
      if (ends <= league.season) expiringValue += e.value;
    }
    capRoom.push({ team: team.name, committed, room: cap - committed, yearsCommitted, expiringValue, mine: team === mine });
  }

  expiring.sort(
    (a, b) => a.endsAfter - b.endsAfter || (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.name.localeCompare(b.name),
  );
  capRoom.sort((a, b) => b.room - a.room);
  return { configId: league.configId, league: league.name, nextSeason: league.season + 1, expiring, capRoom };
}

// ---------- Drop alerts ----------

/** configId -> (player key -> team name) for every rostered player. */
export type RosterState = Record<string, Record<string, string>>;

export function rosterState(leagues: LeagueData[]): RosterState {
  const state: RosterState = {};
  for (const l of leagues) state[l.configId] = Object.fromEntries(rosteredKeys(l));
  return state;
}

/**
 * Players who were on a roster at the last refresh and are now unrostered. Only top-N ranked
 * players and watchlist players raise an alert. Leagues missing from either snapshot are
 * skipped so a failed fetch never looks like a mass release.
 */
export function detectDrops(
  ctx: Context,
  prev: RosterState,
  leagues: LeagueData[],
  now: Date,
): Alert[] {
  const alerts: Alert[] = [];
  for (const league of leagues) {
    const before = prev[league.configId];
    if (!before) continue;
    const after = rosteredKeys(league);
    if (after.size === 0) continue;
    for (const [key, team] of Object.entries(before)) {
      if (after.has(key)) continue;
      const fp = ctx.fp.get(key);
      const watched = ctx.watch.has(key);
      if (!watched && !(fp && fp.rank <= ctx.settings.alertTopN)) continue;
      alerts.push({
        when: now.toISOString(),
        configId: league.configId,
        league: league.name,
        player: fp?.name ?? key,
        pos: fp?.pos ?? '',
        rank: fp?.rank,
        droppedBy: team,
        watchlist: watched,
      });
    }
  }
  return alerts.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
}
