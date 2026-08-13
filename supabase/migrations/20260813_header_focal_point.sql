-- Where the header photo/video is anchored within the hero band's crop, as a CSS
-- background-position value ("X% Y%"). Null = center (the existing default crop behaviour is
-- unchanged for every album that never touches this).
alter table public.albums add column if not exists header_focal text;
