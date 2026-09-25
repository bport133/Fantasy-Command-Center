// Settings defaults, merging updates from the browser, and hiding secrets from it.

import {
  LEAGUE_FORMATS,
  RANKING_TYPES,
  SCORINGS,
  SECRET_KEYS,
  type PublicSettings,
  type SecretKey,
  type Settings,
} from './types.ts';
import type { Store } from './store.ts';

export const DEFAULT_SETTINGS: Settings = {
  season: new Date().getMonth() < 2 ? new Date().getFullYear() - 1 : new Date().getFullYear(),
  leagues: [],
  espnS2: '',
  espnSwid: '',
  mflApiKey: '',
  mflCookie: '',
  mflUsername: '',
  mflUserAgent: '',
  mflSalaryCap: 200000,
  mflContractYearCap: 72,
  projectionYears: 5,
  freeAgentsPerLeague: 40,
  alertTopN: 150,
  alertWebhookUrl: '',
  autoRefreshMinutes: 60,
  fpApiKey: '',
  fpScoring: 'PPR',
  fpTypes: ['draft', 'weekly', 'ros', 'dynasty', 'rookies'],
};

export async function loadSettings(store: Store): Promise<Settings> {
  const saved = await store.get<Partial<Settings> | null>('settings', {});
  const s: Settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
  // Leagues saved before formats existed were all valued as dynasty.
  s.leagues = s.leagues.map((l) => ({ format: 'dynasty', rankings: 'auto', scoring: 'default', ...l }));
  if (!SCORINGS.includes(s.fpScoring as never)) s.fpScoring = 'PPR';
  return s;
}

export function publicSettings(s: Settings): PublicSettings {
  const out: Record<string, unknown> = { ...s };
  const secretsSet = {} as Record<SecretKey, boolean>;
  for (const k of SECRET_KEYS) {
    secretsSet[k] = Boolean(s[k]);
    delete out[k];
  }
  return { ...(out as Omit<Settings, SecretKey>), secretsSet };
}

const NUMERIC: (keyof Settings)[] = [
  'season',
  'mflSalaryCap',
  'mflContractYearCap',
  'projectionYears',
  'freeAgentsPerLeague',
  'alertTopN',
  'autoRefreshMinutes',
];

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Set only by the server (MFL sign-in), never from a settings form. */
const SERVER_ONLY: (keyof Settings)[] = ['mflCookie', 'mflUsername'];

/**
 * Apply an update from the browser. Secret fields are only replaced when a non-empty value
 * is sent (the browser never sees them); list a key in `clearSecrets` to blank it.
 */
export function mergeSettings(
  current: Settings,
  patch: Partial<Settings> & { clearSecrets?: SecretKey[] },
): Settings {
  const next: Settings = { ...current };
  for (const [k, v] of Object.entries(patch) as [keyof Settings, unknown][]) {
    if (!(k in DEFAULT_SETTINGS) || v === undefined || SERVER_ONLY.includes(k)) continue;
    if ((SECRET_KEYS as string[]).includes(k)) {
      if (typeof v === 'string' && v.trim()) (next as any)[k] = v.trim();
    } else if (NUMERIC.includes(k)) {
      const n = Number(v);
      if (Number.isFinite(n)) (next as any)[k] = n;
    } else if (k === 'leagues' && Array.isArray(v)) {
      next.leagues = v
        .filter((l) => l && ['sleeper', 'espn', 'mfl'].includes(l.platform))
        .map((l) => ({
          id: String(l.id || Math.random().toString(36).slice(2, 10)),
          platform: l.platform,
          leagueId: String(l.leagueId ?? '').trim(),
          myTeam: String(l.myTeam ?? '').trim(),
          ...(l.platform === 'mfl' ? { host: String(l.host ?? '').trim() } : {}),
          format: LEAGUE_FORMATS.includes(l.format) ? l.format : 'dynasty',
          ...(l.format === 'keeper' ? { keepers: clampInt(l.keepers, 1, 25, 3) } : {}),
          rankings: RANKING_TYPES.includes(l.rankings) ? l.rankings : 'auto',
          scoring: SCORINGS.includes(l.scoring) ? l.scoring : 'default',
        }));
    } else if (k === 'fpTypes' && Array.isArray(v)) {
      next.fpTypes = RANKING_TYPES.filter((t) => v.includes(t));
    } else if (typeof v === 'string') {
      (next as any)[k] = v.trim();
    }
  }
  for (const k of patch.clearSecrets ?? []) if (SECRET_KEYS.includes(k)) next[k] = '';
  if (!next.mflCookie) next.mflUsername = '';
  return next;
}
