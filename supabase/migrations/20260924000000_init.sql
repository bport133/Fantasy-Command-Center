-- Dynasty Command Center storage and hourly refresh schedule.

-- Everything the app keeps (settings incl. credentials, snapshot, caches, watchlist, alerts)
-- is a JSON value under a key. RLS is on with no policies: the browser's anon/user keys can't
-- read or write it; only the api Edge Function (service role) can.
create table if not exists public.app_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_state enable row level security;
revoke all on public.app_state from anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Called by pg_cron. The api function stores its own URL and a random secret in the 'cron' row
-- the first time you open the app, so nothing needs to be configured here by hand. The function
-- decides whether a refresh is due based on the auto-refresh setting.
create or replace function public.dcc_cron_tick()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cfg jsonb;
begin
  select value into cfg from public.app_state where key = 'cron';
  if cfg is null or cfg->>'url' is null then
    return;
  end if;
  perform net.http_post(
    url := cfg->>'url',
    body := '{}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', cfg->>'secret'),
    timeout_milliseconds := 10000
  );
end;
$$;
revoke all on function public.dcc_cron_tick() from public, anon, authenticated;

-- Check every 15 minutes; the function only refreshes when the configured interval has passed.
select cron.unschedule(jobid) from cron.job where jobname = 'dcc-refresh';
select cron.schedule('dcc-refresh', '*/15 * * * *', $$select public.dcc_cron_tick()$$);
