import { describe, expect, it } from 'vitest';
import { allPlayRecord, buildScoreboard, recordFor, topHalfResult } from '../supabase/functions/_shared/scoreboard.ts';
import { parseEspnSchedule } from '../supabase/functions/_shared/providers/espn.ts';
import { parseMflScores } from '../supabase/functions/_shared/providers/mflExtras.ts';
import { fetchSleeperScores, parseSleeperMatchups } from '../supabase/functions/_shared/providers/sleeper.ts';
import type { LeagueData, WeekScore } from '../supabase/functions/_shared/types.ts';

describe('weekly record math', () => {
  it('top half wins, bottom half loses, ties at the cutoff tie', () => {
    const scores = [120, 110, 100, 90, 80, 70];
    expect(scores.map((s) => topHalfResult(s, scores))).toEqual(['W', 'W', 'W', 'L', 'L', 'L']);
    const tied = [120, 100, 100, 70];
    expect(tied.map((s) => topHalfResult(s, tied))).toEqual(['W', 'T', 'T', 'L']);
    // Odd league: 5 teams, top 2 win.
    const odd = [5, 4, 3, 2, 1];
    expect(odd.map((s) => topHalfResult(s, odd))).toEqual(['W', 'W', 'L', 'L', 'L']);
  });

  it('all-play counts every other team', () => {
    expect(allPlayRecord(100, [120, 90, 100, 80])).toEqual({ w: 2, l: 1, t: 1 });
  });

  it('combines results per record format', () => {
    const parts = { h2h: 'L' as const, allPlay: { w: 8, l: 3, t: 0 }, topHalf: 'W' as const };
    expect(recordFor('h2h', parts)).toEqual({ w: 0, l: 1, t: 0 });
    expect(recordFor('h2h+median', parts)).toEqual({ w: 1, l: 1, t: 0 });
    expect(recordFor('allplay', parts)).toEqual({ w: 8, l: 3, t: 0 });
    expect(recordFor('allplay+median', parts)).toEqual({ w: 9, l: 3, t: 0 });
  });
});

describe('scoreboard', () => {
  const team = (id: string) => ({ id, name: `Team ${id}`, players: [] });
  const league = (scores: WeekScore[]): LeagueData => ({
    configId: 'm',
    platform: 'mfl',
    name: 'PEACE',
    season: 2026,
    picks: null,
    teams: ['1', '2', '3', '4'].map(team),
    scores,
  });
  const wk = (week: number, final: boolean, pts: number[]): WeekScore => ({
    week,
    final,
    teams: pts.map((score, i) => ({ teamId: String(i + 1), score })),
  });

  it('scores an all-play + top-half league with no head-to-head matchups', () => {
    const board = buildScoreboard(league([wk(1, true, [100, 90, 80, 70]), wk(2, true, [60, 95, 85, 75]), wk(3, true, [50, 50, 50, 50])]), 'allplay+median', 3, '1');
    const w1 = board.weeks[0];
    expect(w1.matchups).toEqual([]);
    expect(w1.teams[0]).toMatchObject({ team: 'Team 1', rank: 1, allPlay: { w: 3, l: 0, t: 0 }, topHalf: 'W', record: { w: 4, l: 0, t: 0 }, mine: true });
    expect(w1.teams[3]).toMatchObject({ team: 'Team 4', allPlay: { w: 0, l: 3, t: 0 }, topHalf: 'L', record: { w: 0, l: 4, t: 0 } });
    // Week 3 is the current week: shown live, not counted in the season yet.
    expect(board.weeks[2].final).toBe(false);
    const me = board.season.find((r) => r.mine)!;
    // Week 1: 3-0 + W; week 2: 0-3 + L  => 4-4
    expect(me).toMatchObject({ record: { w: 4, l: 4, t: 0 }, allPlay: { w: 3, l: 3, t: 0 }, topHalf: { w: 1, l: 1, t: 0 }, pf: 160 });
    expect(board.season[0]).toMatchObject({ team: 'Team 2', record: { w: 7, l: 1, t: 0 } }); // 2-1+W, then 3-0+W
  });

  it('pairs head-to-head matchups and puts mine first', () => {
    const week: WeekScore = {
      week: 1,
      final: true,
      teams: [
        { teamId: '1', score: 100, opponentId: '2' },
        { teamId: '2', score: 110, opponentId: '1' },
        { teamId: '3', score: 90, opponentId: '4' },
        { teamId: '4', score: 80, opponentId: '3' },
      ],
    };
    const board = buildScoreboard(league([week]), 'h2h+median', 2, '3');
    expect(board.weeks[0].matchups.map((m) => [m.a.team, m.b?.team])).toEqual([
      ['Team 3', 'Team 4'],
      ['Team 1', 'Team 2'],
    ]);
    const t3 = board.weeks[0].teams.find((t) => t.teamId === '3')!;
    expect(t3).toMatchObject({ h2h: 'W', opponent: 'Team 4', topHalf: 'L', record: { w: 1, l: 1, t: 0 } });
  });
});

describe('score sources', () => {
  it('Sleeper: pairs rosters by matchup id and only fetches missing weeks', async () => {
    const week = parseSleeperMatchups(
      [
        { roster_id: 1, matchup_id: 5, points: 101.2 },
        { roster_id: 2, matchup_id: 5, points: 99 },
        { roster_id: 3, matchup_id: null, points: 50 },
      ],
      2,
      true,
    );
    expect(week.teams).toEqual([
      { teamId: '1', score: 101.2, opponentId: '2' },
      { teamId: '2', score: 99, opponentId: '1' },
      { teamId: '3', score: 50 },
    ]);
    const fetched: string[] = [];
    const known: WeekScore[] = [
      { week: 1, final: true, teams: [{ teamId: '1', score: 1 }] },
      { week: 2, final: true, teams: [{ teamId: '1', score: 2 }] },
      { week: 3, final: false, teams: [{ teamId: '1', score: 3 }] },
    ];
    const out = await fetchSleeperScores('L', 4, known, (async (url: string) => {
      fetched.push(url.split('/').pop()!);
      return [{ roster_id: 1, matchup_id: 1, points: 9 }];
    }) as any);
    expect(fetched).toEqual(['3', '4']); // week 3 was not final when cached
    expect(out.map((w) => [w.week, w.final])).toEqual([[1, true], [2, true], [3, true], [4, false]]);
  });

  it('ESPN: reads home/away totals, live totals and whether the week is decided', () => {
    const weeks = parseEspnSchedule([
      { matchupPeriodId: 1, winner: 'HOME', home: { teamId: 1, totalPoints: 120 }, away: { teamId: 2, totalPoints: 100 } },
      { matchupPeriodId: 2, winner: 'UNDECIDED', home: { teamId: 2, totalPoints: 0, totalPointsLive: 44.5 }, away: { teamId: 1, totalPoints: 0, totalPointsLive: 30 } },
      { matchupPeriodId: 2, winner: 'UNDECIDED', home: { teamId: 3, totalPoints: 0 } },
    ]);
    expect(weeks[0]).toEqual({ week: 1, final: true, teams: [{ teamId: '1', score: 120, opponentId: '2' }, { teamId: '2', score: 100, opponentId: '1' }] });
    expect(weeks[1].final).toBe(false);
    expect(weeks[1].teams).toContainEqual({ teamId: '2', score: 44.5, opponentId: '1' });
    expect(weeks[1].teams).toContainEqual({ teamId: '3', score: 0 });
  });

  it('MFL: reads weekly results (with or without matchups) and live scoring', () => {
    const weeks = parseMflScores(
      {
        allWeeklyResults: {
          weeklyResults: [
            { week: '1', matchup: { franchise: [{ id: '0001', score: '110.5' }, { id: '0002', score: '98' }] }, franchise: { id: '0003', score: '87' } },
            { week: '2', franchise: [{ id: '0001', score: '90' }, { id: '0002', score: '101' }, { id: '0003', score: '95' }] },
          ],
        },
      },
      { liveScoring: { week: '3', franchise: [{ id: '0001', score: '12.5' }, { id: '0002', score: '20' }, { id: '0003', score: '0' }] } },
    );
    expect(weeks.map((w) => [w.week, w.final, w.teams.length])).toEqual([[1, true, 3], [2, true, 3], [3, false, 3]]);
    expect(weeks[0].teams).toEqual([
      { teamId: '0001', score: 110.5, opponentId: '0002' },
      { teamId: '0002', score: 98, opponentId: '0001' },
      { teamId: '0003', score: 87 },
    ]);
  });
});
