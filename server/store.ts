// JSON-file persistence under DATA_DIR (default ./data, which is gitignored).
// Settings with credentials, caches, watchlist, roster snapshots and alerts all live here.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  SECRET_KEYS,
  type PublicSettings,
  type SecretKey,
  type Settings,
} from '../shared/types.js';

export const DATA_DIR = resolve(process.env.DATA_DIR ?? 'data');

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, value: unknown): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const path = join(DATA_DIR, file);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

export const DEFAULT_SETTINGS: Settings = {
  season: new Date().getMonth() < 2 ? new Date().getFullYear() - 1 : new Date().getFullYear(),
  leagues: [],
  espnS2: '',
  espnSwid: '',
  mflApiKey: '',
  mflSalaryCap: 200000,
  mflContractYearCap: 72,
  projectionYears: 5,
  freeAgentsPerLeague: 40,
  alertTopN: 150,
  alertWebhookUrl: '',
  autoRefreshMinutes: 60,
  fpApiKey: '',
  fpType: 'dynasty',
  fpScoring: 'PPR',
};

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>('settings.json', {}) };
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
    if (!(k in DEFAULT_SETTINGS) || v === undefined) continue;
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
        }));
    } else if (typeof v === 'string') {
      (next as any)[k] = v.trim();
    }
  }
  for (const k of patch.clearSecrets ?? []) if (SECRET_KEYS.includes(k)) next[k] = '';
  return next;
}
