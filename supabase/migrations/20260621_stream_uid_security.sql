-- Migration: stream_uid integrity
-- 1. Unique constraint prevents duplicate stream video rows under concurrent race
-- 2. pending_stream_uploads binds stream_uid → albumId at presign time,
--    preventing cross-album stream UID injection

-- 1. Unique constraint on (album_id, stream_uid)
--    After this, stream rows can use upsert + ignoreDuplicates just like R2 rows.
--    NULL stream_uid (R2 rows) is excluded from uniqueness by Postgres NULL semantics.
ALTER TABLE public.photos
  ADD CONSTRAINT photos_album_stream_uid_unique
  UNIQUE (album_id, stream_uid);

-- 2. Pending stream uploads table
--    /api/upload/stream inserts here immediately after Cloudflare returns the UID.
--    /api/album/photos/create verifies each stream_uid exists for this albumId,
--    then deletes the row (one-time use). Rows older than 24h are stale (abandoned upload).
CREATE TABLE public.pending_stream_uploads (
  stream_uid  text        PRIMARY KEY CHECK (stream_uid ~ '^[a-f0-9]{32}$'),
  album_id    uuid        NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pending_stream_uploads_album_id_idx
  ON public.pending_stream_uploads(album_id);

-- Index for cron cleanup of stale rows (older than 24h)
CREATE INDEX pending_stream_uploads_created_at_idx
  ON public.pending_stream_uploads(created_at);

-- Deny all anon access; admin client (service role key) bypasses RLS
ALTER TABLE public.pending_stream_uploads ENABLE ROW LEVEL SECURITY;
