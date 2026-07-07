-- Owner-selectable photo layout for the album grid:
--   'grid'      = square-cropped tiles (default, current behaviour)
--   'justified' = rows of true-aspect-ratio media (Google Photos / Flickr style), using the
--                 width/height captured at upload.
-- Idempotent.

alter table public.albums
  add column if not exists photo_layout text not null default 'grid';

alter table public.albums drop constraint if exists albums_photo_layout_check;
alter table public.albums add constraint albums_photo_layout_check
  check (photo_layout in ('grid', 'justified'));
