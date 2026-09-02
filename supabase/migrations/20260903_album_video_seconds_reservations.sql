-- THE SEAT IS TAKEN WHEN WE SAY YES, NOT WHEN THE GUEST FINALLY SITS DOWN.
--
-- album_video_seconds counted only video that had FINISHED uploading. But the budget is checked when
-- an upload is APPROVED, and the photos row is written when it COMPLETES — minutes apart over venue
-- wifi. Everything that starts in between reads the same empty album.
--
-- No attacker required. Ten guests each start a ten-minute clip on an empty free album (600s):
-- all ten read "0 used", all ten are told yes, and the album ends with 6,000 seconds in it.
--
-- The deliberate version was cheaper still. Omitting durationSeconds was always approved and stored
-- NULL, which counted as zero, so roughly 67 requests carrying ZERO BYTES could reserve the whole
-- purchased Cloudflare Stream ceiling — and exhausting that ceiling does not cost more money, it
-- makes video upload fail for every album on the platform at once.
--
-- ── HOW THE HOLD IS RELEASED, which is the part that makes this safe ──────────────────────────
--
-- A held seat that is never released is its own outage: one abandoned upload would block an album's
-- video for as long as the hold lasts. Three things release it, in order of how often they fire:
--
--   1. THE UPLOAD COMPLETES. photos/create claims the token (consumed_at) and then writes the photo
--      row, so the reservation stops counting and the real duration starts. The claim happens BEFORE
--      the insert, so for a moment neither counts — which errs toward letting an upload through
--      rather than refusing one (rule 19).
--   2. THE HOLD TIMES OUT after 30 minutes. Chosen against the real numbers: a 200 MB video — the
--      largest a Pro album accepts — takes about 27 minutes on a 1 Mbps venue connection, so a
--      genuine upload has finished or nearly has. If one is still going, the hold simply stops
--      counting and the album is under-counted for the tail, which again errs toward letting
--      uploads through. Cloudflare's own upload expiry is 2 hours; using that here would mean one
--      abandoned reservation blocking a free album's video for two hours, which is worse than the
--      bug being fixed.
--   3. The pending row is pruned after 24 hours by cron/prune-data.
--
-- ── UNMEASURED VIDEO ──────────────────────────────────────────────────────────────────────────
--
-- About one video in six has no duration the browser can read, and those stored NULL and counted
-- zero. A hold of 60 seconds is taken for them instead: enough that the zero-byte trick above runs
-- out of budget after a handful of requests rather than never, and small enough that a guest posting
-- genuinely short clips is not refused. The real duration replaces it the moment the upload lands.
--
-- RESIDUAL, stated rather than implied: a reservation still buys more Cloudflare quota than it
-- charges the album (the quota reservation is ceil(duration x 1.5) + 60, and must stay that way —
-- clamping it is what makes a video die at 100% during processing). So this bounds the ALBUM
-- properly and only narrows the account-wide case. streamQuotaLevel still watches that ceiling.

create or replace function public.album_video_seconds(p_album_id uuid)
returns bigint
language sql
stable
as $$
  select coalesce((
      select sum(greatest(0, least(coalesce(duration_seconds, 0), 21600)))
      from public.photos
      where album_id = p_album_id
        and media_type = 'video'
    ), 0)
    + coalesce((
      select sum(greatest(0, least(coalesce(declared_duration_seconds, 60), 21600)))
      from public.pending_stream_uploads
      where album_id = p_album_id
        and consumed_at is null
        and created_at > now() - interval '30 minutes'
    ), 0)
$$;

revoke all on function public.album_video_seconds(uuid) from public;
revoke all on function public.album_video_seconds(uuid) from anon;
revoke all on function public.album_video_seconds(uuid) from authenticated;
grant execute on function public.album_video_seconds(uuid) to service_role;

-- The reservation half of the sum, as an index-only scan. album_id + consumed_at already had an
-- index; this adds created_at and the duration so the whole subquery is answered from the index, on
-- the hot path of every video upload.
create index if not exists pending_stream_uploads_album_hold_idx
  on public.pending_stream_uploads (album_id, created_at)
  include (declared_duration_seconds)
  where consumed_at is null;
