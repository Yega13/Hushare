-- Migration: photos.storage_path / url must be nullable.
--
-- Stream (video) rows have no storage_path or url — they use stream_uid. The live DB
-- wrongly had both columns NOT NULL, which 500'd every video save with
-- `null value in column "storage_path" violates not-null constraint`.
--
-- Per-backend integrity is already enforced by the check constraints added in
-- 20260630_schema_sync.sql (photos_r2_requires_storage_path requires storage_path for
-- r2 rows; photos_stream_requires_stream_uid requires stream_uid for stream rows), so
-- dropping NOT NULL here is safe.
--
-- Idempotent: `drop not null` on an already-nullable column is a no-op.

alter table public.photos alter column storage_path drop not null;
alter table public.photos alter column url          drop not null;
