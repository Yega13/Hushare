-- Distinguishes "owner never touched the header controls" from "owner explicitly chose no header
-- photo" — both look identical as cover_photo_id/header_image being null, but only the FIRST case
-- should ever be eligible for auto-suggesting a header photo. Set true the moment an owner makes
-- any explicit header choice (see setAlbumHeader in src/lib/server/album-header.ts); never touched
-- by the auto-suggestion path itself, so a later manual "None" correctly sticks forever after.
alter table public.albums add column if not exists header_touched boolean not null default false;
