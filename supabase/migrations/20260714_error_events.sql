-- Error / near-miss event log powering the /admin "Errors" view. Written by the client-error
-- API route (real guest upload failures + recovered-after-retry near-misses) and, optionally,
-- server-side. Read only by the service-role admin client. Idempotent.

create table if not exists public.error_events (
  id          bigint      generated always as identity primary key,
  created_at  timestamptz not null default now(),
  level       text        not null default 'error' check (level in ('error','warn')),
  source      text        not null check (char_length(source) <= 60),
  message     text        not null check (char_length(message) between 1 and 500),
  album_id    uuid,
  context     jsonb,
  ua          text        check (ua is null or char_length(ua) <= 300)
);

create index if not exists error_events_created_idx       on public.error_events(created_at desc);
create index if not exists error_events_level_created_idx on public.error_events(level, created_at desc);

alter table public.error_events enable row level security;
-- No policies: only the service-role admin client reads/writes this table.

-- Retention: keep 30 days. Called from the daily cron (and probabilistically by the writer).
create or replace function public.prune_error_events()
returns void language sql security definer
set search_path = public, pg_temp as $$
  delete from public.error_events where created_at < now() - interval '30 days';
$$;
