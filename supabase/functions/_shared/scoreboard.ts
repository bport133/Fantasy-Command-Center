// Weekly scoreboard: head-to-head results, all-play records (every team vs every other team)
// and the top-half win (top 50% of scores win, bottom 50% lose), combined per the league's
// record format.

import type {
  LeagueData,
  RecordFormat,
  ScoreboardLeague,
  ScoreboardSeasonRow,
  ScoreboardTeamWeek,
  ScoreboardWeek,
  WeekScore,
  WLT,
} from './types.ts';

const wlt = (w = 0, l = 0, t = 0): WLT => ({ w, l, t });
const add = (a: WLT, b: WLT): WLT => ({ w: a.w + b.w, l: a.l + b.l, t: a.t + b.t });
const one = (r: 'W' | 'L' | 'T' | undefined): WLT => (r === 'W' ? wlt(1) : r === 'L' ? wlt(0, 1) : r === 'T' ? wlt(0, 0, 1) : wlt());
const pct = (r: WLT) => {
  const g = r.w + r.l + r.t;
  return g ? (r.w + r.t / 2) / g : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Top half of the week's scores win, bottom half lose; a tie straddling the cutoff is a tie. */
export function topHalfResult(score: number, all: number[]): 'W' | 'L' | 'T' {
  const sorted = [...all].sort((a, b) => b - a);
  const half = Math.floor(sorted.length / 2);
  if (half === 0) return 'T';
  const lastWinner = sorted[half - 1];
  const firstLoser = sorted[half];
  if (score > firstLoser) return 'W';
  if (score < lastWinner) return 'L';
  return lastWinner === firstLoser ? 'T' : score >= lastWinner ? 'W' : 'L';
}

export function allPlayRecord(score: number, others: number[]): WLT {
  return others.reduce((r, o) => add(r, o < score ? wlt(1) : o > score ? wlt(0, 1) : wlt(0, 0, 1)), wlt());
}

export function recordFor(format: RecordFormat, parts: { h2h?: 'W' | 'L' | 'T'; allPlay: WLT; topHalf: 'W' | 'L' | 'T' }): WLT {
  switch (format) {
    case 'h2h':
      return one(parts.h2h);
    case 'h2h+median':
      return add(one(parts.h2h), one(parts.topHalf));
    case 'allplay':
      return parts.allPlay;
    case 'allplay+median':
      return add(parts.allPlay, one(parts.topHalf));
  }
}

export function scoreWeek(
  week: WeekScore,
  format: RecordFormat,
  teamName: (id: string) => string,
  myTeamId: string | null,
): ScoreboardWeek {
  const scores = week.teams.map((t) => t.score);
  const byId = new Map(week.teams.map((t) => [t.teamId, t]));
  const ranked = [...week.teams].sort((a, b) => b.score - a.score);
  const teams: ScoreboardTeamWeek[] = ranked.map((t) => {
    const opp = t.opponentId ? byId.get(t.opponentId) : undefined;
    const h2h = opp ? (t.score > opp.score ? 'W' : t.score < opp.score ? 'L' : 'T') : undefined;
    const allPlay = allPlayRecord(
      t.score,
      week.teams.filter((o) => o.teamId !== t.teamId).map((o) => o.score),
    );
    const topHalf = topHalfResult(t.score, scores);
    return {
      teamId: t.teamId,
      team: teamName(t.teamId),
      score: round2(t.score),
      rank: ranked.findIndex((r) => r.score === t.score) + 1,
      mine: t.teamId === myTeamId,
      h2h,
      opponent: opp ? teamName(opp.teamId) : undefined,
      allPlay,
      topHalf,
      record: recordFor(format, { h2h, allPlay, topHalf }),
    };
  });

  const seen = new Set<string>();
  const matchups: ScoreboardWeek['matchups'] = [];
  for (const t of week.teams) {
    if (seen.has(t.teamId) || !t.opponentId) continue;
    const o = byId.get(t.opponentId);
    seen.add(t.teamId);
    if (o) seen.add(o.teamId);
    const side = (x: typeof t) => ({ team: teamName(x.teamId), score: round2(x.score), mine: x.teamId === myTeamId });
    matchups.push({ a: side(t), b: o ? side(o) : undefined });
  }
  // Put my matchup first.
  matchups.sort((x, y) => Number(!!(y.a.mine || y.b?.mine)) - Number(!!(x.a.mine || x.b?.mine)));
  return { week: week.week, final: week.final, matchups, teams };
}

export function buildScoreboard(
  league: LeagueData,
  format: RecordFormat,
  currentWeek: number | null,
  myTeamId: string | null,
): ScoreboardLeague {
  const names = new Map(league.teams.map((t) => [t.id, t.name]));
  const teamName = (id: string) => names.get(id) ?? `Team ${id}`;
  const weeks = (league.scores ?? [])
    .filter((w) => w.teams.length > 1 && (currentWeek === null || w.week <= currentWeek))
    .filter((w) => w.final || w.teams.some((t) => t.score > 0) || w.week === currentWeek)
    .sort((a, b) => a.week - b.week)
    // A week isn't final until the NFL has moved past it, whatever the source says.
    .map((w) => ({ ...w, final: w.final && (currentWeek === null || w.week < currentWeek) }))
    .map((w) => scoreWeek(w, format, teamName, myTeamId));

  const totals = new Map<string, Omit<ScoreboardSeasonRow, 'rank'>>();
  for (const w of weeks.filter((x) => x.final)) {
    for (const t of w.teams) {
      const cur = totals.get(t.teamId) ?? {
        teamId: t.teamId,
        team: t.team,
        mine: t.mine,
        record: wlt(),
        h2h: wlt(),
        allPlay: wlt(),
        topHalf: wlt(),
        pf: 0,
      };
      cur.record = add(cur.record, t.record);
      cur.h2h = add(cur.h2h, one(t.h2h));
      cur.allPlay = add(cur.allPlay, t.allPlay);
      cur.topHalf = add(cur.topHalf, one(t.topHalf));
      cur.pf = round2(cur.pf + t.score);
      totals.set(t.teamId, cur);
    }
  }
  const season = [...totals.values()]
    .sort((a, b) => pct(b.record) - pct(a.record) || b.record.w - a.record.w || b.pf - a.pf)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  return {
    configId: league.configId,
    league: league.name,
    platform: league.platform,
    format,
    currentWeek,
    weeks,
    season,
  };
}
