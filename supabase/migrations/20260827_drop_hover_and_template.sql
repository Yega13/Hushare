-- Drop two album settings that nobody has ever used, because nobody ever could.
--
-- Measured across all 84 live albums on 2026-08-26: media_hover set on 0, template set on 0.
--
-- media_hover was worse than unused — it was UNREACHABLE. It had a column, a validator, an API
-- field, a type and state in the owner toolbar, and it was threaded through every media-settings
-- save. But no control ever rendered it and no photo ever read it. There was no way for an owner to
-- set it and nothing would have happened if they had. Roughly 90 lines across 8 files existing to
-- carry a value from nowhere to nowhere.
--
-- template stored the key of a one-tap preset (wedding / race / party / corporate / minimal). The
-- preset itself worked — it wrote accent_color, title_font and photo_layout — but the stored key was
-- never read back by anything, and in 84 albums nobody applied one. Removed on the owner's call.
--
-- NOT removed, and the distinction matters: photo_style (Standard / Edge / Rounded / Framed) is a
-- separate feature that IS wired to rendering and is used by 3 albums. It sits next to the template
-- code and was briefly deleted by accident while writing this; it is back.
--
-- Also worth recording, because it corrects a wrong reading of the same data: guest downloads and
-- guest uploads showed "0 albums" too, but that means 0 albums turned them OFF — every album has
-- them on. The switches are unused; the features are universal. Those stay.
--
-- Idempotent — safe to re-run.

alter table public.albums drop column if exists media_hover;
alter table public.albums drop column if exists template;
