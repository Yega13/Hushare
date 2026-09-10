-- The numbers an owner has said are not runners.
--
-- 20260814_bib_range.sql added bib_min/bib_max for this problem and they only reach half of it. A
-- range separates junk that sits OUTSIDE the race's numbering; it cannot touch junk that sits
-- inside. On the measured album the arch year 2026 is inside the declared 1-3000 range and inside
-- the album's own 2xxx bib series, so no bound can remove it without removing runners with it.
--
-- The line rule in lib/bib-filter now refuses any number sharing its OCR line, which removes the
-- billboard phone numbers and the dated banners -- 96.3% of the noise, measured. What survives is a
-- number printed ALONE, and a year on a finish arch is typographically identical to a bib on a
-- chest. About 75 photographs of that album still answer to 2026.
--
-- AND FREQUENCY CANNOT DECIDE IT, which the range migration already recorded and a later
-- measurement confirmed: on a 69-photo album the banner year and the real bib 00663 each appeared
-- on exactly 4 photos. A runner appears on 1-4 photographs whatever the album size, while any
-- album-relative threshold scales with the album, so a floor safe on 4,566 photos sits below the
-- entire real-bib population on 69. Frequency is allowed to NOMINATE a list; a person confirms it.
--
-- APPLIED AT SEARCH TIME, like the range and for the same reason: correcting the list re-filters
-- every photograph at once, with no re-OCR and no AWS bill, and with no window in which the album
-- answers "no photos with that number" while it rebuilds. It therefore works on rows indexed long
-- before any of this shipped.
--
-- Stored as the CANONICAL numeric form (see lib/bib-exclusions numericKey): '2026', never '02026'.
-- The same runner is 00945 on one photograph and 945 on another, and bibMatches compares by value,
-- so the list has to as well or half the stored spellings escape it.
--
-- Idempotent -- safe to re-run.

alter table albums add column if not exists bib_excluded_numbers text[] not null default '{}';

comment on column albums.bib_excluded_numbers is
  'Numbers the album owner marked as signage rather than runners. Canonical numeric form, no '
  'leading zeros. Applied at SEARCH time in lib/bib-match, never at indexing, so editing the list '
  'takes effect immediately and costs no re-OCR. See lib/bib-exclusions.';

-- Bounded in the database as well as in normalizeExclusions, because the column is written by a
-- route and a route can be called by anything holding an owner link. 200 is far past any real
-- race's signage and far short of a payload worth worrying about.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'albums_bib_excluded_numbers_bounded'
  ) then
    alter table albums add constraint albums_bib_excluded_numbers_bounded
      check (array_length(bib_excluded_numbers, 1) is null or array_length(bib_excluded_numbers, 1) <= 200);
  end if;
end $$;
