import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContext, planKeepers } from '../supabase/functions/_shared/analysis.ts';
import { dfsRankings, FANDUEL, lineupsCsv, optimizeLineup, optimizeLineups, parseFanDuelCsv } from '../supabase/functions/_shared/dfs.ts';
import { isPreseason, rankingFor } from '../supabase/functions/_shared/formats.ts';
import { normalizeName } from '../supabase/functions/_shared/names.ts';
import { parseFantasyProsNews, parseFantasyProsProjections } from '../supabase/functions/_shared/providers/fantasypros.ts';
import { mergeDfsProjections, refresh } from '../supabase/functions/_shared/refresh.ts';
import { DEFAULT_SETTINGS, loadSettings, mergeSettings } from '../supabase/functions/_shared/settings.ts';
import { memoryStore } from '../supabase/functions/_shared/store.ts';
import type { DfsPlayer, FPPlayer, Settings } from '../supabase/functions/_shared/types.ts';

const inSeason = { season: 2026, week: 3, seasonType: 'regular' };
const preseason = { season: 2026, week: 1, seasonType: 'pre' };

describe('league formats', () => {
  it('picks rankings by format and time of year', () => {
    const s = { ...DEFAULT_SETTINGS, fpScoring: 'PPR' };
    expect(rankingFor({ format: 'dynasty' }, s, inSeason)).toEqual({ type: 'dynasty', scoring: 'PPR' });
    expect(rankingFor({ format: 'redraft' }, s, inSeason)).toEqual({ type: 'ros', scoring: 'PPR' });
    expect(rankingFor({ format: 'redraft' }, s, preseason)).toEqual({ type: 'draft', scoring: 'PPR' });
    expect(rankingFor({ format: 'keeper', scoring: 'HALF' }, s, inSeason)).toEqual({ type: 'ros', scoring: 'HALF' });
    expect(rankingFor({ format: 'redraft', rankings: 'weekly' }, s, inSeason)).toEqual({ type: 'weekly', scoring: 'PPR' });
    expect(rankingFor({}, s, null)).toEqual({ type: 'dynasty', scoring: 'PPR' }); // old leagues stay dynasty
    expect(isPreseason({ season: 2026, week: 1, seasonType: 'off' })).toBe(true);
  });

  it('validates per-league settings and keeps old leagues as dynasty', async () => {
    const s = mergeSettings(DEFAULT_SETTINGS, {
      leagues: [
        { id: 'a', platform: 'sleeper', leagueId: '1', myTeam: 'x', format: 'keeper', keepers: 99, rankings: 'bogus', scoring: 'HALF' } as any,
        { id: 'b', platform: 'espn', leagueId: '2', myTeam: 'y', format: 'nope' } as any,
      ],
      fpTypes: ['ros', 'made-up', 'dynasty'] as any,
    });
    expect(s.leagues[0]).toMatchObject({ format: 'keeper', keepers: 25, rankings: 'auto', scoring: 'HALF' });
    expect(s.leagues[1]).toMatchObject({ format: 'dynasty', rankings: 'auto', scoring: 'default' });
    expect(s.fpTypes).toEqual(['ros', 'dynasty']);

    const store = memoryStore({ settings: { leagues: [{ id: 'old', platform: 'mfl', leagueId: '3', myTeam: 'z' }] } });
    expect((await loadSettings(store)).leagues[0]).toMatchObject({ format: 'dynasty', rankings: 'auto' });
  });

  it('plans keepers by long-term value', () => {
    const fp = (rank: number, name: string): FPPlayer => ({ rank, tier: 1, name, key: normalizeName(name), nfl: 'X', pos: 'WR' });
    const now = [fp(1, 'Old Vet'), fp(20, 'Young Star'), fp(40, 'Rookie')];
    const dynasty = [fp(60, 'Old Vet'), fp(3, 'Young Star'), fp(10, 'Rookie')];
    const ctx = makeContext(DEFAULT_SETTINGS, now, new Map(), [], { longTerm: dynasty });
    const team = {
      id: '1',
      name: 'Me',
      players: ['Old Vet', 'Young Star', 'Rookie'].map((n) => ({ name: n, key: normalizeName(n), pos: 'WR', nfl: 'X', slot: 'Bench' as const })),
    };
    const plan = planKeepers(ctx, team, 2);
    expect(plan.players.map((p) => p.name)).toEqual(['Young Star', 'Rookie']);
    expect(plan.basis).toMatch(/dynasty/);
  });
});

describe('refresh with formats', () => {
  const rankingsFor = (type: string) => ({
    players: [
      { player_name: 'Joe Burrow', player_team_id: 'CIN', player_position_id: 'QB', rank_ecr: type === 'ros' ? 2 : 30, tier: 1 },
      { player_name: 'Nico Collins', player_team_id: 'HOU', player_position_id: 'WR', rank_ecr: type === 'ros' ? 50 : 5, tier: 1 },
    ],
  });
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const u = new URL(String(input));
        calls.push(u.toString());
        let body: unknown = {};
        if (u.host === 'api.fantasypros.com') {
          body = u.pathname.endsWith('consensus-rankings') ? rankingsFor(u.searchParams.get('type')!) : { players: [] };
        } else if (u.pathname === '/v1/state/nfl') body = { season: '2026', week: 3, season_type: 'regular' };
        else if (u.pathname === '/v1/players/nfl') body = { '1': { full_name: 'Joe Burrow', position: 'QB', team: 'CIN' }, '2': { full_name: 'Nico Collins', position: 'WR', team: 'HOU' } };
        else if (u.pathname.endsWith('/users')) body = [{ user_id: 'u1', display_name: 'me' }];
        else if (u.pathname.endsWith('/rosters')) body = [{ roster_id: 1, owner_id: 'u1', players: ['1', '2'], settings: {} }];
        else if (u.pathname.endsWith('/traded_picks')) body = [];
        else if (u.pathname.startsWith('/v1/league/')) body = { name: 'L', settings: { draft_rounds: 3 } };
        return new Response(JSON.stringify(body));
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('values each league with its own rankings and caches them', async () => {
    const store = memoryStore({
      settings: {
        fpApiKey: 'k',
        fpTypes: ['dynasty'],
        leagues: [
          { id: 'dyn', platform: 'sleeper', leagueId: '1', myTeam: 'me', format: 'dynasty' },
          { id: 'red', platform: 'sleeper', leagueId: '2', myTeam: 'me', format: 'redraft' },
        ],
      },
    });
    const snap = await refresh(store);
    const byId = Object.fromEntries(snap.rosters.map((r) => [r.configId, r]));
    expect(byId.dyn.rankingLabel).toBe('Dynasty · PPR');
    expect(byId.red.rankingLabel).toBe('Rest of season · PPR');
    expect(byId.dyn.players[0].name).toBe('Nico Collins'); // dynasty #5
    expect(byId.red.players[0].name).toBe('Joe Burrow'); // ROS #2
    expect(snap.leagues.map((l) => l.format)).toEqual(['dynasty', 'redraft']);
    expect(snap.rankingSets.map((r) => r.type).sort()).toEqual(['dynasty', 'ros']);
    expect(snap.nflState).toEqual(inSeason);

    // A second refresh within the cache window doesn't ask FantasyPros for rankings again.
    const before = calls.filter((c) => c.includes('consensus-rankings')).length;
    await refresh(store);
    expect(calls.filter((c) => c.includes('consensus-rankings')).length).toBe(before);
  });
});

describe('FantasyPros projections and news', () => {
  it('reads points from the usual fields and normalizes defenses', () => {
    const p = parseFantasyProsProjections({
      players: [
        { name: 'Joe Burrow', team_id: 'CIN', position_id: 'QB', stats: { points: '21.44' } },
        { player_name: 'Bills', team: 'BUF', position: 'DEF', fpts: 9 },
        { name: 'No Points', position_id: 'WR', stats: {} },
      ],
    });
    expect(p).toEqual([
      { name: 'Joe Burrow', key: 'joe burrow', pos: 'QB', team: 'CIN', points: 21.4 },
      { name: 'Bills', key: 'bills', pos: 'DST', team: 'BUF', points: 9 },
    ]);
    const n = parseFantasyProsNews({ items: [{ title: 'Hello', player_name: 'Joe Burrow', updated: 1758700000 }, { nope: 1 }] });
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ title: 'Hello', player: 'Joe Burrow' });
    expect(n[0].time).toMatch(/^2025-09/);
  });
});

// ---------- DFS ----------

const CSV = [
  '"Id","Position","First Name","Nickname","Last Name","FPPG","Played","Salary","Game","Team","Opponent","Injury Indicator","Injury Details"',
  '"101-1","QB","Joe","Joe Burrow","Burrow","20.5","3","8800","CIN@BAL","CIN","BAL","",""',
  '"101-2","D","Buffalo","Buffalo Bills","Bills","8.1","3","4500","BUF@MIA","BUF","MIA","",""',
  '"101-3","WR","Hurt","Hurt Guy","Guy","12","3","6000","BUF@MIA","BUF","MIA","O","Knee"',
  '"101-4","K","Kick","Kick Er","Er","8","3","5000","BUF@MIA","BUF","MIA","",""',
].join('\n');

describe('FanDuel player list', () => {
  it('parses players, maps D to DEF and skips kickers', () => {
    const ps = parseFanDuelCsv(CSV);
    expect(ps.map((p) => [p.id, p.name, p.pos, p.salary, p.injury])).toEqual([
      ['101-1', 'Joe Burrow', 'QB', 8800, ''],
      ['101-2', 'Buffalo Bills', 'DEF', 4500, ''],
      ['101-3', 'Hurt Guy', 'WR', 6000, 'O'],
    ]);
    expect(() => parseFanDuelCsv('a,b\n1,2')).toThrow(/FanDuel players list/);
  });

  it('merges FantasyPros projections, falling back to FPPG', () => {
    const slate = { uploadedAt: 'now', players: parseFanDuelCsv(CSV) };
    const merged = mergeDfsProjections(slate, {
      week: 3,
      scoring: 'HALF',
      at: 'now',
      players: [
        { name: 'Joe Burrow', key: 'joe burrow', pos: 'QB', team: 'CIN', points: 23 },
        { name: 'Bills D/ST', key: 'bills dst', pos: 'DST', team: 'BUF', points: 7 },
      ],
    });
    expect(merged.players.map((p) => [p.name, p.projection, p.projectionSource])).toEqual([
      ['Joe Burrow', 23, 'FantasyPros'],
      ['Buffalo Bills', 7, 'FantasyPros'],
      ['Hurt Guy', 12, 'FanDuel FPPG'],
    ]);
    expect(merged.games).toEqual(['BUF@MIA', 'CIN@BAL']);
  });
});

/** Deterministic pseudo-random numbers so the brute-force comparison is repeatable. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

function makePool(seed: number, counts: Record<string, number>): DfsPlayer[] {
  const r = rng(seed);
  const teams = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF'];
  const out: DfsPlayer[] = [];
  let id = 0;
  for (const [pos, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) {
      const salary = (pos === 'DEF' ? 30 : pos === 'QB' ? 65 : 45) * 100 + Math.floor(r() * 40) * 100;
      out.push({
        id: String(++id),
        name: `${pos}${i}`,
        key: `${pos}${i}`.toLowerCase(),
        pos,
        team: teams[Math.floor(r() * teams.length)],
        opp: '',
        game: '',
        salary,
        fppg: 0,
        injury: '',
        projection: Math.round((salary / 1000) * (1.2 + r()) * 10) / 10,
        projectionSource: 'FanDuel FPPG',
      });
    }
  }
  return out;
}

function bruteForce(pool: DfsPlayer[]): number {
  const by = (pos: string) => pool.filter((p) => p.pos === pos);
  const combos = <T,>(xs: T[], k: number): T[][] =>
    k === 0 ? [[]] : xs.flatMap((x, i) => combos(xs.slice(i + 1), k - 1).map((c) => [x, ...c]));
  let best = -1;
  for (const [rb, wr, te] of [[3, 3, 1], [2, 4, 1], [2, 3, 2]]) {
    for (const q of by('QB'))
      for (const d of by('DEF'))
        for (const rs of combos(by('RB'), rb))
          for (const ws of combos(by('WR'), wr))
            for (const ts of combos(by('TE'), te)) {
              const all = [q, d, ...rs, ...ws, ...ts];
              if (all.reduce((s, p) => s + p.salary, 0) > FANDUEL.salaryCap) continue;
              const teamCounts = new Map<string, number>();
              for (const p of all) teamCounts.set(p.team, (teamCounts.get(p.team) ?? 0) + 1);
              if ([...teamCounts.values()].some((c) => c > FANDUEL.maxPerTeam)) continue;
              best = Math.max(best, Math.round(all.reduce((s, p) => s + p.projection, 0) * 10) / 10);
            }
  }
  return best;
}

describe('FanDuel lineup optimizer', () => {
  it.each([1, 2, 3, 4, 5])('matches brute force on a small slate (seed %i)', (seed) => {
    const pool = makePool(seed, { QB: 3, RB: 5, WR: 6, TE: 3, DEF: 2 });
    const lineup = optimizeLineup(pool)!;
    expect(lineup.salary).toBeLessThanOrEqual(FANDUEL.salaryCap);
    expect(lineup.players.map((p) => p.slot)).toEqual([...FANDUEL.slots]);
    expect(new Set(lineup.players.map((p) => p.id)).size).toBe(9);
    expect(lineup.projection).toBeCloseTo(bruteForce(pool), 5);
  });

  it('honors locks, exclusions and injuries, and finds distinct alternatives', () => {
    const pool = makePool(7, { QB: 6, RB: 12, WR: 16, TE: 6, DEF: 5 });
    const best = optimizeLineup(pool)!;
    const lockMe = pool.filter((p) => p.pos === 'RB' && !best.players.some((b) => b.id === p.id))[0];
    const banMe = best.players.find((p) => p.pos === 'QB')!;
    const constrained = optimizeLineup(pool, { locked: new Set([lockMe.id]), excluded: new Set([banMe.id]) })!;
    expect(constrained.players.some((p) => p.id === lockMe.id)).toBe(true);
    expect(constrained.players.some((p) => p.id === banMe.id)).toBe(false);
    expect(constrained.projection).toBeLessThanOrEqual(best.projection);

    const hurt = { ...best.players[1], injury: 'O' };
    const withInjury = pool.map((p) => (p.id === hurt.id ? hurt : p));
    expect(optimizeLineup(withInjury)!.players.some((p) => p.id === hurt.id)).toBe(false);

    const five = optimizeLineups(pool, 5);
    expect(five).toHaveLength(5);
    expect(new Set(five.map((l) => l.players.map((p) => p.id).sort().join())).size).toBe(5);
    expect(five[0].projection).toBe(best.projection);
    const csv = lineupsCsv(five);
    expect(csv.split('\n')[0]).toBe('QB,RB,RB,WR,WR,WR,TE,FLEX,DEF');
    expect(csv.trim().split('\n')).toHaveLength(6);
  });

  it('returns null when no legal lineup fits', () => {
    const pool = makePool(9, { QB: 1, RB: 1, WR: 3, TE: 1, DEF: 1 });
    expect(optimizeLineup(pool)).toBeNull();
  });
});

describe('DFS rankings', () => {
  const base = { opp: '', game: '', fppg: 0, injury: '', projectionSource: 'FantasyPros' as const };
  const wr = (id: string, salary: number, projection: number, injury = '') => ({
    ...base, id, name: `WR ${id}`, key: `wr ${id}`, pos: 'WR', team: 'X', salary, projection, injury,
  });
  it('ranks by projection and value per position, flags value plays, sinks injured players', () => {
    const rows = dfsRankings(
      [wr('a', 9000, 20), wr('b', 5000, 14), wr('c', 7000, 15), wr('d', 4500, 6), wr('e', 8000, 25, 'O')],
      [{ key: 'wr c', rank: 12, tier: 3 }],
    );
    expect(rows.map((r) => [r.id, r.posRank])).toEqual([['a', 1], ['c', 2], ['b', 3], ['d', 4], ['e', 5]]);
    const b = rows.find((r) => r.id === 'b')!;
    expect(b).toMatchObject({ valueRank: 1, valuePer1k: 2.8, valuePlay: true });
    expect(rows.find((r) => r.id === 'd')!.valuePlay).toBe(false); // cheap but below median projection
    expect(rows.find((r) => r.id === 'e')!.valuePlay).toBe(false);
    expect(rows.find((r) => r.id === 'c')).toMatchObject({ fpRank: 12, fpTier: 3 });
  });
});
