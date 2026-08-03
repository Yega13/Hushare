-- Guest photo moderation.
--   photos.hidden        — a hidden photo is not shown to guests (owner still sees it).
--   albums.require_approval — when true, GUEST uploads land hidden (pending) until the owner approves.
-- Both default to the current behaviour (nothing hidden, no approval required), so existing albums
-- are unaffected. Run in the Supabase SQL editor.

alter table public.photos  add column if not exists hidden boolean not null default false;
alter table public.albums  add column if not exists require_approval boolean not null default false;

-- Speeds up the guest read (album_id + hidden=false).
create index if not exists photos_album_visible_idx on public.photos (album_id) where hidden = false;
