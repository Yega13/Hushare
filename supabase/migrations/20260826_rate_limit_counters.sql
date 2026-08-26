-- One counter row per key per window, incremented atomically, instead of one row per request.
--
-- E7 from the 2026-08-20 audit. Note the audit's prescribed fix — "move to the Cloudflare
-- [[ratelimits]] binding already in wrangler.toml" — is NOT POSSIBLE: that binding's `period` is an
-- enum of exactly [10, 60] seconds (wrangler's own config schema), and six of the eight hot-path
-- checks use a 3,600s window. Converting them to per-minute equivalents would reject real guests —
-- 50 people uploading 10 photos each inside a minute is 500 requests, comfortably inside an hourly
-- budget and over any per-minute one. That would make the event case worse, which is the only case
-- E7 is about.
--
-- The audit's DIAGNOSIS is also off. The per-request COUNT is an Index Only Scan, 3 buffer hits,
-- 1.8ms — measured on the busiest live key. Postgres is not the bottleneck. The cost is the number
-- of HTTPS ROUND TRIPS from the Worker to Supabase: insert, then count, plus a delete on rejection.
-- Two or three per check, four checks per upload. Network latency, which no index touches.
--
-- So: collapse it to ONE round trip. rate_limit_hit() increments and decides in a single statement.
--
-- WHAT CHANGES SEMANTICALLY, stated plainly because it is a real trade: today's limiter is a
-- SLIDING window (events in the last N seconds). A counter is a FIXED window (events in this
-- N-second block), which permits up to 2x the limit across a boundary. For abuse backstops that is
-- the normal trade and it is fine. It is NOT fine for a caller using max=1 as a debounce —
-- photo_notify sends the owner's "new photos" email once per 600s, and a fixed window could send
-- two. Those callers stay on the sliding implementation; see checkRateLimit in src/lib/rate-limit.
--
-- The table also stops growing without bound: 62,846 event rows become roughly one row per active
-- key, pruned on the daily pass.
--
-- Idempotent — safe to re-run.

create table if not exists public.rate_limit_counters (
  key          text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (key, window_start)
);

alter table public.rate_limit_counters enable row level security;
-- No policy, and no grants below: every caller reaches this through the service-role client after a
-- server-side check, exactly like every other table here.

-- Atomic: the increment and the decision are the same statement, so two concurrent requests cannot
-- both read a count below the limit before either writes. That is the property the old
-- insert-then-count was carefully built to preserve, and it is preserved here for free.
create or replace function public.rate_limit_hit(
  p_key text,
  p_window_seconds integer,
  p_max integer
)
returns table (allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_bucket timestamptz;
  v_hits   integer;
begin
  -- Floor now() to the window. Every caller in the same window shares one row.
  v_bucket := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limit_counters (key, window_start, hits)
  values (p_key, v_bucket, 1)
  on conflict (key, window_start) do update set hits = rate_limit_counters.hits + 1
  returning hits into v_hits;

  if v_hits > p_max then
    -- Time until this window rolls, not the whole window length: a caller rejected near the end of
    -- a window is told to wait seconds rather than an hour. The old implementation always returned
    -- the full window, which is honest but needlessly pessimistic.
    return query select false, greatest(1, ceil(extract(epoch from (v_bucket + make_interval(secs => p_window_seconds)) - now()))::integer);
  end if;
  return query select true, 0;
end;
$$;

-- REVOKED FROM PUBLIC, not just from anon. Postgres grants EXECUTE on every new function to PUBLIC,
-- so without this line a brand-new SECURITY DEFINER function is callable through PostgREST with the
-- publishable key the moment it exists — which is how batch_set_sort_order and admin_growth_series
-- came to be reachable. scripts/check-db.mjs fails the build on any function that is.
revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
