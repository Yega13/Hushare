-- Revoke SELECT from the PUBLIC anon key on every table nothing reads with it.
--
-- WHAT WAS ACTUALLY WRONG: no data was exposed. Every one of these tables has RLS enabled with no
-- permissive policy, so anon reads returned zero rows. Verified against the live REST API with the
-- publishable key before writing this.
--
-- The problem is that the grant made the whole thing depend on ONE layer. `albums` carries
-- owner_token and password_hash; `subscriptions` carries billing identifiers. With a live anon
-- SELECT grant, adding a single permissive policy while building a feature — an ordinary thing to
-- do — publishes those columns to anyone holding the key that ships inside the browser bundle. A
-- leak should need two mistakes, not one.
--
-- This is not a new pattern here: photos, active_sessions, profiles and schema_migrations already
-- have no grant to anon or authenticated at all (photos after 2,951 rows were found enumerable),
-- and everything is served through the service-role client after server-side access checks. This
-- brings the rest into line.
--
-- SAFETY: nothing in the browser reads any table directly. Every client component uses Supabase
-- for auth and for realtime Broadcast only — album live updates were deliberately moved OFF
-- postgres_changes precisely because that would have required client SELECT (see the comment in
-- app/[slug]/AlbumPageClient.tsx). Revoking a grant on a table that already returns nothing to anon
-- cannot change what anon receives; it only replaces an empty result with a refusal.
--
-- `authenticated` is deliberately LEFT ALONE. It is very likely unnecessary too — server components
-- reach these through service_role — but that is a claim this migration has not proved, and a
-- signed-in read breaking is not worth the tidiness. Worth revisiting with the same evidence.
--
-- Idempotent — safe to re-run.

revoke select on public.albums                from anon;
revoke select on public.collections           from anon;
revoke select on public.collection_albums     from anon;
revoke select on public.subscriptions         from anon;
revoke select on public.error_events          from anon;
revoke select on public.pending_stream_uploads from anon;
revoke select on public.poll_votes            from anon;
revoke select on public.rate_limit_events     from anon;
revoke select on public.studio_credits        from anon;
revoke select on public.studio_credit_ledger  from anon;
revoke select on public.studio_generations    from anon;
revoke select on public.system_state          from anon;

-- statements is published public content, and is read server-side like everything else. Revoked
-- for the same reason as the rest: nothing uses the grant, so it is only surface area.
revoke select on public.statements            from anon;
