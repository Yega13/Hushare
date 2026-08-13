-- Grandfather every album that already existed when auto-suggestion shipped: mark them as
-- "header already decided" so resolveAlbum's auto-suggest logic never retroactively changes the
-- look of an album an owner is already living with. Only albums created AFTER this point (which
-- get header_touched = false from the column default) are eligible for auto-suggestion.
-- Idempotent: re-running only ever sets already-true rows to true again.
update public.albums set header_touched = true where header_touched = false;
