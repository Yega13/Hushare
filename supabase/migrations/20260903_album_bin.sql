-- THE BIN. A deleted album is hidden for seven days before anything is destroyed.
--
-- Deleting an album used to be immediate and total: the R2 objects, the Stream videos and the row,
-- gone in one request, with no backup anywhere. Anyone holding the owner link could do it — and for
-- an album created without an account the owner link is the only proof of ownership, so that
-- includes everyone it was ever shared with. There was no undo, and the thing destroyed is
-- somebody's wedding.
--
-- deleted_at records WHY and WHEN. The hiding is done by retired_at, which the delete path sets at
-- the same time: 86 places in this codebase read the albums table, the guest resolver and every
-- owner mutation ALREADY filter retired_at at SQL level, and adding a second filter to 86 call
-- sites is exactly how one gets missed — a miss meaning an album the owner believes is deleted is
-- still being served.
--
-- Nothing here deletes anything. The purge is a separate, dated pass in cron/retire-albums, and
-- lib/album-bin decides what is eligible — erring, in every branch, toward keeping the data.

alter table public.albums add column if not exists deleted_at timestamptz;

comment on column public.albums.deleted_at is
  'When the owner deleted this album. The album is hidden immediately (retired_at is set with it) '
  'and its files are destroyed by cron/retire-albums after the bin window in lib/album-bin. '
  'NULL means the album was never deleted. Clearing it AND retired_at restores the album.';

-- The purge pass asks one question: which binned albums are past the window, oldest first. A
-- partial index keeps that free — the overwhelming majority of albums are not in the bin and never
-- enter this index at all.
create index if not exists albums_deleted_at_idx
  on public.albums (deleted_at)
  where deleted_at is not null;
