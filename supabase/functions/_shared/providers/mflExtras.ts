// Everything beyond rosters that the MFL export API offers and the app shows on the MFL League
// page: settings, scoring, schedule, transactions, trade bait, pending trades, salary adjustments,
// calendar, injuries, points and projections, and MFL-wide trending adds/drops.
// Each request is optional: a refusal (private data without the API key) or failure only blanks
// its own section.

import type { MflExtras, MflMatchup, MflSettings, MflTransaction, MflTrend, Team } from '../types.ts';
import { asArray, getJson } from '../http.ts';

export interface MflPlayerRef {
  name: string;
  pos: string;
  nfl: string;
}

const TRANSACTION_TYPES = 'TRADE,FREE_AGENT,WAIVER,BBID_WAIVER,AUCTION_WON';
const TRANSACTION_DAYS = '30';
const TREND_COUNT = '25';

/** MFL wraps many text values as {"$t": "..."}. */
const text = (v: any): string => (v && typeof v === 'object' && '$t' in v ? String(v.$t) : v == null ? '' : String(v));
const num = (v: any): number | undefined => {
  const n = Number(text(v));
  return text(v) !== '' && Number.isFinite(n) ? n : undefined;
};
const when = (ts: any): string | undefined => {
  const n = num(ts);
  return n ? new Date(n * 1000).toISOString() : undefined;
};

export async function fetchMflExtras(opts: {
  url: (type: string, params?: Record<string, string>) => string;
  globalUrl: (type: string, params?: Record<string, string>) => string;
  players: Record<string, MflPlayerRef>;
  teams: Team[];
  myTeamId: string | null;
  /** Already fetched for the roster view; reused instead of asking MFL twice. */
  league: any;
  standings: any;
  fetchJson?: typeof getJson;
}): Promise<MflExtras> {
  const fetchJson = opts.fetchJson ?? getJson;
  const unavailable: string[] = [];
  const label = { label: 'MFL' };

  // Sequential on purpose: MFL throttles bursts of requests from one caller.
  const get = async (section: string, url: string): Promise<any | null> => {
    try {
      const data = await fetchJson(url, label);
      if (data?.error) {
        const msg = text(data.error);
        unavailable.push(`${section}: ${/owner|login|private|api ?key/i.test(msg) ? 'needs the MFL API key (Settings)' : msg}`);
        return null;
      }
      return data;
    } catch (err) {
      unavailable.push(`${section}: ${(err as Error).message}`);
      return null;
    }
  };

  const myRosterIds = opts.myTeamId
    ? (opts.teams.find((t) => t.id === opts.myTeamId)?.players.map((p) => p.id).filter(Boolean) as string[])
    : [];

  const { league, standings } = opts;
  const rules = await get('Scoring rules', opts.url('rules'));
  const allRules = rules ? await get('Scoring rule names', opts.globalUrl('allRules')) : null;
  const schedule = await get('Schedule', opts.url('schedule'));
  const transactions = await get('Transactions', opts.url('transactions', { TRANS_TYPE: TRANSACTION_TYPES, DAYS: TRANSACTION_DAYS }));
  const tradeBait = await get('Trade bait', opts.url('tradeBait', { INCLUDE_DRAFT_PICKS: '1' }));
  const pending = await get('Pending trades', opts.url('pendingTrades'));
  const adjustments = await get('Salary adjustments', opts.url('salaryAdjustments'));
  const calendar = await get('Calendar', opts.url('calendar'));
  const injuries = await get('Injuries', opts.globalUrl('injuries'));
  const ytd = await get('Season points', opts.url('playerScores', { W: 'YTD' }));
  const projected = myRosterIds.length
    ? await get('Projections', opts.url('projectedScores', { PLAYERS: myRosterIds.join(',') }))
    : null;
  const adds = await get('Trending adds', opts.globalUrl('topAdds', { COUNT: TREND_COUNT }));
  const drops = await get('Trending drops', opts.globalUrl('topDrops', { COUNT: TREND_COUNT }));

  return {
    ...parseMflExtras(
      { league, rules, allRules, standings, schedule, transactions, tradeBait, pending, adjustments, calendar, injuries, ytd, projected, adds, drops },
      opts.players,
    ),
    unavailable,
  };
}

export interface MflExtrasRaw {
  league?: any;
  rules?: any;
  allRules?: any;
  standings?: any;
  schedule?: any;
  transactions?: any;
  tradeBait?: any;
  pending?: any;
  adjustments?: any;
  calendar?: any;
  injuries?: any;
  ytd?: any;
  projected?: any;
  adds?: any;
  drops?: any;
}

export function parseMflExtras(raw: MflExtrasRaw, players: Record<string, MflPlayerRef>): Omit<MflExtras, 'unavailable'> {
  const asset = (a: string) => describeAsset(a, players, raw.league);
  const assets = (list: any) =>
    text(list)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(asset);

  return {
    settings: parseSettings(raw.league),
    scoring: parseScoring(raw.rules, raw.allRules),
    standings: asArray<any>(raw.standings?.leagueStandings?.franchise).map((f) => ({
      teamId: String(f.id),
      w: num(f.h2hw) ?? 0,
      l: num(f.h2hl) ?? 0,
      t: num(f.h2ht) ?? 0,
      pf: num(f.pf) ?? 0,
      pa: num(f.pa) ?? 0,
    })),
    schedule: parseSchedule(raw.schedule),
    transactions: raw.transactions ? parseTransactions(raw.transactions, asset) : null,
    tradeBait: raw.tradeBait
      ? asArray<any>(raw.tradeBait.tradeBaits?.tradeBait ?? raw.tradeBait.tradeBait?.tradeBait ?? raw.tradeBait.tradeBait).map((b) => ({
          teamId: String(b.franchise_id ?? b.franchise ?? ''),
          offering: assets(b.willGiveUp),
          wants: text(b.inExchangeFor),
          when: when(b.timestamp),
        }))
      : null,
    pendingTrades: raw.pending
      ? asArray<any>(raw.pending.pendingTrades?.pendingTrade).map((t) => ({
          fromTeamId: String(t.offeringteam ?? t.offeringTeam ?? ''),
          toTeamId: String(t.offeredto ?? t.offeredTo ?? ''),
          gives: assets(t.will_give_up),
          gets: assets(t.will_receive),
          comments: text(t.comments),
          expires: when(t.expires),
        }))
      : null,
    salaryAdjustments: raw.adjustments
      ? asArray<any>(raw.adjustments.salaryAdjustments?.salaryAdjustment).map((a) => ({
          teamId: String(a.franchise_id ?? a.franchise ?? ''),
          amount: num(a.amount) ?? 0,
          description: text(a.description),
          when: when(a.timestamp),
        }))
      : null,
    calendar: raw.calendar
      ? asArray<any>(raw.calendar.calendar?.event)
          .map((e) => ({
            title: text(e.title) || text(e.type).replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
            start: when(e.start_time),
            end: when(e.end_time),
          }))
          .filter((e) => e.title)
      : null,
    injuries: Object.fromEntries(
      asArray<any>(raw.injuries?.injuries?.injury).map((i) => [String(i.id), { status: text(i.status), details: text(i.details) }]),
    ),
    ytdPoints: scoreMap(raw.ytd?.playerScores?.playerScore),
    projections: scoreMap(raw.projected?.projectedScores?.playerScore),
    projectionWeek: num(raw.projected?.projectedScores?.week),
    trending: {
      adds: trends(raw.adds?.topAdds?.player, players),
      drops: trends(raw.drops?.topDrops?.player, players),
    },
  };
}

function parseSettings(league: any): MflSettings {
  const l = league?.league ?? {};
  const franchises = asArray<any>(l.franchises?.franchise);
  return {
    rosterSize: num(l.rosterSize),
    irSize: num(l.injuredReserve),
    taxiSize: num(l.taxiSquad),
    startWeek: num(l.startWeek),
    endWeek: num(l.endWeek),
    lastRegularWeek: num(l.lastRegularSeasonWeek),
    startersCount: num(l.starters?.count),
    starters: asArray<any>(l.starters?.position).map((p) => ({ pos: text(p.name), limit: text(p.limit) })),
    divisions: asArray<any>(l.divisions?.division).map((d) => ({
      id: String(d.id),
      name: text(d.name),
      teamIds: franchises.filter((f) => String(f.division) === String(d.id)).map((f) => String(f.id)),
    })),
  };
}

function parseScoring(rules: any, allRules: any): MflExtras['scoring'] {
  const names = new Map<string, string>(
    asArray<any>(allRules?.allRules?.rule).map((r) => [text(r.abbreviation), text(r.shortDescription)]),
  );
  const out: MflExtras['scoring'] = [];
  for (const group of asArray<any>(rules?.rules?.positionRules)) {
    for (const r of asArray<any>(group.rule)) {
      out.push({
        positions: text(group.positions),
        rule: names.get(text(r.event)) || text(r.event),
        points: text(r.points),
        range: text(r.range) || undefined,
      });
    }
  }
  return out;
}

function parseSchedule(schedule: any): MflMatchup[] {
  const out: MflMatchup[] = [];
  for (const w of asArray<any>(schedule?.schedule?.weeklySchedule)) {
    for (const m of asArray<any>(w.matchup)) {
      out.push({
        week: num(w.week) ?? 0,
        teams: asArray<any>(m.franchise).map((f) => ({
          teamId: String(f.id),
          score: num(f.score),
          result: text(f.result) || undefined,
          home: text(f.isHome) === '1',
        })),
      });
    }
  }
  return out;
}

/** "13604,|12345," -> [["13604"], ["12345"]] */
const split = (s: string) => s.split('|').map((part) => part.split(',').map((x) => x.trim()).filter(Boolean));

export function parseTransactions(data: any, asset: (a: string) => string): MflTransaction[] {
  const out: MflTransaction[] = [];
  for (const t of asArray<any>(data?.transactions?.transaction)) {
    const type = text(t.type);
    const base = { when: when(t.timestamp) ?? '', type, teamId: String(t.franchise ?? ''), added: [] as string[], dropped: [] as string[], gave: [] as string[], got: [] as string[] };
    const body = text(t.transaction);
    if (type === 'TRADE') {
      const gave = text(t.franchise1_gave_up).split(',').filter(Boolean).map(asset);
      const got = text(t.franchise2_gave_up).split(',').filter(Boolean).map(asset);
      out.push({ ...base, otherTeamId: String(t.franchise2 ?? ''), gave, got, comments: text(t.comments) || undefined });
    } else if (type === 'BBID_WAIVER') {
      // "playerId,bid|dropped1,dropped2,"
      const [addPart = [], dropPart = []] = split(body);
      out.push({ ...base, added: addPart.slice(0, 1).map(asset), amount: num(addPart[1]), dropped: dropPart.map(asset) });
    } else if (type === 'AUCTION_WON') {
      // "playerId|amount|"
      const [id, amount] = body.split('|');
      out.push({ ...base, added: id ? [asset(id)] : [], amount: num(amount) });
    } else {
      // FREE_AGENT / WAIVER: "added1,added2,|dropped1,"
      const [addPart = [], dropPart = []] = split(body);
      out.push({ ...base, added: addPart.map(asset), dropped: dropPart.map(asset) });
    }
  }
  return out.sort((a, b) => b.when.localeCompare(a.when));
}

/**
 * Player ids -> "Name (POS)", future picks FP_<orig>_<year>_<round> -> "2027 Rd 2 (Team)",
 * current picks DP_<round-1>_<pick-1> -> "Rd 3.06", blind bid BB_<n> -> "$n blind bid".
 */
export function describeAsset(a: string, players: Record<string, MflPlayerRef>, league?: any): string {
  const fp = a.match(/^FP_(\d+)_(\d{4})_(\d+)$/);
  if (fp) {
    const team = asArray<any>(league?.league?.franchises?.franchise).find((f) => String(f.id) === fp[1]);
    return `${fp[2]} Rd ${fp[3]} pick${team ? ` (${text(team.name)})` : ''}`;
  }
  const dp = a.match(/^DP_(\d+)_(\d+)$/);
  if (dp) return `Rd ${Number(dp[1]) + 1}.${String(Number(dp[2]) + 1).padStart(2, '0')} pick`;
  const bb = a.match(/^BB_([\d.]+)$/);
  if (bb) return `$${bb[1]} blind bid`;
  const p = players[a];
  return p ? `${p.name} (${p.pos})` : `Player #${a}`;
}

function scoreMap(list: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of asArray<any>(list)) {
    const n = num(s.score);
    if (n !== undefined) out[String(s.id)] = n;
  }
  return out;
}

function trends(list: any, players: Record<string, MflPlayerRef>): MflTrend[] {
  return asArray<any>(list)
    .map((p) => {
      const ref = players[String(p.id)];
      return ref ? { id: String(p.id), name: ref.name, pos: ref.pos, nfl: ref.nfl, percent: num(p.percent) ?? 0 } : null;
    })
    .filter((t): t is MflTrend => t !== null);
}
