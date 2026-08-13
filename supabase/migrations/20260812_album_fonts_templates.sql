-- Album custom "looks": a selectable title font and a one-tap template preset.
-- title_font: key into ALBUM_FONTS (src/lib/album-design.ts); null = the default classic serif.
-- template:   key into ALBUM_TEMPLATES; a label of the last applied preset (the actual accent/font/
--             layout live in their own columns — this just records which look was applied).
alter table public.albums add column if not exists title_font text;
alter table public.albums add column if not exists template   text;
