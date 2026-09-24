import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Snapshot } from '../shared/types.js';
import { parseFantasyProsCsv } from './providers/fantasypros.js';
import { EMPTY_SNAPSHOT, loadWatchlist, refresh, saveRankings, saveWatchlist } from './refresh.js';
import { loadSettings, mergeSettings, publicSettings, readJson, writeJson } from './store.js';

const PORT = Number(process.env.PORT ?? 8787);
// Bound to localhost by default: the settings hold your ESPN cookies and API keys.
const HOST = process.env.HOST ?? '127.0.0.1';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '5mb' }));

const wrap =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) =>
    fn(req, res).catch((err: Error) => res.status(500).json({ error: err.message }));

app.get('/api/snapshot', (_req, res) => {
  res.json(readJson<Snapshot>('snapshot.json', EMPTY_SNAPSHOT));
});

app.post('/api/refresh', wrap(async (_req, res) => res.json(await refresh())));

app.get('/api/settings', (_req, res) => res.json(publicSettings(loadSettings())));

app.put(
  '/api/settings',
  wrap(async (req, res) => {
    const next = mergeSettings(loadSettings(), req.body ?? {});
    writeJson('settings.json', next);
    scheduleAutoRefresh();
    await refresh({ fetchRemote: false });
    res.json(publicSettings(next));
  }),
);

app.get('/api/watchlist', (_req, res) => res.json(loadWatchlist()));

app.put(
  '/api/watchlist',
  wrap(async (req, res) => {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected an array of names' });
    saveWatchlist(req.body.map(String));
    res.json(await refresh({ fetchRemote: false }));
  }),
);

app.post(
  '/api/rankings/csv',
  wrap(async (req, res) => {
    const players = parseFantasyProsCsv(String(req.body ?? ''));
    saveRankings('CSV import', players);
    res.json(await refresh({ fetchRemote: false }));
  }),
);

app.delete(
  '/api/alerts',
  wrap(async (_req, res) => {
    writeJson('alerts.json', []);
    res.json(await refresh({ fetchRemote: false }));
  }),
);

const clientDir = resolve('dist/client');
if (existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(clientDir, 'index.html')));
}

let timer: NodeJS.Timeout | undefined;
function scheduleAutoRefresh() {
  clearInterval(timer);
  const minutes = loadSettings().autoRefreshMinutes;
  if (minutes > 0) {
    timer = setInterval(() => {
      refresh().catch((err) => console.error('Auto-refresh failed:', err.message));
    }, Math.max(5, minutes) * 60000);
  }
}

app.listen(PORT, HOST, () => {
  console.log(`Dynasty Command Center API on http://${HOST}:${PORT}`);
  scheduleAutoRefresh();
});
