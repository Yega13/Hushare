-- Softer default corner radius: 12 -> 16. Applies to new albums (column default) and to existing
-- albums still sitting on the old default of 12; any custom radius an owner chose is preserved.
-- Idempotent.

alter table public.albums alter column media_radius set default 16;
update public.albums set media_radius = 16 where media_radius = 12;
