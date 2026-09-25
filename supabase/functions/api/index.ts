// Supabase Edge Function entry point: wires the database, auth and background tasks into app.ts.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from '../_shared/app.ts';
import type { Store } from '../_shared/store.ts';

// Provided by the Supabase Edge Runtime.
declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void };

const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !serviceKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set in this function');
const ownerEmail = (Deno.env.get('OWNER_EMAIL') ?? '').trim().toLowerCase();

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

// Both tables have row-level security on and no policies, so only this function (service role)
// can read them. app_state holds shared data; user_state holds each user's own data.
const store: Store = {
  async get<T>(key: string, fallback: T): Promise<T> {
    const { data, error } = await db.from('app_state').select('value').eq('key', key).maybeSingle();
    if (error) throw new Error(`Database read failed (${key}): ${error.message}`);
    return data ? (data.value as T) : fallback;
  },
  async set(key: string, value: unknown): Promise<void> {
    const { error } = await db
      .from('app_state')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw new Error(`Database write failed (${key}): ${error.message}`);
  },
};

function userStore(userId: string): Store {
  return {
    async get<T>(key: string, fallback: T): Promise<T> {
      const { data, error } = await db.from('user_state').select('value').eq('user_id', userId).eq('key', key).maybeSingle();
      if (error) throw new Error(`Database read failed (${key}): ${error.message}`);
      return data ? (data.value as T) : fallback;
    },
    async set(key: string, value: unknown): Promise<void> {
      const { error } = await db
        .from('user_state')
        .upsert({ user_id: userId, key, value, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' });
      if (error) throw new Error(`Database write failed (${key}): ${error.message}`);
    },
  };
}

async function listUserIds(): Promise<string[]> {
  const { data, error } = await db.from('user_state').select('user_id').eq('key', 'settings');
  if (error) throw new Error(`Database read failed (users): ${error.message}`);
  return (data ?? []).map((r) => r.user_id as string);
}

async function deleteUserData(userId: string): Promise<void> {
  const { error } = await db.from('user_state').delete().eq('user_id', userId);
  if (error) throw new Error(`Database delete failed: ${error.message}`);
}

async function authenticate(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user?.email) return null;
  return { id: data.user.id, email: data.user.email };
}

const admin = {
  async createUser(email: string, password: string): Promise<string> {
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (data?.user) return data.user.id;
    // Already has a Supabase account (e.g. signed up before signups were turned off): reuse it.
    if (error && /already|registered|exists/i.test(error.message)) {
      for (let page = 1; page <= 20; page++) {
        const { data: list, error: listError } = await db.auth.admin.listUsers({ page, perPage: 200 });
        if (listError) throw new Error(listError.message);
        const found = list.users.find((u) => u.email?.toLowerCase() === email);
        if (found) {
          await db.auth.admin.updateUserById(found.id, { password, email_confirm: true });
          return found.id;
        }
        if (list.users.length < 200) break;
      }
    }
    throw new Error(`Could not create the account: ${error?.message ?? 'unknown error'}`);
  },
  async deleteUser(userId: string): Promise<void> {
    const { error } = await db.auth.admin.deleteUser(userId);
    if (error && !/not.?found/i.test(error.message)) throw new Error(`Could not delete the account: ${error.message}`);
  },
};

Deno.serve((req) =>
  handle(req, {
    store,
    userStore,
    listUserIds,
    deleteUserData,
    authenticate,
    ownerEmail,
    admin,
    cronUrl: `${url}/functions/v1/api/cron`,
    background: (work) => EdgeRuntime.waitUntil(work),
  }),
);
