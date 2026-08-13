-- Custom header/hero photo — an arbitrary uploaded image (not necessarily one of the album's own
-- photos) shown behind the album title, in the same slot as cover_photo_id but sourced from a
-- direct R2 upload rather than the photos table. Mutually exclusive with cover_photo_id: setting
-- one clears the other (enforced in /api/album/header-image and /api/album/cover).
alter table public.albums add column if not exists header_image text;
