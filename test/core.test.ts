import { describe, expect, it } from 'vitest';
import type { FPPlayer, LeagueData, Settings } from '../supabase/functions/_shared/types.ts';
import {
  detectDrops,
  draftPicks,
  finalSeason,
  freeAgents,
  makeContext,
  mflCap,
  mflExpiring,
  rosterState,
  teamValues,
  tradeFinder,
} from '../supabase/functions/_shared/analysis.ts';
import { dynastyValue, normalizeName } from '../supabase/functions/_shared/names.ts';
import { cleanSwid, parseEspnLeague } from '../supabase/functions/_shared/providers/espn.ts';
import { parseFantasyProsApi, parseFantasyProsCsv } from '../supabase/functions/_shared/providers/fantasypros.ts';
import { parseMflLeague } from '../supabase/functions/_shared/providers/mfl.ts';
import { parseSleeperLeague } from '../supabase/functions/_shared/providers/sleeper.ts';
import { DEFAULT_SETTINGS, mergeSettings, publicSettings } from '../supabase/functions/_shared/settings.ts';

const fp = (rank: number, name: string, pos: string, tier = 1): FPPlayer => ({
  rank,
  tier,
  name,
  key: normalizeName(name),
  nfl: 'FA',
  pos,
});

describe('names', () => {
  it('matches spellings across platforms', () => {
    expect(normalizeName('St. Brown, Amon-Ra')).toBe(normalizeName('Amon-Ra St. Brown'));
    expect(normalizeName('James Cook III')).toBe('james cook');
    expect(normalizeName("Ja'Marr Chase")).toBe('jamarr chase');
    expect(normalizeName('Jaxon Smith-Njigba')).toBe('jaxon smithnjigba');
    expect(normalizeName('J.K. Dobbins')).toBe('jk dobbins');
    expect(normalizeName('Josh Palmer')).toBe(normalizeName('Joshua Palmer'));
  });

  it('reproduces the spreadsheet dynasty values', () => {
    // Values copied from the "My Rosters" tab.
    expect(dynastyValue(21)).toBe(7659);
    expect(dynastyValue(34)).toBe(6440);
    expect(dynastyValue(65)).toBe(4260);
    expect(dynastyValue(202)).toBe(686);
    expect(dynastyValue(undefined)).toBe(0);
  });
});

describe('FantasyPros', () => {
  it('parses the rankings CSV export', () => {
    const csv = [
      '"RK",TIERS,"PLAYER NAME",TEAM,"POS","AGE","BEST","WORST","AVG."',
      '"1",1,"Ja\'Marr Chase",CIN,"WR1","26","1","2","1.4"',
      '"2",1,"Jahmyr Gibbs",DET,"RB1","24","1","5","2.2"',
      '"3",1,"Buffalo Bills",BUF,"DST1","","3","3","3"',
    ].join('\n');
    const players = parseFantasyProsCsv(csv);
    expect(players).toHaveLength(2);
    expect(players[0]).toMatchObject({ rank: 1, tier: 1, name: "Ja'Marr Chase", pos: 'WR', age: 26, avg: 1.4 });
  });

  it('parses the API response with string numbers', () => {
    const players = parseFantasyProsApi({
      players: [
        { player_name: 'Bijan Robinson', player_team_id: 'ATL', player_position_id: 'RB', rank_ecr: 4, rank_min: '3', rank_max: '5', rank_ave: '4.2', tier: 1 },
        { player_name: 'Kicker Guy', player_team_id: 'ATL', player_position_id: 'K', rank_ecr: 5 },
      ],
    });
    expect(players).toEqual([
      expect.objectContaining({ name: 'Bijan Robinson', rank: 4, best: 3, worst: 5, avg: 4.2, pos: 'RB' }),
    ]);
  });
});

describe('ESPN', () => {
  it('accepts the SWID in any of the usual forms', () => {
    const guid = '{12345678-ABCD-4EF0-9123-456789ABCDEF}';
    expect(cleanSwid('{"swid":"{12345678-abcd-4ef0-9123-456789abcdef}"}')).toBe(guid);
    expect(cleanSwid('12345678-ABCD-4EF0-9123-456789ABCDEF')).toBe(guid);
  });

  it('parses teams, rosters and lineup slots', () => {
    const data = {
      settings: { name: 'Test ESPN' },
      members: [{ id: 'm1', firstName: 'Tony', lastName: 'D' }],
      teams: [
        {
          id: 1,
          name: 'My Team',
          primaryOwner: 'm1',
          record: { overall: { wins: 4, losses: 0, ties: 0 } },
          roster: {
            entries: [
              { lineupSlotId: 0, playerPoolEntry: { player: { fullName: 'Patrick Mahomes', defaultPositionId: 1, proTeamId: 12 } } },
              { lineupSlotId: 20, playerPoolEntry: { player: { fullName: 'Tank Dell', defaultPositionId: 3, proTeamId: 34 } } },
              { lineupSlotId: 21, playerPoolEntry: { player: { fullName: 'Hurt Guy', defaultPositionId: 2, proTeamId: 0 } } },
            ],
          },
        },
      ],
    };
    const league = parseEspnLeague({ id: 'e', platform: 'espn', leagueId: '1', myTeam: '1' }, 2026, data);
    expect(league.name).toBe('Test ESPN');
    expect(league.picks).toBeNull();
    expect(league.teams[0]).toMatchObject({ id: '1', owner: 'Tony D', record: '4-0' });
    expect(league.teams[0].players.map((p) => [p.pos, p.nfl, p.slot])).toEqual([
      ['QB', 'KC', 'Starter'],
      ['WR', 'HOU', 'Bench'],
      ['RB', 'FA', 'IR'],
    ]);
  });
});

describe('Sleeper', () => {
  const players = {
    '1': { name: 'Nico Collins', pos: 'WR', nfl: 'HOU' },
    '2': { name: 'Joe Burrow', pos: 'QB', nfl: 'CIN' },
    '3': { name: 'RJ Harvey', pos: 'RB', nfl: 'DEN' },
  };

  it('parses rosters and fills in untraded picks', () => {
    const league = parseSleeperLeague(
      { id: 's', platform: 'sleeper', leagueId: 'x', myTeam: 'bport133' },
      2026,
      { name: 'Section V', status: 'in_season', settings: { draft_rounds: 2 } },
      [
        { user_id: 'u1', display_name: 'bport133' },
        { user_id: 'u2', display_name: 'geneva', metadata: { team_name: 'Geneva Panthers' } },
      ],
      [
        { roster_id: 1, owner_id: 'u1', players: ['1', '2', '3'], starters: ['1', '2'], taxi: ['3'], settings: { wins: 1, losses: 1 } },
        { roster_id: 2, owner_id: 'u2', players: [], settings: { wins: 2, losses: 0 } },
      ],
      [{ season: '2027', round: 1, roster_id: 1, owner_id: 2 }],
      players,
    );
    expect(league.teams[0]).toMatchObject({ name: 'bport133', record: '1-1' });
    expect(league.teams[1].name).toBe('Geneva Panthers');
    expect(league.teams[0].players.map((p) => p.slot)).toEqual(['Starter', 'Starter', 'Taxi']);

    const settings: Settings = { ...DEFAULT_SETTINGS, leagues: [{ id: 's', platform: 'sleeper', leagueId: 'x', myTeam: 'bport133' }] };
    const picks = draftPicks(makeContext(settings, [], new Map(), []), league);
    expect(picks.picks.filter((p) => p.season === 2027)).toEqual([
      { season: 2027, round: 2, source: 'Own' },
      { season: 2027, round: 1, source: 'Owned by Geneva Panthers' },
    ]);
    expect(picks.picks.filter((p) => p.source === 'Own')).toHaveLength(5); // 3 seasons x 2 rounds - 1 traded
  });
});

describe('MFL', () => {
  const cfg = { id: 'm', platform: 'mfl' as const, leagueId: '12345', myTeam: 'Inch by Inch', host: 'www42.myfantasyleague.com' };
  const players = {
    a: { name: 'Ashton Jeanty', pos: 'RB', nfl: 'LV' },
    b: { name: 'Jake Ferguson', pos: 'TE', nfl: 'DAL' },
    c: { name: 'Justin Fields', pos: 'QB', nfl: 'KC' },
    d: { name: 'Lamar Jackson', pos: 'QB', nfl: 'BAL' },
  };
  const league = parseMflLeague(
    cfg,
    2026,
    { league: { name: 'PEACE', salaryCapAmount: '200000', franchises: { franchise: [{ id: '0001', name: 'Inch by Inch' }, { id: '0002', name: 'Rival' }] } } },
    {
      rosters: {
        franchise: [
          {
            id: '0001',
            player: [
              { id: 'a', status: 'ROSTER', salary: '15000', contractYear: '4.5' },
              { id: 'b', status: 'ROSTER', salary: '300', contractYear: '1.5' },
              { id: 'c', status: 'TAXI_SQUAD', salary: '1000', contractYear: '1' },
            ],
          },
          // MFL sends a lone player as an object, not an array.
          { id: '0002', player: { id: 'd', status: 'ROSTER', salary: '42405', contractYear: '1' } },
        ],
      },
    },
    { leagueStandings: { franchise: [{ id: '0001', h2hw: '3', h2hl: '1', h2ht: '0' }] } },
    {
      futureDraftPicks: {
        franchise: [
          { id: '0001', futureDraftPick: [{ year: '2027', round: '2', originalPickFor: '0001' }, { year: '2027', round: '2', originalPickFor: '0002' }] },
          { id: '0002', futureDraftPick: { year: '2027', round: '1', originalPickFor: '0001' } },
        ],
      },
    },
    players,
  );
  const settings: Settings = { ...DEFAULT_SETTINGS, leagues: [cfg] };
  const ctx = makeContext(settings, [fp(8, 'Ashton Jeanty', 'RB'), fp(31, 'Lamar Jackson', 'QB'), fp(108, 'Jake Ferguson', 'TE')], new Map(), []);

  it('parses franchises, contracts, standings and picks', () => {
    expect(league.salaryCap).toBe(200000);
    expect(league.teams[0].record).toBe('3-1');
    expect(league.teams[1].players).toHaveLength(1);
    expect(league.teams[0].players[2]).toMatchObject({ slot: 'Taxi', salary: 1000, contractYears: 1 });
    expect(draftPicks(ctx, league).picks).toEqual([
      { season: 2027, round: 2, source: 'Own' },
      { season: 2027, round: 2, source: 'via Rival' },
      { season: 2027, round: 1, source: 'Owned by Rival' },
    ]);
  });

  it('projects cap and contract years like the spreadsheet', () => {
    expect(finalSeason(2026, 4.5)).toBe(2030);
    expect(finalSeason(2026, 1.5)).toBe(2027);
    expect(finalSeason(2026, 1)).toBe(2026);
    const cap = mflCap(ctx, league)!;
    expect(cap.years.map((y) => y.committed)).toEqual([16300, 15300, 15000, 15000, 15000]);
    expect(cap.years.map((y) => y.yearsCommitted)).toEqual([7, 4, 2.5, 1.5, 0.5]);
    expect(cap.years[0].remaining).toBe(183700);
    const jeanty = cap.contracts.find((c) => c.name === 'Ashton Jeanty')!;
    expect(jeanty.bySeason).toEqual([15000, 15000, 15000, 15000, 15000]);
    expect(cap.positions.find((p) => p.pos === 'RB')).toMatchObject({ total: 15000, capRank: 1 });
  });

  it('lists expiring contracts and next-season cap room', () => {
    const view = mflExpiring(ctx, league);
    expect(view.expiring.map((e) => [e.endsAfter, e.name, e.mine])).toEqual([
      [2026, 'Lamar Jackson', false],
      [2026, 'Justin Fields', true],
      [2027, 'Jake Ferguson', true],
    ]);
    const rival = view.capRoom.find((r) => r.team === 'Rival')!;
    expect(rival).toMatchObject({ committed: 0, room: 200000, expiringValue: dynastyValue(31) });
  });
});

describe('league analysis', () => {
  const mk = (id: string, name: string, players: [string, string][]) => ({
    id,
    name,
    players: players.map(([n, pos]) => ({ name: n, key: normalizeName(n), pos, nfl: 'X', slot: 'Bench' as const })),
  });
  const league: LeagueData = {
    configId: 'L',
    platform: 'sleeper',
    name: 'Test',
    season: 2026,
    picks: [],
    teams: [
      mk('1', 'Me', [['QB One', 'QB'], ['QB Two', 'QB'], ['RB Nine', 'RB'], ['WR One', 'WR'], ['TE One', 'TE']]),
      mk('2', 'RB Rich', [['RB One', 'RB'], ['RB Two', 'RB'], ['QB Nine', 'QB'], ['WR Two', 'WR'], ['TE Two', 'TE']]),
      mk('3', 'Middling', [['WR Three', 'WR'], ['RB Three', 'RB'], ['QB Three', 'QB'], ['TE Three', 'TE']]),
    ],
  };
  const rankings = [
    fp(1, 'QB One', 'QB'), fp(2, 'RB One', 'RB'), fp(3, 'QB Two', 'QB'), fp(4, 'RB Two', 'RB'),
    fp(5, 'WR One', 'WR'), fp(6, 'WR Two', 'WR'), fp(7, 'WR Three', 'WR'), fp(8, 'TE One', 'TE'),
    fp(9, 'TE Two', 'TE'), fp(10, 'TE Three', 'TE'), fp(11, 'RB Three', 'RB'), fp(12, 'QB Three', 'QB'),
    fp(20, 'Free Guy', 'WR'), fp(40, 'RB Nine', 'RB'), fp(41, 'QB Nine', 'QB'),
  ];
  const settings: Settings = { ...DEFAULT_SETTINGS, leagues: [{ id: 'L', platform: 'sleeper', leagueId: 'x', myTeam: 'Me' }] };
  const ctx = makeContext(settings, rankings, new Map(), ['Free Guy']);

  it('ranks teams by total dynasty value', () => {
    const rows = teamValues(ctx, league);
    expect(rows[0].rank).toBe(1);
    expect(rows.find((r) => r.mine)?.team).toBe('Me');
    expect(rows.every((r, i) => i === 0 || rows[i - 1].total >= r.total)).toBe(true);
  });

  it('finds complementary trade partners', () => {
    const tf = tradeFinder(ctx, league);
    expect(tf.myStrength).toBe('QB');
    expect(tf.myNeed).toBe('RB');
    expect(tf.rows[0]).toMatchObject({ team: 'RB Rich', fit: 'Strong', theirSurplus: 'RB', theirNeed: 'QB' });
    expect(tf.rows[0].targets[0].name).toBe('RB One');
    expect(tf.rows[0].offers[0].name).toBe('QB One');
  });

  it('lists the best unrostered players and flags watchlist', () => {
    const fa = freeAgents(ctx, [league], rankings);
    expect(fa.map((f) => f.name)).toEqual(['Free Guy']);
    expect(fa[0].watched).toBe(true);
  });

  it('alerts on drops of ranked or watched players only', () => {
    const prev = rosterState([league]);
    const after: LeagueData = {
      ...league,
      teams: league.teams.map((t) =>
        t.id === '2' ? { ...t, players: t.players.filter((p) => p.name !== 'RB One' && p.name !== 'QB Nine') } : t,
      ),
    };
    const strict = makeContext({ ...settings, alertTopN: 10 }, rankings, new Map(), []);
    const alerts = detectDrops(strict, prev, [after], new Date('2026-09-24T12:00:00Z'));
    expect(alerts.map((a) => [a.player, a.droppedBy])).toEqual([['RB One', 'RB Rich']]);
    // A league missing from the previous snapshot never produces alerts.
    expect(detectDrops(strict, {}, [after], new Date())).toEqual([]);
  });
});

describe('settings', () => {
  it('never returns secrets and keeps them unless replaced or cleared', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { espnS2: 'secret', fpApiKey: 'key', season: '2026' as any });
    expect(s.season).toBe(2026);
    const pub = publicSettings(s) as any;
    expect(pub.espnS2).toBeUndefined();
    expect(pub.secretsSet).toMatchObject({ espnS2: true, fpApiKey: true, mflApiKey: false });
    expect(mergeSettings(s, { espnS2: '' }).espnS2).toBe('secret');
    expect(mergeSettings(s, { clearSecrets: ['espnS2'] }).espnS2).toBe('');
  });
});
