-- SECURITY FIX: two tables had row level security switched off while still carrying the blanket
-- grants Supabase hands to anon/authenticated. The anon key ships inside every browser bundle, so
-- "granted to anon" means "published to the internet".
--
-- active_sessions was the serious one. It stores the PATH each live visitor is viewing, so a plain
-- GET with the public key returned a live feed of album slugs:
--     [{"id":"...","last_seen":"...","path":"/1daw2eeg"}, ...]
-- An album's slug IS its access credential — albums are unlisted and "only reachable by someone who
-- has the link" — so this handed out working URLs to private albums as they were being viewed, and
-- flatly contradicted the privacy policy. The write grants also let anyone delete or forge presence
-- rows, which are what the admin dashboard's live-user count is built from.
--
-- schema_migrations leaked the migration history and, worse, allowed DELETE/TRUNCATE: emptying it
-- would make the migration runner believe nothing had ever been applied.
--
-- Both tables are only ever touched by server routes using the service-role client, and service_role
-- bypasses RLS entirely. So enabling RLS with NO policies is exactly right: default-deny for
-- everyone else, no application change needed. Verified: src/app/api/presence/route.ts and
-- src/app/api/admin/presence/route.ts are the only readers/writers.
--
-- The grants are revoked as well, so the tables stay closed even if a policy is ever added
-- carelessly later. Defence in depth: RLS and the grant must BOTH allow access.

alter table active_sessions enable row level security;
alter table schema_migrations enable row level security;

revoke all on table active_sessions from anon, authenticated;
revoke all on table schema_migrations from anon, authenticated;
