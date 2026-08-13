-- Album "photo style" — how the photo tiles present: edge (edge-to-edge), rounded, or framed (light
-- white matte). null = the default look (per-album media_radius). Set from the Album Designer.
alter table public.albums add column if not exists photo_style text;
