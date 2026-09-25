// HTTP routes for the `api` Edge Function. Platform-agnostic so it can be tested without Deno.
//
// Every signed-in person has their own settings, leagues, watchlist, alerts and snapshot (a
// per-user Store). Access is invite-only: the owner (OWNER_EMAIL) plus the members the owner
// adds on the Members page. Shared, public lookup data (player databases) and the scheduler
// config live in the global Store.

import { parseFantasyProsCsv } from './providers/fantasypros.ts';
import { mflLogin } from './providers/mfl.ts';
import { EMPTY_SNAPSHOT, loadWatchlist, refresh, refreshDue, saveDfsSlate, saveRankings, saveWatchlist } from './refresh.ts';
import { loadSettings, mergeSettings, publicSettings } from './settings.ts';
import type { Store } from './store.ts';
import { RANKING_TYPES, type Member, type RankingType, type Scoring, type Snapshot } from './types.ts';

export interface AuthUser {
  id: string;
  email: string;
}

export interface AppDeps {
  /** Shared data: player-database caches, scheduler config, member list. */
  store: Store;
  /** One user's private data. */
  userStore: (userId: string) => Store;
  /** Users that have saved settings, for the scheduled refresh. */
  listUserIds: () => Promise<string[]>;
  /** Removes everything stored for a user. */
  deleteUserData: (userId: string) => Promise<void>;
  /** The signed-in Supabase user behind the request's access token, if any. */
  authenticate: (req: Request) => Promise<AuthUser | null>;
  ownerEmail: string;
  /** Supabase Auth admin actions, used by the owner's Members page. */
  admin: {
    /** Creates (or finds, if it already exists) a confirmed user and returns its id. */
    createUser: (email: string, password: string) => Promise<string>;
    deleteUser: (userId: string) => Promise<void>;
  };
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

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Scheduled refreshes run one user after another; cap them so one tick stays well inside the time limit. */
const MAX_SCHEDULED_REFRESHES = 3;
const MIN_PASSWORD = 8;

/** Keys that hold one user's data (moved out of the old single-user storage on first sign-in). */
const USER_KEYS = ['settings', 'snapshot', 'leagues', 'watchlist', 'alerts', 'roster-state', 'rankings'];

const loadMembers = (store: Store) => store.get<Member[]>('members', []);

export async function handle(req: Request, deps: AppDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  // Route is whatever follows ".../api" in the path, e.g. /functions/v1/api/snapshot -> /snapshot.
  const route = new URL(req.url).pathname.replace(/^.*?\/api(?=\/|$)/, '') || '/';

  try {
    if (route === '/cron' && req.method === 'POST') return await cron(req, deps);

    const user = await deps.authenticate(req);
    if (!user) return json({ error: 'Not signed in' }, 401);
    const isOwner = !!deps.ownerEmail && user.email.toLowerCase() === deps.ownerEmail.toLowerCase();
    if (!isOwner) {
      const members = await loadMembers(deps.store);
      const allowed = members.some((m) => m.userId === user.id || m.email.toLowerCase() === user.email.toLowerCase());
      if (!allowed) return json({ error: "This account hasn't been invited to this app. Ask the app owner to add you." }, 403);
    }
    await ensureCronConfig(deps);
    const store = deps.userStore(user.id);
    if (isOwner) await adoptLegacyData(deps.store, store);
    const opts = { cache: deps.store };

    switch (`${req.method} ${route}`) {
      case 'GET /me':
        return json({ email: user.email, isOwner });
      case 'GET /snapshot':
        return json(await store.get<Snapshot>('snapshot', EMPTY_SNAPSHOT));
      case 'POST /refresh':
        return json(await refresh(store, opts));
      case 'GET /settings':
        return json(publicSettings(await loadSettings(store)));
      case 'PUT /settings': {
        const next = mergeSettings(await loadSettings(store), await req.json());
        await store.set('settings', next);
        await refresh(store, { ...opts, fetchRemote: false });
        return json(publicSettings(next));
      }
      case 'POST /mfl/login': {
        // The password goes to MFL once and is dropped; only MFL's session cookie is kept.
        const { username, password } = (await req.json()) ?? {};
        const settings = await loadSettings(store);
        const cookie = await mflLogin(settings.season, String(username ?? ''), String(password ?? ''), fetch, settings.mflUserAgent);
        const next = { ...settings, mflCookie: cookie, mflUsername: String(username).trim() };
        await store.set('settings', next);
        return json(publicSettings(next));
      }
      case 'GET /watchlist':
        return json(await loadWatchlist(store));
      case 'PUT /watchlist': {
        const body = await req.json();
        if (!Array.isArray(body)) return json({ error: 'Expected an array of names' }, 400);
        await saveWatchlist(store, body.map(String));
        return json(await refresh(store, { ...opts, fetchRemote: false }));
      }
      case 'POST /rankings/csv': {
        // ?type=ros|draft|weekly|dynasty|rookies (default dynasty), at the default scoring.
        const players = parseFantasyProsCsv(await req.text());
        const type = new URL(req.url).searchParams.get('type') as RankingType | null;
        const settings = await loadSettings(store);
        const choice = { type: type && RANKING_TYPES.includes(type) ? type : 'dynasty', scoring: settings.fpScoring as Scoring };
        await saveRankings(store, 'CSV import', players, choice);
        return json(await refresh(store, { ...opts, fetchRemote: false }));
      }
      case 'POST /dfs/slate':
        await saveDfsSlate(store, await req.text());
        return json(await refresh(store, { ...opts, fetchRemote: false }));
      case 'DELETE /dfs/slate':
        await store.set('dfs-slate', null);
        return json(await refresh(store, { ...opts, fetchRemote: false }));
      case 'DELETE /alerts':
        await store.set('alerts', []);
        return json(await refresh(store, { ...opts, fetchRemote: false }));
    }

    // Members (owner only).
    if (route === '/members' || route.startsWith('/members/')) {
      if (!isOwner) return json({ error: 'Only the app owner can manage members' }, 403);
      return json(await members(req, route, deps));
    }
    return json({ error: `Unknown route ${req.method} ${route}` }, 404);
  } catch (err) {
    return json({ error: (err as Error).message }, err instanceof HttpError ? err.status : 500);
  }
}

async function members(req: Request, route: string, deps: AppDeps): Promise<Member[]> {
  const list = await loadMembers(deps.store);
  if (req.method === 'GET') return list;

  if (req.method === 'POST' && route === '/members') {
    const { email, password } = (await req.json()) ?? {};
    const addr = String(email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) throw new HttpError(400, 'Enter a valid email address');
    if (addr === deps.ownerEmail.toLowerCase()) throw new HttpError(400, "That's you, the owner");
    if (list.some((m) => m.email === addr)) throw new HttpError(400, `${addr} is already a member`);
    if (String(password ?? '').length < MIN_PASSWORD) throw new HttpError(400, `Starting password must be at least ${MIN_PASSWORD} characters`);
    const userId = await deps.admin.createUser(addr, String(password));
    const next = [...list, { email: addr, userId, addedAt: new Date().toISOString() }];
    await deps.store.set('members', next);
    return next;
  }

  if (req.method === 'DELETE' && route.startsWith('/members/')) {
    const addr = decodeURIComponent(route.slice('/members/'.length)).toLowerCase();
    const member = list.find((m) => m.email === addr);
    if (!member) throw new HttpError(404, `${addr} is not a member`);
    await deps.deleteUserData(member.userId);
    await deps.admin.deleteUser(member.userId);
    const next = list.filter((m) => m !== member);
    await deps.store.set('members', next);
    return next;
  }
  throw new HttpError(404, `Unknown route ${req.method} ${route}`);
}

/**
 * Before multi-user support everything lived in the shared store. The first time the owner
 * signs in afterwards, move their data into their own space.
 */
async function adoptLegacyData(shared: Store, own: Store): Promise<void> {
  if ((await own.get('settings', null)) !== null) return;
  const legacy = await shared.get('settings', null);
  if (legacy === null) return;
  for (const key of USER_KEYS) {
    const value = await shared.get<unknown>(key, undefined);
    if (value !== undefined && value !== null) await own.set(key, value);
  }
  // Blank the old settings so this never runs twice and the credentials in it aren't left behind.
  await shared.set('settings', null);
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
  const due: string[] = [];
  for (const id of await deps.listUserIds()) {
    if (due.length >= MAX_SCHEDULED_REFRESHES) break;
    if (await refreshDue(deps.userStore(id))) due.push(id);
  }
  if (!due.length) return json({ ran: 0 });
  // Answer right away; pg_net does not need to wait. Anyone left over is picked up next tick.
  deps.background(
    (async () => {
      for (const id of due) {
        await refresh(deps.userStore(id), { cache: deps.store }).catch((err) =>
          console.error(`Scheduled refresh failed for ${id}:`, err),
        );
      }
    })(),
  );
  return json({ ran: due.length }, 202);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
