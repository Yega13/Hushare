-- Real-time presence + admin growth charts.
--
-- active_sessions: one throwaway row per live browser tab, refreshed by a ~30s heartbeat. UNLOGGED
-- because it is pure ephemeral state — losing it on a crash just momentarily resets the live count,
-- so we skip WAL for cheaper writes. Rows are pruned opportunistically by the /api/presence handler.
create unlogged table if not exists public.active_sessions (
  id         text primary key,
  last_seen  timestamptz not null default now(),
  path       text
);
create index if not exists active_sessions_last_seen_idx on public.active_sessions (last_seen);

-- Daily new-albums / new-uploads counts for the admin growth charts, aggregated DB-side (range scans
-- on created_at) so the page never has to fetch thousands of rows. security definer + a locked-down
-- search_path; EXECUTE is revoked from the public roles and granted only to service_role (the admin
-- page's server client), so it can never leak counts to anon callers.
create or replace function public.admin_growth_series(p_days int)
returns table(day date, albums bigint, uploads bigint)
language sql
stable
security definer
set search_path = public
as $$
  select d::date as day,
    (select count(*) from albums where created_at >= d and created_at < d + interval '1 day') as albums,
    (select count(*) from photos where created_at >= d and created_at < d + interval '1 day') as uploads
  from generate_series(
    date_trunc('day', now()) - make_interval(days => greatest(p_days, 1) - 1),
    date_trunc('day', now()),
    interval '1 day'
  ) as d;
$$;

revoke all on function public.admin_growth_series(int) from public;
grant execute on function public.admin_growth_series(int) to service_role;
