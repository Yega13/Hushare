-- Close public EXECUTE on the two prune functions.
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default, and Supabase does not revoke it.
-- Verified on the live database (2026-08-20): both of these showed `anon=X`, meaning anyone holding
-- the anon key could call them. That key ships inside the browser bundle by design, so "anyone"
-- means anyone on the internet.
--
-- Each call is an unqualified DELETE over rate_limit_events, which at the time of writing is the
-- largest table in the database (19,551 rows / 11 MB — larger than `photos`) and sits on the upload
-- path: every presign and every save writes to it and then counts it. Calling this in a loop during
-- an event means sustained sequential scans and dead-tuple bloat on the exact table that gates
-- uploads, and that limiter fails CLOSED — so the end state is guests unable to upload.
--
-- This codebase already knows the default is open: studio_add_credits, studio_spend_credits and
-- admin_growth_series are all explicitly revoked (20260728_studio_credits.sql:91-93,
-- 20260812_active_sessions.sql:34). These two were simply missed.
--
-- Idempotent: REVOKE on an already-revoked grant is a no-op. The functions keep working for the
-- service role, which is what the cron actually uses.

revoke all on function public.prune_rate_limit_events() from public, anon, authenticated;
revoke all on function public.prune_error_events() from public, anon, authenticated;
