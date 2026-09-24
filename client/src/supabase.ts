import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(SUPABASE_URL && ANON_KEY);

// Placeholder values keep createClient happy on a misconfigured build; the UI shows a setup message instead.
export const supabase = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', ANON_KEY || 'placeholder', {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const ANON = ANON_KEY ?? '';
