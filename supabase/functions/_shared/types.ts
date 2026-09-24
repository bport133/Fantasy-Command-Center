// Types shared by the server and the browser.

export type Platform = 'sleeper' | 'espn' | 'mfl';
export type Position = 'QB' | 'RB' | 'WR' | 'TE';
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
}

export interface Settings {
  season: number;
  leagues: LeagueConfig[];
  espnS2: string;
  espnSwid: string;
  mflApiKey: string;
  mflSalaryCap: number;
  mflContractYearCap: number;
  projectionYears: number;
  freeAgentsPerLeague: number;
  alertTopN: number;
  alertWebhookUrl: string;
  autoRefreshMinutes: number;
  fpApiKey: string;
  fpType: string;
  fpScoring: string;
}

/** Settings as sent to the browser: secrets are replaced by a flag saying whether they are set. */
export type PublicSettings = Omit<Settings, SecretKey> & { secretsSet: Record<SecretKey, boolean> };
export type SecretKey = 'espnS2' | 'espnSwid' | 'mflApiKey' | 'fpApiKey' | 'alertWebhookUrl';
export const SECRET_KEYS: SecretKey[] = ['espnS2', 'espnSwid', 'mflApiKey', 'fpApiKey', 'alertWebhookUrl'];

export type Slot = 'Starter' | 'Bench' | 'IR' | 'Taxi' | 'Active';

export interface RosterPlayer {
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
  age?: number;
  yearsExp?: number;
  rank?: number;
  tier?: number;
  value: number;
}

export interface LeagueSummary {
  configId: string;
  platform: Platform;
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
  supported: boolean;
  picks: PickRow[];
}

export interface CapYear {
  season: number;
  cap: number;
  committed: number;
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
  league: string;
  team: string;
  hasContracts: boolean;
  players: EnrichedPlayer[];
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
  teamValues: { configId: string; league: string; rows: TeamValueRow[] }[];
  tradeFinder: TradeFinderLeague[];
  picks: PicksLeague[];
  mflCap: MflCapView[];
  mflExpiring: MflExpiringView[];
  watchlist: WatchRow[];
  alerts: Alert[];
  rankings: (FPPlayer & { value: number })[];
  /** Team choices per league, for the "my team" dropdown in Settings. */
  teamChoices: Record<string, { id: string; name: string }[]>;
}
