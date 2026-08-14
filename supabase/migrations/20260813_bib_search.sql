-- Bib search (race albums). Two pieces:
--
-- albums.bib_search_enabled — the owner's "this is a race" switch. OFF by default, so no album
--   ever sends photos for OCR unless its owner asked for it. This is what keeps third-party image
--   processing opt-in (see the privacy policy's processor list) and keeps wedding/party albums —
--   where bib numbers don't exist — from paying for OCR they can't use.
--
-- photos.bib_numbers — the numbers read off each photo. NULL means "not looked at yet"; an empty
--   array means "looked at, found none", which is a real answer and must be distinguishable from
--   NULL so a sweep doesn't re-OCR (and re-bill) the same photo forever.
alter table public.albums add column if not exists bib_search_enabled boolean not null default false;
alter table public.photos add column if not exists bib_numbers text[];

-- Guests search by typing a number; this index makes "which photos contain 00945" fast even on a
-- large race album, instead of scanning every row.
create index if not exists photos_bib_numbers_idx on public.photos using gin (bib_numbers);
