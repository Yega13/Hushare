-- A DURATION THE DATABASE ITSELF WILL NOT ACCEPT.
--
-- The previous migration put a CHECK on pending_stream_uploads.declared_duration_seconds — the
-- column the application already clamps hard, written only by our own server. It put none on
-- photos.duration_seconds, which is the column a GUEST can write and the one the video budget is
-- summed from. The guard went on the safe column and not the dangerous one.
--
-- What that cost, with two requests and no video uploaded at all:
--
--   POST /api/upload/stream        durationSeconds omitted   -> approved, nothing stored
--   POST /api/album/photos/create  duration_seconds: 2147483647
--
-- validatePhoto bounds this value below but not above, and int4 holds 2147483647 exactly, so the
-- row stored. The album's video total then exceeded every budget forever: each later video upload
-- was refused with "delete a video to make room", and on an album with require_approval the poison
-- row is inserted HIDDEN — so the owner could not even see the video they were being told to
-- delete. Permanent, silent, and free.
--
-- The application no longer writes a client-supplied duration at all. This is the line that holds
-- when something else does: a bulk import, a script, a future route, or a bug.
--
-- 21600 SECONDS = 6 HOURS, which is CF_MAX_DURATION_CEILING in lib/stream-duration — Cloudflare's
-- own absolute maximum for a single video. Nothing longer can exist in Stream, so nothing longer
-- can be a real duration. NULL stays allowed: ~16% of videos have no duration the browser could
-- measure, and that is a real state, counted as zero until video-status reads the truth from
-- Cloudflare.
--
-- NOT VALID first, deliberately. It applies to every new and updated row immediately while leaving
-- existing rows unscanned, so this cannot fail the deploy on data already in the table — and any
-- row already out of bounds is a row the running product is mis-accounting, which is worth knowing
-- about rather than worth blocking a deploy over. Validate it by hand once the table is known
-- clean:  alter table public.photos validate constraint photos_duration_seconds_sane;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'photos_duration_seconds_sane'
      and conrelid = 'public.photos'::regclass
  ) then
    alter table public.photos
      add constraint photos_duration_seconds_sane
      check (duration_seconds is null or (duration_seconds >= 0 and duration_seconds <= 21600))
      not valid;
  end if;
end $$;
