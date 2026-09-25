import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle, type AppDeps } from '../supabase/functions/_shared/app.ts';
import { memoryStore } from '../supabase/functions/_shared/store.ts';
import type { Snapshot } from '../supabase/functions/_shared/types.ts';

const BASE = 'https://proj.supabase.co/functions/v1/api';

/** Canned responses for every external API the refresh touches. */
function fakeApis(url: string): unknown {
  const u = new URL(url);
  if (u.host === 'api.fantasypros.com') {
    if (u.pathname.endsWith('/projections')) {
      return {
        players: [
          { name: 'Joe Burrow', team_id: 'CIN', position_id: 'QB', stats: { points: 21.4 } },
          { name: 'Bills', team_id: 'BUF', position_id: 'DST', stats: { points: 8 } },
        ],
      };
    }
    if (u.pathname.endsWith('/news')) {
      return { items: [{ title: 'Burrow limited in practice', player_name: 'Joe Burrow', updated: '2026-09-24T12:00:00Z' }] };
    }
    return {
      players: [
        { player_name: "Ja'Marr Chase", player_team_id: 'CIN', player_position_id: 'WR', rank_ecr: 1, tier: 1 },
        { player_name: 'Bijan Robinson', player_team_id: 'ATL', player_position_id: 'RB', rank_ecr: 4, tier: 1 },
        { player_name: 'Joe Burrow', player_team_id: 'CIN', player_position_id: 'QB', rank_ecr: 34, tier: 5 },
        { player_name: 'Travis Hunter', player_team_id: 'JAC', player_position_id: 'WR', rank_ecr: 152, tier: 10 },
      ],
    };
  }
  if (u.host === 'api.sleeper.app') {
    const p = u.pathname;
    if (p === '/v1/state/nfl') return { season: '2026', league_season: '2026', week: 3, display_week: 3, season_type: 'regular' };
    if (p === '/v1/players/nfl') {
      return {
        '1': { full_name: "Ja'Marr Chase", position: 'WR', team: 'CIN', birth_date: '2000-03-01', years_exp: 5 },
        '2': { full_name: 'Joe Burrow', position: 'QB', team: 'CIN', birth_date: '1996-12-10', years_exp: 6 },
        '3': { full_name: 'Bijan Robinson', position: 'RB', team: 'ATL', years_exp: 3 },
        '9': { full_name: 'Some Kicker', position: 'K', team: 'ATL' },
        '10': { full_name: 'Some Lineman', position: 'OL', team: 'ATL' },
      };
    }
    if (p.endsWith('/users')) return [{ user_id: 'u1', display_name: 'bport133' }, { user_id: 'u2', display_name: 'bleys' }];
    if (p.endsWith('/rosters')) {
      return [
        { roster_id: 1, owner_id: 'u1', players: ['2'], starters: ['2'], settings: { wins: 1, losses: 1 } },
        { roster_id: 2, owner_id: 'u2', players: ['1', '3'], starters: ['1'], settings: { wins: 2, losses: 0 } },
      ];
    }
    if (p.endsWith('/traded_picks')) return [];
    return { name: 'Section V', status: 'in_season', settings: { draft_rounds: 3 } };
  }
  throw new Error(`unexpected fetch ${url}`);
}

const USERS: Record<string, { id: string; email: string }> = {
  'Bearer good': { id: 'u-owner', email: 'owner@example.com' },
  'Bearer friend': { id: 'u-friend', email: 'friend@example.com' },
  'Bearer stranger': { id: 'u-stranger', email: 'stranger@example.com' },
};

function deps() {
  const store = memoryStore();
  const users = new Map<string, ReturnType<typeof memoryStore>>();
  const userStore = (id: string) => {
    if (!users.has(id)) users.set(id, memoryStore());
    return users.get(id)!;
  };
  const pending: Promise<unknown>[] = [];
  const created: { email: string; password: string }[] = [];
  const deleted: string[] = [];
  const d = {
    store,
    userStore,
    users,
    own: () => userStore('u-owner'),
    listUserIds: async () => [...users.entries()].filter(([, s]) => 'settings' in s.data).map(([id]) => id),
    deleteUserData: async (id: string) => void users.delete(id),
    authenticate: async (req: Request) => USERS[req.headers.get('authorization') ?? ''] ?? null,
    ownerEmail: 'owner@example.com',
    admin: {
      createUser: async (email: string, password: string) => {
        created.push({ email, password });
        return email === 'friend@example.com' ? 'u-friend' : `u-${email}`;
      },
      deleteUser: async (id: string) => void deleted.push(id),
    },
    created,
    deleted,
    cronUrl: `${BASE}/cron`,
    background: (w: Promise<unknown>) => pending.push(w),
    pending,
  };
  return d;
}

const call = (d: AppDeps, method: string, path: string, body?: unknown, auth = 'Bearer good') =>
  handle(
    new Request(`${BASE}${path}`, {
      method,
      headers: { authorization: auth, 'content-type': typeof body === 'string' ? 'text/csv' : 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
    d,
  );

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      return new Response(JSON.stringify(fakeApis(url)), { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('api function', () => {
  it('rejects requests without a valid sign-in', async () => {
    const d = deps();
    const res = await call(d, 'GET', '/snapshot', undefined, 'Bearer nope');
    expect(res.status).toBe(401);
    // A real Supabase account that wasn't invited gets nothing.
    expect((await call(d, 'GET', '/snapshot', undefined, 'Bearer stranger')).status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('answers CORS preflight', async () => {
    const res = await handle(new Request(`${BASE}/refresh`, { method: 'OPTIONS' }), deps());
    expect(res.status).toBe(204);
  });

  it('saves settings, refreshes from the APIs and builds the snapshot', async () => {
    const d = deps();
    const saved = await (
      await call(d, 'PUT', '/settings', {
        season: 2026,
        fpApiKey: 'fp-secret',
        leagues: [{ id: 's', platform: 'sleeper', leagueId: '123', myTeam: 'bport133' }],
      })
    ).json();
    expect(saved.fpApiKey).toBeUndefined();
    expect(saved.secretsSet.fpApiKey).toBe(true);

    const res = await call(d, 'POST', '/refresh');
    expect(res.status).toBe(200);
    const snap: Snapshot = await res.json();
    expect(snap.sources.every((s) => s.ok)).toBe(true);
    expect(snap.fpCount).toBe(4);
    expect(snap.leagues[0]).toMatchObject({ name: 'Section V', myTeam: 'bport133', valueRank: 2, status: '✅ OK' });
    expect(snap.rosters[0].players[0]).toMatchObject({ name: 'Joe Burrow', rank: 34, yearsExp: 6 });
    expect(snap.rosters[0].players[0].age).toBeGreaterThan(29);
    expect(snap.freeAgents.map((f) => f.name)).toEqual(['Travis Hunter']);
    expect(snap.teamChoices.s).toHaveLength(2);

    // The FantasyPros key went to FantasyPros as a header, not in the URL.
    const fpCall = vi.mocked(fetch).mock.calls.find(([u]) => String(u).includes('fantasypros'))!;
    expect(String(fpCall[0])).not.toContain('fp-secret');
    expect((fpCall[1] as RequestInit).headers).toMatchObject({ 'x-api-key': 'fp-secret' });

    // The trimmed Sleeper DB was cached, without non-fantasy positions.
    const cache = d.store.data['cache:sleeper-players'] as any;
    expect(Object.keys(cache.players).sort()).toEqual(['1', '2', '3', '9']);
  });

  it('updates the watchlist without calling external APIs', async () => {
    const d = deps();
    await call(d, 'PUT', '/settings', { fpApiKey: 'k', leagues: [{ id: 's', platform: 'sleeper', leagueId: '1', myTeam: 'bport133' }] });
    await call(d, 'POST', '/refresh');
    vi.mocked(fetch).mockClear();
    const snap: Snapshot = await (await call(d, 'PUT', '/watchlist', ['Travis Hunter', 'Bijan Robinson'])).json();
    expect(fetch).not.toHaveBeenCalled();
    expect(snap.watchlist.map((w) => [w.name, w.status.s])).toEqual([
      ['Travis Hunter', 'FA'],
      ['Bijan Robinson', 'bleys'],
    ]);
    expect(snap.freeAgents[0].watched).toBe(true);
  });

  it('signs in to MFL, keeping the cookie but not the password', async () => {
    const d = deps();
    vi.mocked(fetch).mockImplementationOnce(async () => new Response('<status MFL_USER_ID="cookie123">OK</status>'));
    const res = await call(d, 'POST', '/mfl/login', { username: 'tony', password: 'hunter2' });
    const pub = await res.json();
    expect(pub).toMatchObject({ mflUsername: 'tony', secretsSet: { mflCookie: true } });
    expect(JSON.stringify(pub)).not.toContain('cookie123');
    expect(JSON.stringify(d.own().data)).not.toContain('hunter2');
    expect((d.own().data.settings as any).mflCookie).toBe('cookie123');
  });

  it('imports a rankings CSV', async () => {
    const d = deps();
    const csv = 'RK,TIERS,PLAYER NAME,TEAM,POS,AGE\n1,1,Bijan Robinson,ATL,RB1,24\n';
    const snap: Snapshot = await (await call(d, 'POST', '/rankings/csv', csv)).json();
    expect(snap.rankings.map((r) => r.name)).toEqual(['Bijan Robinson']);
  });

  it('runs the scheduled refresh only with the stored secret and only when due', async () => {
    const d = deps();
    await call(d, 'PUT', '/settings', { autoRefreshMinutes: 60, leagues: [{ id: 's', platform: 'sleeper', leagueId: '1', myTeam: 'bport133' }] });
    const cron = d.store.data.cron as { url: string; secret: string };
    expect(cron.url).toBe(`${BASE}/cron`);
    expect(cron.secret).toMatch(/^[0-9a-f]{48}$/);

    const tick = (secret: string) =>
      handle(new Request(`${BASE}/cron`, { method: 'POST', headers: { 'x-cron-secret': secret } }), d);

    expect((await tick('wrong'.padEnd(48, '0'))).status).toBe(401);
    const first = await tick(cron.secret);
    expect(first.status).toBe(202);
    await Promise.all(d.pending);
    expect((d.own().data.snapshot as Snapshot).refreshedAt).not.toBeNull();
    // Refreshed moments ago, so the next tick is a no-op.
    expect(await (await tick(cron.secret)).json()).toEqual({ ran: 0 });
  });
});

describe('multiple users', () => {
  it('lets the owner invite, and remove, members', async () => {
    const d = deps();
    expect((await call(d, 'GET', '/snapshot', undefined, 'Bearer friend')).status).toBe(403);

    const bad = await call(d, 'POST', '/members', { email: 'friend@example.com', password: 'short' });
    expect(bad.status).toBe(400);
    const res = await call(d, 'POST', '/members', { email: 'Friend@Example.com', password: 'welcome-2026' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([expect.objectContaining({ email: 'friend@example.com', userId: 'u-friend' })]);
    expect(d.created).toEqual([{ email: 'friend@example.com', password: 'welcome-2026' }]);

    // Members can use the app but can't manage members.
    expect((await call(d, 'GET', '/snapshot', undefined, 'Bearer friend')).status).toBe(200);
    expect(await (await call(d, 'GET', '/me', undefined, 'Bearer friend')).json()).toEqual({ email: 'friend@example.com', isOwner: false });
    expect((await call(d, 'POST', '/members', { email: 'x@y.com', password: '12345678' }, 'Bearer friend')).status).toBe(403);

    // Removing deletes their account and data.
    await call(d, 'PUT', '/watchlist', ['Travis Hunter'], 'Bearer friend');
    expect(d.users.has('u-friend')).toBe(true);
    const removed = await call(d, 'DELETE', '/members/friend%40example.com');
    expect(await removed.json()).toEqual([]);
    expect(d.deleted).toEqual(['u-friend']);
    expect(d.users.has('u-friend')).toBe(false);
    expect((await call(d, 'GET', '/snapshot', undefined, 'Bearer friend')).status).toBe(403);
  });

  it("keeps each person's settings and data separate", async () => {
    const d = deps();
    await call(d, 'POST', '/members', { email: 'friend@example.com', password: 'welcome-2026' });
    await call(d, 'PUT', '/settings', { fpApiKey: 'owner-key', leagues: [{ id: 's', platform: 'sleeper', leagueId: '1', myTeam: 'bport133' }] });
    await call(d, 'PUT', '/watchlist', ['Bijan Robinson']);

    const friendSettings = await (await call(d, 'GET', '/settings', undefined, 'Bearer friend')).json();
    expect(friendSettings.leagues).toEqual([]);
    expect(friendSettings.secretsSet.fpApiKey).toBe(false);
    expect(await (await call(d, 'GET', '/watchlist', undefined, 'Bearer friend')).json()).toEqual([]);

    await call(d, 'PUT', '/watchlist', ['Travis Hunter'], 'Bearer friend');
    expect(await (await call(d, 'GET', '/watchlist')).json()).toEqual(['Bijan Robinson']);
    expect(JSON.stringify(d.users.get('u-friend')!.data)).not.toContain('owner-key');
  });

  it("moves the owner's pre-multi-user data into their account once", async () => {
    const d = deps();
    await d.store.set('settings', { fpApiKey: 'legacy-key', leagues: [] });
    await d.store.set('watchlist', ['Joe Burrow']);
    await d.store.set('cache:sleeper-players', { at: 1, players: {} });

    expect(await (await call(d, 'GET', '/watchlist')).json()).toEqual(['Joe Burrow']);
    expect((await (await call(d, 'GET', '/settings')).json()).secretsSet.fpApiKey).toBe(true);
    // Credentials no longer sit in shared storage; shared caches stay shared.
    expect(d.store.data.settings).toBeNull();
    expect(d.store.data['cache:sleeper-players']).toBeDefined();
    // A member signing in never picks up the owner's old data.
    await call(d, 'POST', '/members', { email: 'friend@example.com', password: 'welcome-2026' });
    expect(await (await call(d, 'GET', '/watchlist', undefined, 'Bearer friend')).json()).toEqual([]);
  });

  it('scheduled refresh covers every user whose refresh is due', async () => {
    const d = deps();
    await call(d, 'POST', '/members', { email: 'friend@example.com', password: 'welcome-2026' });
    const league = { leagues: [{ id: 's', platform: 'sleeper', leagueId: '1', myTeam: 'bport133' }], autoRefreshMinutes: 60 };
    await call(d, 'PUT', '/settings', league);
    await call(d, 'PUT', '/settings', league, 'Bearer friend');
    const { secret } = d.store.data.cron as { secret: string };
    const tick = () => handle(new Request(`${BASE}/cron`, { method: 'POST', headers: { 'x-cron-secret': secret } }), d);

    expect(await (await tick()).json()).toEqual({ ran: 2 });
    await Promise.all(d.pending);
    expect((d.users.get('u-owner')!.data.snapshot as Snapshot).refreshedAt).not.toBeNull();
    expect((d.users.get('u-friend')!.data.snapshot as Snapshot).refreshedAt).not.toBeNull();
    expect(await (await tick()).json()).toEqual({ ran: 0 });
  });
});
