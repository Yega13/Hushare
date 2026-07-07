-- Store intrinsic media dimensions (pixels) captured at upload time so aspect ratio is known
-- instantly everywhere (grid + lightbox) without loading a poster to measure it. This removes
-- the poster-load race that caused occasional black bars on videos. Nullable: legacy rows and
-- any capture failure simply fall back to poster-based detection / defaults. Idempotent.

alter table public.photos
  add column if not exists width int,
  add column if not exists height int;
