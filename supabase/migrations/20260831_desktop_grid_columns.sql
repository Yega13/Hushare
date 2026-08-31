-- Per-device grid: the album's column count on a wide screen, separate from the phone's.
--
-- mobile_grid_columns was applied at EVERY width — one number for both devices. An owner who
-- picked 5 because it looks right on their laptop gave every phone visitor five thumbnails
-- across a 390px screen (about 70px each, with gaps), and an owner who picked 3 for phones got
-- three enormous tiles on a desktop. The two screens want different answers.
--
-- NULL means "not chosen" and the app substitutes a width-derived default, so every existing
-- album renders exactly as it does today until its owner picks a number.
alter table albums add column if not exists desktop_grid_columns smallint;

alter table albums drop constraint if exists albums_desktop_grid_columns_check;
alter table albums add constraint albums_desktop_grid_columns_check
  check (desktop_grid_columns is null or desktop_grid_columns between 2 and 8);

-- Two photos across is now an option on phones. This is what an owner actually wants for an
-- event album viewed one-handed: a bib number or a face is readable at 2 across on a 390px
-- screen and is not at 5. Permissive widening — every value already stored (3-6) stays valid.
alter table albums drop constraint if exists albums_mobile_grid_columns_check;
alter table albums add constraint albums_mobile_grid_columns_check
  check (mobile_grid_columns = any (array[2, 3, 4, 5, 6]));
