-- Which DAYS OF THE WEEK the product is actually busy.
--
-- The admin page already plots the last 14 days, which answers "is it growing" but not "when do
-- people use this". For an events product that second question is the operational one: it says when
-- uploads spike, and therefore when a deploy is a bad idea and when support needs to be awake.
--
-- Aggregated in the DATABASE, in the OWNER'S timezone, for two separate reasons.
--
-- DB-side because the alternative is shipping every row's created_at to the page and bucketing in
-- JavaScript. admin_growth_series already established this pattern for exactly that reason.
--
-- In the owner's timezone because the existing series buckets by UTC day, and bucketing a weekday
-- chart by UTC is quietly wrong here. The owner is at UTC+4, so the first four hours of every local
-- day fall into the previous UTC day: a reception running to 02:00 on Sunday is recorded as
-- Saturday. Over 12 weeks that does not average out — it systematically drags late-evening activity
-- backwards by one day, which is precisely the signal this chart exists to show. Passing the zone in
-- keeps the truth in one place rather than applying a fudge factor on the page.
--
-- 0 = Sunday, matching Postgres `extract(dow ...)`. The page reorders to a Monday-first week.
--
-- security definer with a locked search_path, EXECUTE revoked from the public roles and granted only
-- to service_role — same shape as admin_growth_series. This counts every album and photo in the
-- system, so it must never be callable by anon.
create or replace function public.admin_weekday_series(p_days int, p_tz text)
returns table(dow int, albums bigint, uploads bigint)
language sql
stable
security definer
set search_path = public
as $$
  with span as (
    -- Midnight local, p_days-1 days back, converted to an absolute instant so it can be compared
    -- against timestamptz columns directly and use their indexes.
    select (
      (date_trunc('day', now() at time zone p_tz) - make_interval(days => greatest(p_days, 1) - 1))
      at time zone p_tz
    ) as from_ts
  ),
  a as (
    select extract(dow from (albums.created_at at time zone p_tz))::int as dow, count(*) as c
    from albums, span
    where albums.created_at >= span.from_ts
    group by 1
  ),
  p as (
    select extract(dow from (photos.created_at at time zone p_tz))::int as dow, count(*) as c
    from photos, span
    where photos.created_at >= span.from_ts
    group by 1
  )
  select g.dow::int, coalesce(a.c, 0)::bigint, coalesce(p.c, 0)::bigint
  from generate_series(0, 6) as g(dow)
  left join a on a.dow = g.dow
  left join p on p.dow = g.dow
  order by g.dow;
$$;

revoke all on function public.admin_weekday_series(int, text) from public, anon, authenticated;
grant execute on function public.admin_weekday_series(int, text) to service_role;
