// HTTP routes for the `api` Edge Function. Platform-agnostic so it can be tested without Deno.

import { parseFantasyProsCsv } from './providers/fantasypros.ts';
import { EMPTY_SNAPSHOT, loadWatchlist, refresh, refreshDue, saveRankings, saveWatchlist } from './refresh.ts';
import { loadSettings, mergeSettings, publicSettings } from './settings.ts';
import type { Store } from './store.ts';
import type { Snapshot } from './types.ts';

export interface AppDeps {
  store: Store;
  /** Resolves true when the request carries a signed-in owner's access token. */
  isOwner: (req: Request) => Promise<boolean>;
  /** Public URL of the cron route, recorded so the database scheduler knows where to call. */
  cronUrl: string;
  /** Keeps work running after the response is sent (EdgeRuntime.waitUntil in production). */
  background: (work: Promise<unknown>) => void;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-cron-secret',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

export async function handle(req: Request, deps: AppDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const { store } = deps;
  // Route is whatever follows ".../api" in the path, e.g. /functions/v1/api/snapshot -> /snapshot.
  const route = new URL(req.url).pathname.replace(/^.*?\/api(?=\/|$)/, '') || '/';

  try {
    if (route === '/cron' && req.method === 'POST') return await cron(req, deps);

    if (!(await deps.isOwner(req))) return json({ error: 'Not signed in, or this account is not the app owner' }, 401);
    await ensureCronConfig(deps);

    switch (`${req.method} ${route}`) {
      case 'GET /snapshot':
        return json(await store.get<Snapshot>('snapshot', EMPTY_SNAPSHOT));
      case 'POST /refresh':
        return json(await refresh(store));
      case 'GET /settings':
        return json(publicSettings(await loadSettings(store)));
      case 'PUT /settings': {
        const next = mergeSettings(await loadSettings(store), await req.json());
        await store.set('settings', next);
        await refresh(store, { fetchRemote: false });
        return json(publicSettings(next));
      }
      case 'GET /watchlist':
        return json(await loadWatchlist(store));
      case 'PUT /watchlist': {
        const body = await req.json();
        if (!Array.isArray(body)) return json({ error: 'Expected an array of names' }, 400);
        await saveWatchlist(store, body.map(String));
        return json(await refresh(store, { fetchRemote: false }));
      }
      case 'POST /rankings/csv': {
        const players = parseFantasyProsCsv(await req.text());
        await saveRankings(store, 'CSV import', players);
        return json(await refresh(store, { fetchRemote: false }));
      }
      case 'DELETE /alerts':
        await store.set('alerts', []);
        return json(await refresh(store, { fetchRemote: false }));
      default:
        return json({ error: `Unknown route ${req.method} ${route}` }, 404);
    }
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
}

interface CronConfig {
  url: string;
  secret: string;
}

/**
 * The database's scheduled job reads this row to know which URL to call and which secret to
 * send, so no one has to paste either into Supabase by hand.
 */
async function ensureCronConfig(deps: AppDeps): Promise<void> {
  const current = await deps.store.get<CronConfig | null>('cron', null);
  if (current?.url === deps.cronUrl && current.secret) return;
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await deps.store.set('cron', { url: deps.cronUrl, secret });
}

async function cron(req: Request, deps: AppDeps): Promise<Response> {
  const cfg = await deps.store.get<CronConfig | null>('cron', null);
  const given = req.headers.get('x-cron-secret') ?? '';
  if (!cfg?.secret || !timingSafeEqual(given, cfg.secret)) return json({ error: 'Bad cron secret' }, 401);
  if (!(await refreshDue(deps.store))) return json({ ran: false });
  // Answer right away; pg_net does not need to wait for the refresh to finish.
  deps.background(refresh(deps.store).catch((err) => console.error('Scheduled refresh failed:', err)));
  return json({ ran: true }, 202);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
