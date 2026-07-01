-- AI Face Finder (AWS Rekognition): owner opt-in flag per album.
-- Studio tier is enforced in the API routes; this column lets a Studio owner toggle the
-- guest-facing "Find my photos" feature on/off. photos.face_ids already exists (schema_sync).
-- Idempotent: safe to re-run.

alter table public.albums
  add column if not exists face_finder_enabled boolean not null default false;
