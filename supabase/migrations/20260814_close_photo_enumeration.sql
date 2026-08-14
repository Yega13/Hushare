-- SECURITY FIX: anonymous users could enumerate almost every photo on the platform.
--
-- The policy "photos readable when album is open" granted anon SELECT on photos whenever
-- album_is_open(album_id) held. That check answers "is this album ungated?" but says nothing about
-- whether the caller knows WHICH album they are asking for — and PostgREST is happy to serve an
-- unfiltered SELECT. So an unauthenticated request with the public anon key (which ships inside the
-- page source of every visit) returned:
--
--     GET /rest/v1/photos?select=album_id,url   ->  2951 of 3021 rows, with working media URLs
--
-- Albums are unlisted and their entire security model is "only someone with the link can see it".
-- This bypassed that completely: no slug required, every customer's photos in one request.
--
-- Why simply dropping the policy is safe now:
--   * Every server-side read of `photos` uses the service-role client, which bypasses RLS.
--     The album page is server-rendered through fetchAuthorizedPhotos() AFTER it verifies owner
--     cookie / password / reveal gating, so guests keep seeing exactly what they should.
--   * The one client-side dependency was Supabase Realtime postgres_changes for photo DELETE and
--     UPDATE, which is only delivered to clients that can SELECT the table under RLS. Those
--     listeners are gone; photo delete, bulk-delete, reorder and settings now emit the same
--     contentless `changed` broadcast that uploads already used, and viewers debounce-refetch
--     through the authorized server route. Broadcast carries no row data and needs no table grant.
--
-- The INSERT/UPDATE/DELETE grants are revoked as well: writes have always gone through server
-- routes that check ownership, so anon never needed them either.
--
-- If per-row realtime is ever wanted back, it needs Realtime Authorization with private channels --
-- NOT a table-wide SELECT policy.

drop policy if exists "photos readable when album is open" on photos;

revoke all on table photos from anon, authenticated;
