-- How far the header photo is zoomed in, as a percentage of "cover" size. 100 = the default
-- (fill the banner exactly, no zoom); 150 = 1.5x in, showing less of the photo but larger.
-- Null = 100, so every existing album renders exactly as before.
-- Pairs with header_focal, which decides WHICH part of the zoomed photo stays visible.
alter table public.albums add column if not exists header_zoom smallint;
