-- THE ALBUM'S VIDEO MINUTES, SUMMED WHERE THE ROWS ARE.
--
-- Replaces a query that read up to 1,000 duration rows into the Worker and added them up there:
--
--   select duration_seconds from photos where album_id = $1 and media_type = 'video' limit 1000
--
-- Three problems, all silent.
--
-- 1. THE LIMIT TRUNCATES ON EXACTLY THE ALBUMS THAT MATTER. A free album's item cap (see
--    FREE_ALBUM_MEDIA in src/lib/media.ts) sits below a thousand so it can never exceed it, but the
--    Pro and Max caps are well above it. Past a thousand video rows the
--    sum is drawn from a subset and reads LOW — so the budget stops binding on the largest albums,
--    which are the paid ones, and nothing anywhere reports it. (Measured 2026-09-02: the biggest
--    album alive has 26 video rows, so this has never yet bitten anyone. It is closed because the
--    failure is invisible when it does, not because it is happening.)
--
-- 2. THERE WAS NO ORDER BY, so WHICH thousand rows came back was whatever Postgres found cheapest.
--    Same defect as the error-alert cron's sample, which was fixed for the same reason.
--
-- 3. It shipped up to a thousand rows across the network on the hot path of every single video
--    upload, to produce one number.
--
-- All three go away by asking the database for the number instead of for the rows.
--
-- THE CLAMP IS PART OF THE SUM, not a step after it. One row of -2000000000 read as zero used
-- through a total-only clamp and disabled an album's video budget permanently; the mirror image with
-- 2147483647 did the same upward while hidden under require_approval. Both are fixed in TypeScript
-- by sumVideoSeconds, which clamps every row, and the same clamp has to hold here or moving the sum
-- into SQL would reopen the hole it closed. photos_duration_seconds_sane bounds new rows already,
-- but it was added NOT VALID, so rows written before it are unchecked and this is what covers them.
--
-- 21600 is six hours and MUST equal MAX_STORED_DURATION_SECONDS in src/lib/album-entitlements.ts.
-- SQL cannot import a TypeScript constant, so tests/album-video-seconds.test.ts reads THIS FILE and
-- asserts the two agree — the escape hatch rule 13 allows when a value genuinely cannot be shared.

create or replace function public.album_video_seconds(p_album_id uuid)
returns bigint
language sql
stable
as $$
  select coalesce(sum(greatest(0, least(coalesce(duration_seconds, 0), 21600))), 0)::bigint
  from public.photos
  where album_id = p_album_id
    and media_type = 'video'
$$;

-- NOT CALLABLE BY A GUEST. Postgres grants EXECUTE on a new function to PUBLIC by default, and
-- PostgREST exposes anything in the public schema — so without this, anyone holding the anon key
-- could ask how much video any album id holds. Only the service role, which is what the upload
-- authorization runs as, may call it.
revoke all on function public.album_video_seconds(uuid) from public;
revoke all on function public.album_video_seconds(uuid) from anon;
revoke all on function public.album_video_seconds(uuid) from authenticated;
grant execute on function public.album_video_seconds(uuid) to service_role;

-- An index-only scan for the sum. Videos are a small fraction of the table (26 of 19,109 rows on the
-- largest album as of 2026-09-02), so the partial index is tiny, and this runs on the hot path of
-- every video upload — before the guest sees anything happen.
create index if not exists photos_album_video_duration_idx
  on public.photos (album_id) include (duration_seconds)
  where media_type = 'video';
