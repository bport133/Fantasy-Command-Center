import type { PublicSettings, Settings, SecretKey, Snapshot } from '../../shared/types';

async function call<T>(method: string, path: string, body?: unknown, contentType = 'application/json'): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': contentType },
    body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : String(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  snapshot: () => call<Snapshot>('GET', '/snapshot'),
  refresh: () => call<Snapshot>('POST', '/refresh'),
  settings: () => call<PublicSettings>('GET', '/settings'),
  saveSettings: (s: Partial<Settings> & { clearSecrets?: SecretKey[] }) => call<PublicSettings>('PUT', '/settings', s),
  watchlist: () => call<string[]>('GET', '/watchlist'),
  saveWatchlist: (names: string[]) => call<Snapshot>('PUT', '/watchlist', names),
  importCsv: (csv: string) => call<Snapshot>('POST', '/rankings/csv', csv, 'text/csv'),
  clearAlerts: () => call<Snapshot>('DELETE', '/alerts'),
};
