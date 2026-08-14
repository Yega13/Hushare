-- Bib number range for a race album.
--
-- OCR reads every number it can see, not just the ones pinned to runners: a sponsor banner with the
-- year on it, a lap counter, a fragment of a shirt logo. On a real indexed race album the genuine
-- bibs all fell between 301 and 993, while the junk was 2026, 115, 14 and 2 — outside on both sides.
-- The range is what separates them.
--
-- Frequency does NOT separate them, which is worth recording so nobody tries it again: in that same
-- album the real bib 00663 appeared on exactly 4 photos and the banner year 2026 also appeared on
-- exactly 4. A "seen too often" rule deletes real runners.
--
-- Deliberately NOT applied at indexing time. Filtering happens when a guest searches, so an owner
-- who mistypes the range or gets it from the organiser late can correct it and have every photo
-- re-filtered instantly, with no re-OCR and no new AWS bill. The detections stay raw on the row.
alter table albums add column if not exists bib_min integer;
alter table albums add column if not exists bib_max integer;

-- Positive, and ordered. NULL means "no limit on this end", so an owner can set only a maximum
-- (the common case: "we handed out numbers up to 500").
alter table albums drop constraint if exists albums_bib_range_valid;
alter table albums add constraint albums_bib_range_valid check (
  (bib_min is null or bib_min > 0)
  and (bib_max is null or bib_max > 0)
  and (bib_min is null or bib_max is null or bib_min <= bib_max)
);

comment on column albums.bib_min is 'Lowest valid bib number for this race; NULL = no lower bound. Applied at search time, not indexing time.';
comment on column albums.bib_max is 'Highest valid bib number for this race; NULL = no upper bound. Applied at search time, not indexing time.';
