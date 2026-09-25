-- Multi-user support: each signed-in person's settings, leagues, snapshot, watchlist and alerts
-- are stored under their own user id. Like app_state, RLS is on with no policies, so only the
-- api Edge Function (service role) can read or write it. app_state keeps shared data only
-- (player-database caches, the scheduler config and the member list).
create table if not exists public.user_state (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.user_state enable row level security;
revoke all on public.user_state from anon, authenticated;
