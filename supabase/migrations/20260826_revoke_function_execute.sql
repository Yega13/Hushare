-- Revoke EXECUTE on the two SECURITY DEFINER functions still callable with the public anon key.
--
-- batch_set_sort_order IS AN UNAUTHENTICATED WRITE, and it is live. SECURITY DEFINER, so it
-- bypasses RLS entirely; it takes an album id and a list of photo ids and rewrites sort_order on
-- them. Verified on 2026-08-26 by invoking it through PostgREST with the publishable key that ships
-- in every page of the site: HTTP 204, executed. (Proved with a nonexistent album id and empty
-- arrays, so nothing was modified.)
--
-- Photo ids are in the markup of any open album, so a stranger could scramble the running order of
-- a paying customer's wedding album with one request and no credentials. It is vandalism rather
-- than data loss — only sort_order is touched — but it is a write nobody authorised.
--
-- The application calls this through the SERVICE-ROLE client (api/album/photos/reorder), which
-- bypasses grants completely, so revoking changes nothing about how the product works.
--
-- This is the same finding as the 2026-08-20 audit's E5, which revoked prune_rate_limit_events and
-- prune_error_events and missed these two. Functions get missed one at a time; the check in
-- scripts/check-db.mjs now asserts the whole set instead.
revoke execute on function public.batch_set_sort_order(uuid, uuid[], integer[]) from anon, authenticated;

-- album_is_open is read-only, but it is a SECURITY DEFINER oracle: given an album's UUID it says
-- whether that album exists, is not retired, and has no password. It was written to back an RLS
-- policy on `photos` that was deliberately REMOVED (see the note in scripts/check-db.mjs — that
-- policy let anyone holding the anon key enumerate every photo on the platform). Nothing references
-- it now: no policy, no other function, no application code.
--
-- Left in place rather than dropped, because dropping a function that a future policy might want is
-- a harder thing to undo than a grant. Unreachable is enough.
revoke execute on function public.album_is_open(uuid) from anon, authenticated;
