-- WHICH NUMBERS THIS ALBUM SEES MOST, COUNTED WHERE THE ROWS ARE.
--
-- The owner's signage panel needs "2026 -- on 1,145 photographs" for the twenty most-seen numbers.
-- The obvious implementation reads every photo's bib_numbers into the Worker and tallies there, and
-- that is the mistake this codebase has already paid for once: the album window measured 424 KB on
-- the real event album and was the single largest line in the database transfer bill, which is
-- shared across every album on the plan rather than charged to the busy one. A 5,000-photo race
-- would ship 5,000 arrays to produce twenty rows.
--
-- Asking the database instead returns about forty bytes.
--
-- WHY IT IS NOT FILTERED HERE. It would be easy to drop anything that looks like signage before
-- returning -- a frequency threshold, a digit-length rule -- and it would be wrong. Measured on the
-- 69-photo album, the banner year 2026 and the real bib 00663 each appear on exactly 4 photographs;
-- a runner appears on 1-4 whatever the album size, while any album-relative floor scales with the
-- album. 20260814_bib_range.sql recorded that warning before anyone tried it. This function's job
-- is to COUNT. Deciding is lib/bib-exclusions', and confirming is the owner's.
--
-- Hidden photos are included deliberately: the owner is the only caller, they can see hidden rows
-- anyway, and a banner that appears mostly on unapproved photographs is still a banner.
--
-- Idempotent -- safe to re-run.

create or replace function public.album_bib_tallies(p_album_id uuid, p_limit int default 20)
returns table (number text, photos bigint)
language sql
stable
as $$
  select n as number, count(*) as photos
  from public.photos p, unnest(p.bib_numbers) as n
  where p.album_id = p_album_id
    and p.media_type = 'image'
    and p.bib_numbers is not null
  group by n
  -- Most-seen first, then the number itself so the list is stable between calls and the panel does
  -- not reshuffle under the owner's finger between one render and the next.
  order by count(*) desc, n asc
  limit greatest(0, least(coalesce(p_limit, 20), 100));
$$;

-- SERVICE ROLE ONLY, like every other function here. The tallies are not secret, but the route that
-- calls this checks an owner token first and nothing reachable from a browser should be able to
-- enumerate an album's numbers without one.
revoke all on function public.album_bib_tallies(uuid, int) from public;
revoke all on function public.album_bib_tallies(uuid, int) from anon;
revoke all on function public.album_bib_tallies(uuid, int) from authenticated;
grant execute on function public.album_bib_tallies(uuid, int) to service_role;

-- The GIN index on bib_numbers answers containment, not unnest-and-group. This is a per-album scan
-- of one column, run once when an owner opens the panel -- never on a guest path and never during
-- an upload -- so the album_id index it already has is the right amount of help.
