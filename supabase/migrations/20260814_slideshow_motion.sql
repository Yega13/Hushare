-- Slideshow transitions become composable instead of a fixed preset list.
--
-- slideshow_animation was four hardcoded names (none/fade/rise/zoom), which meant every Hushare
-- slideshow on earth moved in one of four identical ways. This replaces the choice with axes —
-- what moves, which way it comes from, how far, how soft, how long, on what curve — so an owner
-- composes a transition rather than picking someone else's.
--
-- Stored as one jsonb blob rather than six columns: it is a single UI concept, always read and
-- written together, and never queried by field. NULL means "this album has never been touched", and
-- the app derives the motion from the legacy slideshow_animation value instead — so every existing
-- album keeps exactly the transition it has today, with nothing to backfill.
--
-- slideshow_animation is deliberately KEPT. It is the fallback for untouched albums.

alter table albums add column if not exists slideshow_motion jsonb;

comment on column albums.slideshow_motion is
  'Composable slideshow transition: {move,direction,distance,fade,blur,durationMs,easing}. NULL = derive from slideshow_animation.';
