-- Per-album media-cap override for partner / event albums (e.g. a festival album set to 30000).
-- NULL (the default) = use the normal per-tier cap. When set, it supersedes tier + grandfather
-- logic and is hard-ceiled server-side (MAX_MEDIA_CAP_OVERRIDE) in
-- src/app/api/album/photos/create/route.ts, so a typo can never create a runaway-cost album.
-- Idempotent — safe to re-run.

alter table public.albums add column if not exists media_cap_override integer;
