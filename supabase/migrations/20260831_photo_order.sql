-- Which end of the album a visitor sees first — and the reason it is not cosmetic.
--
-- The album page loads a WINDOW of 500 photos and refreshes that same window on every realtime
-- ping. The order was fixed oldest-first, so the window was the 500 OLDEST photos: on any album
-- past 500 a new upload sorted to position 4,567 and the live refresh reloaded a slice that could
-- not, by construction, ever contain it.
--
-- Measured against the real table during a 4,567-photo race: a guest saw photos from a 21-minute
-- slice at the very start of the day, and nothing newer, for the entire event. The realtime
-- machinery was working perfectly and refreshing a window where nothing ever changed.
--
-- 'manual' is set by the reorder route rather than chosen from a menu — an album becomes manual
-- by being dragged into an order.

alter table albums add column if not exists photo_order text not null default 'newest';

alter table albums drop constraint if exists albums_photo_order_check;
alter table albums add constraint albums_photo_order_check
  check (photo_order in ('newest', 'oldest', 'manual'));

-- BACKFILL PRESERVES WHAT EACH ALBUM ALREADY SHOWS. An album someone hand-arranged keeps that
-- arrangement; every other existing album keeps oldest-first, which is exactly what it renders
-- today. Only albums created from here on take the new default, so no customer's album was
-- rearranged under them by this change (10 manual, 87 oldest at the time of writing).
update albums set photo_order = 'manual'
  where id in (select album_id from photos where sort_order is not null group by album_id);

update albums set photo_order = 'oldest' where photo_order = 'newest';
