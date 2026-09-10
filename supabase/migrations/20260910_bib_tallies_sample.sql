-- A PHOTOGRAPH BESIDE EACH NUMBER, so the owner does not have to guess.
--
-- The first version of the panel listed numbers and counts and asked the owner to decide which were
-- signage. That is the right question asked the wrong way: "is 2026 a runner?" is answerable in one
-- glance at a photograph and close to unanswerable from a number. The owner said so on first sight.
--
-- One thumbnail per number turns the panel from a quiz into a look. The finish arch is obvious the
-- moment it is on screen; so is an advertising board; and so is a runner, which is the case that
-- matters most because excluding one hides them from their own search.
--
-- OLDEST photo, not an arbitrary one. array_agg with no ORDER BY returns whatever the scan found
-- first, which can differ between two calls on the same data -- the panel would show a different
-- photograph each time it opened, for no reason the owner could see. The same defect the error
-- alert's sample had, recorded in 20260902_album_video_seconds.sql.
--
-- Replaces the two-column version added earlier today; `create or replace` cannot change a return
-- type, so it is dropped first. Both statements are idempotent.

drop function if exists public.album_bib_tallies(uuid, int);

create function public.album_bib_tallies(p_album_id uuid, p_limit int default 20)
returns table (number text, photos bigint, sample_thumb text)
language sql
stable
as $$
  select
    n as number,
    count(*) as photos,
    -- thumb_url, never url: this is a 40px chip in a dropdown, and the full image is several
    -- megabytes. NULL where a legacy row has no thumbnail; the panel renders the number alone.
    (array_agg(p.thumb_url order by p.created_at asc))[1] as sample_thumb
  from public.photos p, unnest(p.bib_numbers) as n
  where p.album_id = p_album_id
    and p.media_type = 'image'
    and p.bib_numbers is not null
  group by n
  order by count(*) desc, n asc
  limit greatest(0, least(coalesce(p_limit, 20), 100));
$$;

revoke all on function public.album_bib_tallies(uuid, int) from public;
revoke all on function public.album_bib_tallies(uuid, int) from anon;
revoke all on function public.album_bib_tallies(uuid, int) from authenticated;
grant execute on function public.album_bib_tallies(uuid, int) to service_role;
