-- THE DURATION WE CHECKED MUST BE THE DURATION WE CHARGE.
--
-- The client declared a video's length TWICE, in two separate requests, and nothing reconciled
-- them:
--
--   /api/upload/stream        {"durationSeconds": 1}   -> checked against the album's minute pool
--   /api/album/photos/create  {"duration_seconds": 1}  -> written to the row the pool is summed from
--
-- Two independent claims, and the second one is what the album is billed for. Cloudflare's own
-- ceiling is the reservation, which is ceil(claim * 1.5) + 60 — so declaring one second buys a
-- 62-second reservation, and a real 62-second video uploads and processes fine while the album's
-- total goes up by one. A 62:1 ratio, repeatable to the album's item cap, against a PURCHASED
-- 1,000-minute Stream ceiling whose exhaustion makes video fail for every album on the platform.
--
-- Nothing corrects it afterwards either: /api/album/video-status can write the true duration, but
-- its only caller is the lightbox, firing when somebody OPENS a video. At an event, with guests
-- uploading in sequence and nobody opening anything, no correction ever runs.
--
-- The fix is to stop asking twice. /api/upload/stream already inserts this row at the moment it
-- decides the upload is allowed; it now records the number it decided ON, and photos/create charges
-- THAT rather than believing a second, unrelated claim. The checked number and the charged number
-- become the same number by construction, which is the only version of this that cannot drift.
--
-- NULL is a real and expected value: roughly 16% of real videos have no duration the browser can
-- measure (a failed poster decode), and those must keep uploading. A null here means "the client
-- could not measure it", exactly as it does today, and is handled the same way — counted as zero
-- against the budget, bounded server-side by FALLBACK_MAX_DURATION at Cloudflare.

alter table public.pending_stream_uploads
  add column if not exists declared_duration_seconds integer;

-- Non-negative, or absent. A negative duration is not a small error to tolerate — one negative row
-- summed into an album's total read as zero through the old total-only clamp and disabled that
-- album's video budget permanently. The application clamps on both the write and the read now; this
-- is the last line, in the one place a value cannot get past.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pending_stream_uploads_declared_duration_nonneg'
      and conrelid = 'public.pending_stream_uploads'::regclass
  ) then
    alter table public.pending_stream_uploads
      add constraint pending_stream_uploads_declared_duration_nonneg
      check (declared_duration_seconds is null or declared_duration_seconds >= 0);
  end if;
end $$;
