-- BOOKING THE SEAT AND CHECKING THE SEAT ARE NOW ONE STEP.
--
-- The previous migration made a video hold its seat from the moment we say yes, which closed the
-- big window: the budget used to be read at approval and written at completion, minutes apart, so
-- ten guests each starting a ten-minute clip on an empty free album all read "0 used" and all
-- passed.
--
-- What it did NOT close is the small one. api/upload/stream reads the budget, then calls Cloudflare
-- to create the upload, then writes the hold — so two requests a few hundred milliseconds apart can
-- still both read an empty album before either has booked. Minutes became milliseconds, and
-- milliseconds is not zero: a QR code on a table gets scanned by a whole group at once.
--
-- ── HOW THIS IS ATOMIC ────────────────────────────────────────────────────────────────────────
--
-- An advisory lock keyed on the album serialises reservations for THAT album and nothing else. The
-- second request waits until the first has booked, then reads a total that already includes it.
--
-- pg_advisory_xact_lock, not `select ... for update` on albums: an album row lock would also make
-- an ordinary settings save contend with uploads, which is a cost with no benefit. The advisory
-- lock is released when the transaction ends, including on error, and PostgREST gives every RPC its
-- own transaction. A hash collision between two album ids costs one brief wait and nothing else.
--
-- ── WHY IT INSERTS FIRST AND ASKS AFTERWARDS ──────────────────────────────────────────────────
--
-- The obvious shape is "work out what this clip costs, add it to the total, compare". That would
-- retype the row clamp and the 60-second provisional for unmeasured video that album_video_seconds
-- already owns — two copies of the same arithmetic, which is exactly what rule 13 forbids and how
-- the two halves of a limit drift apart.
--
-- So the hold is written and then the SAME function is asked what the album now holds. If that is
-- over budget, the hold is removed and the answer is no. One definition of what a clip costs, used
-- by both the counting and the deciding.
--
-- ── WHICH WAY IT ERRS ─────────────────────────────────────────────────────────────────────────
--
-- Open. If album_video_seconds cannot answer, the booking still succeeds: refusing every guest at a
-- live event because one query failed is far worse than letting a few extra minutes through, and it
-- matches what the caller already does with an unreadable total (rule 19). The caller reports that
-- case to the admin panel; this function does not decide policy about it.
--
-- Boundary matches lib/album-entitlements' videoBudgetExceeded: allowed while the album's total
-- stays at or under the cap. Unmeasured clips are treated slightly more strictly here than in that
-- TypeScript pre-check, which counts them as zero — 60 seconds is the whole point of the previous
-- migration, and the zero-byte trick is what it closes.

create or replace function public.reserve_album_video(
  p_stream_uid text,
  p_album_id uuid,
  p_declared integer,
  p_budget_seconds bigint,
  p_upload_url text default null
) returns boolean
language plpgsql
as $$
declare
  v_total bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_album_id::text, 0));

  insert into public.pending_stream_uploads
    (stream_uid, album_id, declared_duration_seconds, upload_url)
  values (p_stream_uid, p_album_id, p_declared, p_upload_url);

  v_total := public.album_video_seconds(p_album_id);

  if v_total is null then
    -- Cannot tell. Keep the hold and allow it: silence beats refusing a real guest.
    return true;
  end if;

  if v_total > p_budget_seconds then
    delete from public.pending_stream_uploads where stream_uid = p_stream_uid;
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.reserve_album_video(text, uuid, integer, bigint, text) from public;
revoke all on function public.reserve_album_video(text, uuid, integer, bigint, text) from anon;
revoke all on function public.reserve_album_video(text, uuid, integer, bigint, text) from authenticated;
grant execute on function public.reserve_album_video(text, uuid, integer, bigint, text) to service_role;
