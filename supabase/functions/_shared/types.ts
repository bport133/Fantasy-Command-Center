// Types shared by the server and the browser.

export type Platform = 'sleeper' | 'espn' | 'mfl';

/** Someone the owner invited to use the app. */
export interface Member {
  email: string;
  userId: string;
  addedAt: string;
}
export type Position = 'QB' | 'RB' | 'WR' | 'TE';

export type LeagueFormat = 'redraft' | 'keeper' | 'dynasty';
export const LEAGUE_FORMATS: LeagueFormat[] = ['redraft', 'keeper', 'dynasty'];

/** FantasyPros consensus ranking sets. */
export type RankingType = 'draft' | 'weekly' | 'ros' | 'dynasty' | 'rookies';
export const RANKING_TYPES: RankingType[] = ['draft', 'weekly', 'ros', 'dynasty', 'rookies'];
export const RANKING_LABELS: Record<RankingType, string> = {
  draft: 'Draft (preseason)',
  weekly: 'Weekly',
  ros: 'Rest of season',
  dynasty: 'Dynasty',
  rookies: 'Dynasty rookies',
};

export type Scoring = 'PPR' | 'HALF' | 'STD';
export const SCORINGS: Scoring[] = ['PPR', 'HALF', 'STD'];

/** Current NFL calendar position (from Sleeper). */
export interface NflState {
  season: number;
  week: number;
  /** 'pre' | 'regular' | 'post' | 'off' */
  seasonType: string;
}
export const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE'];

export interface LeagueConfig {
  /** Local id, stable across edits. */
  id: string;
  platform: Platform;
  leagueId: string;
  /** Team name, owner name or team id. Picked from a dropdown after the first refresh. */
  myTeam: string;
  /** MFL only: the www##.myfantasyleague.com host for the league. */
  host?: string;
  /** How the league carries rosters between seasons. Missing = dynasty (the original behavior). */
  format?: LeagueFormat;
  /** Keeper leagues: how many players each team keeps. */
  keepers?: number;
  /** Rankings used to value players; 'auto' picks by format and time of year. */
  rankings?: RankingType | 'auto';
  /** Scoring for the rankings; 'default' uses the FantasyPros default in Settings. */
  scoring?: Scoring | 'default';
}

export interface Settings {
  season: number;
  leagues: LeagueConfig[];
  espnS2: string;
  espnSwid: string;
  mflApiKey: string;
  /** MFL login cookie, set by signing in to MFL from Settings (the password is never stored). */
  mflCookie: string;
  /** Username the MFL cookie belongs to, shown in Settings. */
  mflUsername: string;
  /** Client name registered with MFL, sent as the User-Agent on every MFL request. */
  mflUserAgent: string;
  mflSalaryCap: number;
  mflContractYearCap: number;
  projectionYears: number;
  freeAgentsPerLeague: number;
  alertTopN: number;
  alertWebhookUrl: string;
  autoRefreshMinutes: number;
  fpApiKey: string;
  /** Legacy single ranking type (before per-league formats); read only for old settings. */
  fpType?: string;
  /** Default scoring for FantasyPros rankings. */
  fpScoring: string;
  /** FantasyPros ranking sets to load and show, besides the ones leagues need. */
  fpTypes: RankingType[];
}

/** Settings as sent to the browser: secrets are replaced by a flag saying whether they are set. */
export type PublicSettings = Omit<Settings, SecretKey> & { secretsSet: Record<SecretKey, boolean> };
export type SecretKey = 'espnS2' | 'espnSwid' | 'mflApiKey' | 'mflCookie' | 'fpApiKey' | 'alertWebhookUrl';
export const SECRET_KEYS: SecretKey[] = ['espnS2', 'espnSwid', 'mflApiKey', 'mflCookie', 'fpApiKey', 'alertWebhookUrl'];

export type Slot = 'Starter' | 'Bench' | 'IR' | 'Taxi' | 'Active';

export interface RosterPlayer {
  /** The platform's own player id. */
  id?: string;
  name: string;
  key: string;
  pos: string;
  nfl: string;
  slot: Slot;
  salary?: number;
  contractYears?: number;
}

export interface Team {
  id: string;
  name: string;
  owner?: string;
  record?: string;
  players: RosterPlayer[];
}

export interface DraftPick {
  season: number;
  round: number;
  /** Team whose pick it originally was. */
  originalTeamId: string;
  /** Team that holds it now. */
  ownerTeamId: string;
}

export interface LeagueData {
  configId: string;
  platform: Platform;
  name: string;
  season: number;
  teams: Team[];
  /** null when the platform does not expose future picks. */
  picks: DraftPick[] | null;
  salaryCap?: number;
  /** MFL-only league detail. */
  mfl?: MflExtras;
}

// ---- MFL league detail (names already resolved from MFL ids) ----

/** null = MFL refused it (usually needs the MFL API key) or the request failed. */
export interface MflExtras {
  settings: MflSettings;
  scoring: { positions: string; rule: string; points: string; range?: string }[];
  standings: { teamId: string; w: number; l: number; t: number; pf: number; pa: number }[];
  schedule: MflMatchup[];
  transactions: MflTransaction[] | null;
  tradeBait: { teamId: string; offering: string[]; wants: string; when?: string }[] | null;
  pendingTrades: { fromTeamId: string; toTeamId: string; gives: string[]; gets: string[]; comments: string; expires?: string }[] | null;
  salaryAdjustments: { teamId: string; amount: number; description: string; when?: string }[] | null;
  calendar: { title: string; start?: string; end?: string }[] | null;
  /** Keyed by the MFL player id. */
  injuries: Record<string, { status: string; details: string }>;
  ytdPoints: Record<string, number>;
  projections: Record<string, number>;
  projectionWeek?: number;
  trending: { adds: MflTrend[]; drops: MflTrend[] };
  /** Sections MFL refused or that failed, with the reason, e.g. "Pending trades: needs the MFL API key". */
  unavailable: string[];
}

export interface MflSettings {
  rosterSize?: number;
  irSize?: number;
  taxiSize?: number;
  startWeek?: number;
  endWeek?: number;
  lastRegularWeek?: number;
  starters: { pos: string; limit: string }[];
  startersCount?: number;
  divisions: { id: string; name: string; teamIds: string[] }[];
}

export interface MflMatchup {
  week: number;
  teams: { teamId: string; score?: number; result?: string; home: boolean }[];
}

export interface MflTransaction {
  when: string;
  type: string;
  teamId: string;
  otherTeamId?: string;
  added: string[];
  dropped: string[];
  /** Trades: what teamId gave and received. */
  gave: string[];
  got: string[];
  amount?: number;
  comments?: string;
}

export interface MflTrend {
  id: string;
  name: string;
  pos: string;
  nfl: string;
  percent: number;
}

export interface FPPlayer {
  rank: number;
  tier: number;
  name: string;
  key: string;
  nfl: string;
  pos: string;
  age?: number;
  best?: number;
  worst?: number;
  avg?: number;
}

export interface PlayerInfo {
  age?: number;
  yearsExp?: number;
}

// ---- Computed views ----

export interface EnrichedPlayer extends RosterPlayer {
  /** Keeper leagues: one of this team's best keepers by long-term value. */
  keeper?: boolean;
  injury?: string;
  ytdPoints?: number;
  age?: number;
  yearsExp?: number;
  rank?: number;
  tier?: number;
  value: number;
}

export interface LeagueSummary {
  configId: string;
  platform: Platform;
  format: LeagueFormat;
  /** e.g. "Rest of season · PPR" */
  rankingLabel: string;
  name: string;
  myTeam: string | null;
  record?: string;
  valueRank: number | null;
  teamCount: number;
  top100: number;
  avgAge: number | null;
  status: string;
}

export interface TeamValueRow {
  rank: number;
  teamId: string;
  team: string;
  record?: string;
  total: number;
  byPos: Record<Position, number>;
  top100: number;
  avgAge: number | null;
  mine: boolean;
}

export interface FreeAgentRow {
  configId: string;
  league: string;
  rank: number;
  tier: number;
  name: string;
  pos: string;
  nfl: string;
  age?: number;
  yearsExp?: number;
  watched: boolean;
}

export interface TradeTarget {
  fit: 'Strong' | 'Partial';
  team: string;
  theirSurplus: Position;
  theirNeed: Position;
  targets: { name: string; rank: number }[];
  offers: { name: string; rank: number }[];
}

export interface TradeFinderLeague {
  configId: string;
  league: string;
  myStrength: Position | null;
  myNeed: Position | null;
  rows: TradeTarget[];
}

export interface PickRow {
  season: number;
  round: number;
  source: string;
}

export interface PicksLeague {
  configId: string;
  league: string;
  format: LeagueFormat;
  supported: boolean;
  picks: PickRow[];
}

export interface CapYear {
  season: number;
  cap: number;
  /** Player salaries plus salary adjustments (adjustments only count this season). */
  committed: number;
  adjustments: number;
  remaining: number;
  contracts: number;
  pctUsed: number;
  avgSalary: number;
  yearsCap: number;
  yearsCommitted: number;
  yearsRemaining: number;
  pctYearsUsed: number;
}

export interface CapPositionRow {
  pos: string;
  players: number;
  total: number;
  avg: number;
  pct: number;
  capRank: number;
}

export interface ContractRow {
  name: string;
  pos: string;
  nfl: string;
  slot: Slot;
  rank?: number;
  salary: number;
  contractYears: number;
  finalSeason: number;
  bySeason: (number | null)[];
  yearsBySeason: number[];
}

export interface MflCapView {
  configId: string;
  league: string;
  /** Where the salary cap came from: MFL's league settings, or the fallback in Settings. */
  capSource: 'MFL' | 'Settings';
  seasons: number[];
  years: CapYear[];
  positions: CapPositionRow[];
  contracts: ContractRow[];
}

export interface ExpiringRow {
  endsAfter: number;
  rank?: number;
  name: string;
  pos: string;
  age?: number;
  team: string;
  salary: number;
  contractYears: number;
  mine: boolean;
}

export interface CapRoomRow {
  team: string;
  committed: number;
  room: number;
  yearsCommitted: number;
  expiringValue: number;
  mine: boolean;
}

export interface MflExpiringView {
  configId: string;
  league: string;
  nextSeason: number;
  expiring: ExpiringRow[];
  capRoom: CapRoomRow[];
}

export interface MflLeagueView {
  configId: string;
  league: string;
  myTeam: string | null;
  currentWeek: number | null;
  settings: MflSettings;
  scoring: MflExtras['scoring'];
  standings: { rank: number; team: string; record: string; pf: number; pa: number; division?: string; mine: boolean }[];
  matchup: {
    week: number;
    opponent: string;
    myScore?: number;
    oppScore?: number;
    result?: string;
  } | null;
  /** Your roster with this week's MFL projection, best first. */
  projections: { name: string; pos: string; nfl: string; slot: string; projected?: number; injury?: string }[];
  projectionWeek?: number;
  mySchedule: { week: number; opponent: string; myScore?: number; oppScore?: number; result?: string }[];
  transactions: { when: string; type: string; team: string; summary: string; mine: boolean }[] | null;
  tradeBait: { team: string; offering: string[]; wants: string; mine: boolean }[] | null;
  pendingTrades: { from: string; to: string; gives: string[]; gets: string[]; comments: string; expires?: string }[] | null;
  salaryAdjustments: { team: string; amount: number; description: string; when?: string; mine: boolean }[] | null;
  calendar: MflExtras['calendar'];
  trending: {
    adds: (MflTrend & { available: boolean; rank?: number })[];
    drops: (MflTrend & { available: boolean; rank?: number; owner?: string })[];
  };
  unavailable: string[];
}

export interface WatchRow {
  name: string;
  pos?: string;
  rank?: number;
  /** configId -> team holding him, 'FA', or undefined when not found. */
  status: Record<string, string>;
}

export interface Alert {
  when: string;
  configId: string;
  league: string;
  player: string;
  pos: string;
  rank?: number;
  droppedBy: string;
  watchlist: boolean;
}

export interface RosterGroup {
  configId: string;
  platform: Platform;
  format: LeagueFormat;
  rankingLabel: string;
  /** Keeper leagues: players to keep, best first (by dynasty value). */
  keeperPlan?: { keepers: number; players: { name: string; pos: string; rank?: number; value: number }[]; basis: string };
  league: string;
  team: string;
  hasContracts: boolean;
  players: EnrichedPlayer[];
}

export interface RankingSet {
  type: RankingType;
  scoring: Scoring;
  label: string;
  source: string;
  at: string;
  players: (FPPlayer & { value: number })[];
}

export interface ProjectedPlayer {
  name: string;
  key: string;
  pos: string;
  team: string;
  points: number;
}

export interface ProjectionSet {
  week: number;
  scoring: Scoring;
  at: string;
  players: ProjectedPlayer[];
}

export interface NewsItem {
  title: string;
  description?: string;
  player?: string;
  team?: string;
  time?: string;
  url?: string;
  impact?: string;
  mine: boolean;
}

export interface DfsPlayer {
  id: string;
  name: string;
  key: string;
  pos: string;
  team: string;
  opp: string;
  game: string;
  salary: number;
  fppg: number;
  injury: string;
  /** FantasyPros half-PPR projection when available, otherwise FanDuel's FPPG. */
  projection: number;
  projectionSource: 'FantasyPros' | 'FanDuel FPPG';
}

export interface DfsSlate {
  uploadedAt: string;
  games: string[];
  projectionNote: string;
  players: DfsPlayer[];
}

export interface SourceStatus {
  source: string;
  ok: boolean;
  message: string;
}

export interface Snapshot {
  refreshedAt: string | null;
  sources: SourceStatus[];
  fpCount: number;
  leagues: LeagueSummary[];
  rosters: RosterGroup[];
  freeAgents: FreeAgentRow[];
  teamValues: { configId: string; league: string; rankingLabel: string; rows: TeamValueRow[] }[];
  tradeFinder: TradeFinderLeague[];
  picks: PicksLeague[];
  mflCap: MflCapView[];
  mflExpiring: MflExpiringView[];
  mflLeague: MflLeagueView[];
  watchlist: WatchRow[];
  alerts: Alert[];
  /** Default ranking set (for name suggestions and the watchlist). */
  rankings: (FPPlayer & { value: number })[];
  /** Every FantasyPros ranking set loaded, for the FantasyPros page. */
  rankingSets: RankingSet[];
  projections: ProjectionSet | null;
  news: NewsItem[];
  nflState: NflState | null;
  /** FanDuel slate with projections merged in; lineups are optimized in the browser. */
  dfs: DfsSlate | null;
  /** Team choices per league, for the "my team" dropdown in Settings. */
  teamChoices: Record<string, { id: string; name: string }[]>;
}
