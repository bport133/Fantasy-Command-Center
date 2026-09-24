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

// app_state has row-level security on and no policies, so only this function (service role) can read it.
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

async function isOwner(req: Request): Promise<boolean> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || !ownerEmail) return false;
  const { data, error } = await db.auth.getUser(token);
  return !error && data.user?.email?.toLowerCase() === ownerEmail;
}

Deno.serve((req) =>
  handle(req, {
    store,
    isOwner,
    cronUrl: `${url}/functions/v1/api/cron`,
    background: (work) => EdgeRuntime.waitUntil(work),
  }),
);
