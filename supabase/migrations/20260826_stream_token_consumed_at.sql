-- Mark a video-upload token as CONSUMED instead of deleting it.
--
-- THE FAILURE THIS FIXES. api/album/photos/create consumes the token and then inserts the photo
-- rows, in that order, with no transaction between them. If the connection dies in the gap — venue
-- wifi, which is exactly where this runs — the client retries the save, the dedup pre-check finds
-- no photos row so the uid is still in the batch, and the token is gone. The video is refused.
--
-- The bytes are already in Cloudflare Stream, complete and paid for. Today the guest is told to
-- press Retry, and Retry starts a whole new upload session: a clip that just took twenty minutes
-- to send over a bad connection has to go again, over the same bad connection.
--
-- A row that RECORDS being consumed can tell the two cases apart, which a deleted row cannot:
--   * no row at all            -> this uid was never issued for this album. Refuse. (Cross-album
--                                 stream-uid injection is what the check exists for.)
--   * row with consumed_at set -> we issued it for this album and it was already claimed. A retry.
--                                 Let the insert proceed; unique(album_id, stream_uid) makes it
--                                 idempotent, so a replay can only ever produce the one row.
--
-- The claim itself stays atomic: UPDATE ... WHERE consumed_at IS NULL RETURNING, which is the same
-- single-statement guarantee the DELETE ... RETURNING gave. Do NOT "fix" this by reordering the
-- insert before the consume — that reopens the check-then-act race the atomic claim closes, and it
-- is called out as conflict #1 in the 2026-08-20 architecture audit.
--
-- Rows are removed on the daily pass in api/cron/prune-data (24h by created_at, regardless of
-- consumed_at), so consumed rows do not accumulate and a token still cannot be replayed forever.
--
-- Idempotent — safe to re-run.

alter table public.pending_stream_uploads add column if not exists consumed_at timestamptz;

comment on column public.pending_stream_uploads.consumed_at is
  'When api/album/photos/create claimed this token. NULL = unclaimed. A claimed row is kept (not deleted) so a retried save can be recognised as a retry rather than as an injection attempt.';

-- The claim query filters on (stream_uid, album_id, consumed_at). stream_uid is already unique, so
-- this only helps the "already consumed for this album" lookup, which is the retry path — the one
-- that runs when something has already gone wrong and nobody wants to wait.
create index if not exists pending_stream_uploads_album_consumed_idx
  on public.pending_stream_uploads (album_id, consumed_at);
