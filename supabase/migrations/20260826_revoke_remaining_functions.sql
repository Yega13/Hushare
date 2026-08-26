-- The last three functions still callable with the publishable key. Found by the new function
-- check in scripts/check-db.mjs, on the first run after it was written.
--
-- admin_growth_series IS A LIVE BUSINESS-DATA LEAK. SECURITY DEFINER, and it returns albums
-- created and uploads received per day. Verified on 2026-08-26 by calling it through PostgREST with
-- the publishable key that ships in every page: HTTP 200, three days of real figures. Anyone —
-- including a competitor — could poll it and watch this product's growth in real time. It exists to
-- draw one chart on /admin, which reaches it through the service-role client and is unaffected.
--
-- The other two are trigger functions. PostgreSQL checks EXECUTE when the TRIGGER is created, not
-- when it fires, so revoking here does not stop the triggers working (verified after applying by
-- performing an albums UPDATE and watching updated_at move). They were never meant to be callable
-- from outside; they were simply left at the default.
--
-- THE DEFAULT IS THE PROBLEM, not these three functions. Postgres grants EXECUTE on every new
-- function to PUBLIC, so each new SECURITY DEFINER function is world-callable through PostgREST
-- from the moment it is created. That has now been missed three separate times: the 2026-08-20
-- audit caught prune_rate_limit_events and prune_error_events, missed batch_set_sort_order and
-- album_is_open, and nobody had looked at these. check-db.mjs now fails on ANY function reachable
-- by PUBLIC or anon, with no allowlist — the correct number here is zero.
--
-- Idempotent — safe to re-run.

revoke execute on function public.admin_growth_series(integer) from public, anon, authenticated;
revoke execute on function public.ensure_album_slug_namespace_unique() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
