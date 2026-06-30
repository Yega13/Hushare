-- Migration: stream_uid integrity
-- 1. Unique constraint prevents duplicate stream video rows under concurrent race
-- 2. pending_stream_uploads binds stream_uid → albumId at presign time,
--    preventing cross-album stream UID injection
-- (Made idempotent so the migration runner can re-apply it safely against any state.)

-- 1. Unique constraint on (album_id, stream_uid)
--    The photos/create upsert uses onConflict 'album_id,stream_uid'. NULL stream_uid
--    (R2 rows) is excluded from uniqueness by Postgres NULL semantics.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'photos_album_stream_uid_unique') then
    alter table public.photos
      add constraint photos_album_stream_uid_unique unique (album_id, stream_uid);
  end if;
end $$;

-- 2. Pending stream uploads table
--    /api/upload/stream inserts here immediately after Cloudflare returns the UID.
--    /api/album/photos/create verifies each stream_uid exists for this albumId,
--    then deletes the row (one-time use). Rows older than 24h are stale (abandoned upload).
create table if not exists public.pending_stream_uploads (
  stream_uid  text        primary key check (stream_uid ~ '^[a-f0-9]{32}$'),
  album_id    uuid        not null references public.albums(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists pending_stream_uploads_album_id_idx
  on public.pending_stream_uploads(album_id);

-- Index for cron cleanup of stale rows (older than 24h)
create index if not exists pending_stream_uploads_created_at_idx
  on public.pending_stream_uploads(created_at);

-- Deny all anon access; admin client (service role key) bypasses RLS
alter table public.pending_stream_uploads enable row level security;
