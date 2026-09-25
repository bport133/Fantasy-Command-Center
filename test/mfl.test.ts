import { describe, expect, it } from 'vitest';
import { currentWeek, makeContext, mflCap, mflLeagueView, rosterGroups } from '../supabase/functions/_shared/analysis.ts';
import { normalizeName } from '../supabase/functions/_shared/names.ts';
import { describeAsset, fetchMflExtras, parseMflExtras } from '../supabase/functions/_shared/providers/mflExtras.ts';
import { DEFAULT_SETTINGS } from '../supabase/functions/_shared/settings.ts';
import type { LeagueData, Settings } from '../supabase/functions/_shared/types.ts';

const players = {
  '100': { name: 'Nico Collins', pos: 'WR', nfl: 'HOU' },
  '200': { name: 'Joe Burrow', pos: 'QB', nfl: 'CIN' },
  '300': { name: 'Travis Hunter', pos: 'WR', nfl: 'JAC' },
  '400': { name: 'Jaylen Warren', pos: 'RB', nfl: 'PIT' },
};

const league = {
  league: {
    rosterSize: '30',
    injuredReserve: '3',
    taxiSquad: '4',
    startWeek: '1',
    endWeek: '17',
    lastRegularSeasonWeek: '14',
    starters: { count: '9', position: [{ name: 'QB', limit: '1-2' }, { name: 'RB', limit: '2-4' }] },
    divisions: { division: { id: '00', name: 'East' } },
    franchises: { franchise: [{ id: '0001', name: 'Inch by Inch', division: '00' }, { id: '0002', name: 'Rival', division: '00' }] },
  },
};

const raw = {
  league,
  rules: { rules: { positionRules: { positions: 'QB', rule: [{ event: { $t: 'PY' }, points: { $t: '*.04' }, range: { $t: '-50-999' } }] } } },
  allRules: { allRules: { rule: [{ abbreviation: { $t: 'PY' }, shortDescription: { $t: 'Passing Yards' } }] } },
  standings: { leagueStandings: { franchise: [{ id: '0001', h2hw: '2', h2hl: '1', pf: '301.5', pa: '280.1' }, { id: '0002', h2hw: '1', h2hl: '2', pf: '290', pa: '310' }] } },
  schedule: {
    schedule: {
      weeklySchedule: [
        { week: '1', matchup: { franchise: [{ id: '0001', score: '110.5', result: 'W', isHome: '1' }, { id: '0002', score: '99', result: 'L', isHome: '0' }] } },
        { week: '2', matchup: { franchise: [{ id: '0001', isHome: '0' }, { id: '0002', isHome: '1' }] } },
      ],
    },
  },
  transactions: {
    transactions: {
      transaction: [
        { type: 'FREE_AGENT', franchise: '0002', transaction: '300,|400,', timestamp: '1758700000' },
        { type: 'TRADE', franchise: '0001', franchise2: '0002', franchise1_gave_up: '200,FP_0001_2027_2,', franchise2_gave_up: '100,', timestamp: '1758800000' },
        { type: 'BBID_WAIVER', franchise: '0001', transaction: '400,12.50|', timestamp: '1758600000' },
        { type: 'AUCTION_WON', franchise: '0002', transaction: '300|4500|', timestamp: '1758500000' },
      ],
    },
  },
  tradeBait: { tradeBaits: { tradeBait: { franchise_id: '0002', willGiveUp: '100,DP_02_05,BB_10', inExchangeFor: 'RB help' } } },
  adjustments: { salaryAdjustments: { salaryAdjustment: [{ franchise_id: '0001', amount: '2500', description: 'Cut: Geno Smith' }] } },
  calendar: { calendar: { event: [{ title: 'Trade deadline', start_time: '1762000000', end_time: '1762003600' }] } },
  injuries: { injuries: { injury: [{ id: '100', status: 'Questionable', details: 'Hamstring' }] } },
  ytd: { playerScores: { playerScore: [{ id: '100', score: '54.3' }, { id: '200', score: '61.0' }] } },
  projected: { projectedScores: { week: '2', playerScore: [{ id: '100', score: '14.2' }, { id: '200', score: '19.8' }] } },
  adds: { topAdds: { player: [{ id: '300', percent: '41' }, { id: '999', percent: '10' }] } },
  drops: { topDrops: { player: { id: '100', percent: '3' } } },
};

describe('MFL extras parsing', () => {
  const x = parseMflExtras(raw, players);

  it('reads settings, scoring and standings', () => {
    expect(x.settings).toMatchObject({ rosterSize: 30, irSize: 3, taxiSize: 4, lastRegularWeek: 14, startersCount: 9 });
    expect(x.settings.starters).toEqual([{ pos: 'QB', limit: '1-2' }, { pos: 'RB', limit: '2-4' }]);
    expect(x.settings.divisions).toEqual([{ id: '00', name: 'East', teamIds: ['0001', '0002'] }]);
    expect(x.scoring).toEqual([{ positions: 'QB', rule: 'Passing Yards', points: '*.04', range: '-50-999' }]);
    expect(x.standings[0]).toEqual({ teamId: '0001', w: 2, l: 1, t: 0, pf: 301.5, pa: 280.1 });
  });

  it('decodes every transaction type, newest first', () => {
    expect(x.transactions!.map((t) => t.type)).toEqual(['TRADE', 'FREE_AGENT', 'BBID_WAIVER', 'AUCTION_WON']);
    const [trade, fa, bbid, auction] = x.transactions!;
    expect(trade).toMatchObject({ teamId: '0001', otherTeamId: '0002', gave: ['Joe Burrow (QB)', '2027 Rd 2 pick (Inch by Inch)'], got: ['Nico Collins (WR)'] });
    expect(fa).toMatchObject({ added: ['Travis Hunter (WR)'], dropped: ['Jaylen Warren (RB)'] });
    expect(bbid).toMatchObject({ added: ['Jaylen Warren (RB)'], amount: 12.5, dropped: [] });
    expect(auction).toMatchObject({ added: ['Travis Hunter (WR)'], amount: 4500 });
  });

  it('names draft picks and blind-bid dollars', () => {
    expect(describeAsset('DP_02_05', players)).toBe('Rd 3.06 pick');
    expect(describeAsset('BB_10', players)).toBe('$10 blind bid');
    expect(describeAsset('FP_0002_2028_1', players, league)).toBe('2028 Rd 1 pick (Rival)');
    expect(describeAsset('55555', players)).toBe('Player #55555');
    expect(x.tradeBait).toEqual([{ teamId: '0002', offering: ['Nico Collins (WR)', 'Rd 3.06 pick', '$10 blind bid'], wants: 'RB help', when: undefined }]);
  });

  it('reads injuries, points, projections and trends', () => {
    expect(x.injuries['100']).toEqual({ status: 'Questionable', details: 'Hamstring' });
    expect(x.ytdPoints).toEqual({ '100': 54.3, '200': 61 });
    expect(x.projectionWeek).toBe(2);
    expect(x.trending.adds.map((t) => t.name)).toEqual(['Travis Hunter']); // unknown id 999 skipped
    expect(x.trending.drops).toEqual([{ id: '100', name: 'Nico Collins', pos: 'WR', nfl: 'HOU', percent: 3 }]);
    expect(x.calendar![0].title).toBe('Trade deadline');
  });

  it('works out the current week from results', () => {
    expect(currentWeek(x.schedule)).toBe(2);
    expect(currentWeek([])).toBeNull();
  });
});

describe('MFL extras fetching', () => {
  it('keeps going when MFL refuses a private section', async () => {
    const seen: string[] = [];
    const x = await fetchMflExtras({
      url: (type) => `https://x/${type}`,
      globalUrl: (type) => `https://x/global/${type}`,
      players,
      teams: [{ id: '0001', name: 'Inch by Inch', players: [{ id: '100', name: 'Nico Collins', key: 'nico collins', pos: 'WR', nfl: 'HOU', slot: 'Active' }] }],
      myTeamId: '0001',
      league,
      standings: raw.standings,
      fetchJson: (async (url: string) => {
        seen.push(url);
        if (url.endsWith('/pendingTrades')) return { error: { $t: 'API requires logged in user or API key' } };
        if (url.endsWith('/calendar')) throw new Error('MFL: HTTP 500');
        const type = url.split('/').pop()!.split('?')[0];
        return ({ transactions: raw.transactions, injuries: raw.injuries } as Record<string, unknown>)[type] ?? {};
      }) as any,
    });
    expect(x.pendingTrades).toBeNull();
    expect(x.calendar).toBeNull();
    expect(x.unavailable).toEqual(['Pending trades: needs the MFL API key (Settings)', 'Calendar: MFL: HTTP 500']);
    expect(x.transactions).toHaveLength(4);
    // league + standings were reused, not fetched again; projections asked only for my roster.
    expect(seen.some((u) => u.endsWith('/league') || u.endsWith('/leagueStandings'))).toBe(false);
    expect(seen.filter((u) => u.includes('projectedScores'))).toHaveLength(1);
  });
});

describe('MFL league view', () => {
  const p = (id: string, salary: number, yrs: number) => {
    const ref = players[id as keyof typeof players];
    return { id, name: ref.name, key: normalizeName(ref.name), pos: ref.pos, nfl: ref.nfl, slot: 'Active' as const, salary, contractYears: yrs };
  };
  const data: LeagueData = {
    configId: 'm',
    platform: 'mfl',
    name: 'PEACE',
    season: 2026,
    salaryCap: 200000,
    picks: [],
    teams: [
      { id: '0001', name: 'Inch by Inch', players: [p('100', 10000, 2), p('200', 30000, 1)] },
      { id: '0002', name: 'Rival', players: [p('400', 5000, 1)] },
    ],
    mfl: { ...parseMflExtras(raw, players), unavailable: [] },
  };
  const settings: Settings = { ...DEFAULT_SETTINGS, leagues: [{ id: 'm', platform: 'mfl', leagueId: '1', myTeam: 'Inch by Inch' }] };
  const ctx = makeContext(settings, [{ rank: 21, tier: 4, name: 'Nico Collins', key: 'nico collins', nfl: 'HOU', pos: 'WR' }, { rank: 152, tier: 10, name: 'Travis Hunter', key: 'travis hunter', nfl: 'JAC', pos: 'WR' }], new Map(), []);

  it('counts salary adjustments against this season only', () => {
    const cap = mflCap(ctx, data)!;
    expect(cap.years[0]).toMatchObject({ committed: 42500, adjustments: 2500, remaining: 157500, avgSalary: 20000 });
    expect(cap.years[1]).toMatchObject({ committed: 10000, adjustments: 0 });
  });

  it('builds matchup, feed and trends for the page', () => {
    const v = mflLeagueView(ctx, data)!;
    expect(v.currentWeek).toBe(2);
    expect(v.matchup).toMatchObject({ week: 2, opponent: 'Rival' });
    expect(v.mySchedule[0]).toMatchObject({ week: 1, result: 'W', myScore: 110.5, oppScore: 99 });
    expect(v.standings[0]).toMatchObject({ rank: 1, team: 'Inch by Inch', record: '2-1', mine: true });
    expect(v.projections.map((r) => [r.name, r.projected, r.injury])).toEqual([
      ['Joe Burrow', 19.8, undefined],
      ['Nico Collins', 14.2, 'Questionable – Hamstring'],
    ]);
    const trade = v.transactions!.find((t) => t.type === 'Trade')!;
    expect(trade).toMatchObject({ team: 'Inch by Inch', mine: true });
    expect(trade.summary).toBe('Traded Joe Burrow (QB), 2027 Rd 2 pick (Inch by Inch) to Rival for Nico Collins (WR)');
    expect(v.transactions!.find((t) => t.type === 'Blind bid')!.summary).toBe('Won Jaylen Warren (RB) on waivers for $12.5');
    expect(v.trending.adds[0]).toMatchObject({ name: 'Travis Hunter', available: true, rank: 152 });
    expect(v.trending.drops[0]).toMatchObject({ name: 'Nico Collins', available: false, owner: 'Inch by Inch' });
    expect(v.salaryAdjustments).toEqual([{ team: 'Inch by Inch', amount: 2500, description: 'Cut: Geno Smith', when: undefined, mine: true }]);
  });

  it('adds injury and season points to the MFL roster', () => {
    const g = rosterGroups(ctx, [data])[0];
    expect(g.players.find((x) => x.name === 'Nico Collins')).toMatchObject({ injury: 'Questionable – Hamstring', ytdPoints: 54.3 });
  });
});
