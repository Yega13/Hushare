-- Who the registered users actually are, and whether they are still here.
--
-- The admin page showed two columns for a user: the date they joined and their email. That is not
-- enough to answer any question worth asking — is this person still using it, are they close to a
-- limit, is a paying customer about to leave — so none of those questions were being asked.
--
-- Aggregated in the DATABASE for the same reason admin_growth_series is: the alternative is pulling
-- every album and every photo row into the Worker to count them, once per page load.
--
-- SECURITY DEFINER because auth.users belongs to the auth role and the API roles cannot read it.
-- Same treatment as find_user_id_by_email: an empty search_path, every table fully qualified, and
-- EXECUTE revoked from anon and authenticated explicitly rather than left to whatever the default
-- happens to be. These return every user's email, so a mistake here is a user-list leak.
--
-- NOTE ON TIER: deliberately not computed here. Whether a subscription counts as active is a real
-- rule with a grace window and several statuses (see isSubActive in src/lib/subscriptions.ts), and
-- writing it a second time in SQL would create two versions of it that drift apart silently. The
-- page joins the tier on in TypeScript using that one function.

create or replace function public.admin_user_overview(p_limit int default 300)
returns table(
  user_id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  albums int,
  media bigint,
  last_active timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  with u as (
    select id, email, created_at, last_sign_in_at
    from auth.users
    order by created_at desc
    limit greatest(coalesce(p_limit, 300), 1)
  ),
  a as (
    -- Retired albums are excluded from the count for the same reason the create route excludes
    -- them: they no longer occupy a slot, so counting them would show a cap that is not real.
    select al.user_id, count(*)::int as n, max(al.last_activity_at) as last_active
    from public.albums al
    where al.user_id is not null and al.retired_at is null
    group by al.user_id
  ),
  m as (
    select al.user_id, count(p.id) as n
    from public.albums al
    join public.photos p on p.album_id = al.id
    where al.user_id is not null
    group by al.user_id
  )
  select u.id, u.email::text, u.created_at, u.last_sign_in_at,
         coalesce(a.n, 0), coalesce(m.n, 0), a.last_active
  from u
  left join a on a.user_id = u.id
  left join m on m.user_id = u.id
  order by u.created_at desc
$$;

revoke all on function public.admin_user_overview(int) from public, anon, authenticated;
grant execute on function public.admin_user_overview(int) to service_role;

-- Do people come back?
--
-- The single question a signup chart cannot answer. "40 new users in August" and "40 new users in
-- August, 3 of whom ever came back" are the same bar on the growth chart and completely different
-- businesses.
--
-- ACTIVE means the person has an album that was touched in the last 30 days — not that they signed
-- in. Signing in is a poor proxy here: an owner shares a link and the album fills up with guest
-- photos for a week without them logging in once, which is the product working exactly as intended.
create or replace function public.admin_user_cohorts(p_months int default 6)
returns table(month date, signups bigint, still_active bigint)
language sql
security definer
stable
set search_path = ''
as $$
  with u as (
    select id, date_trunc('month', created_at)::date as m
    from auth.users
    where created_at >= date_trunc('month', now()) - make_interval(months => greatest(coalesce(p_months, 6), 1) - 1)
  ),
  act as (
    select al.user_id
    from public.albums al
    where al.user_id is not null
      and al.retired_at is null
      and al.last_activity_at > now() - interval '30 days'
    group by al.user_id
  )
  select u.m,
         count(*) as signups,
         count(act.user_id) as still_active
  from u
  left join act on act.user_id = u.id
  group by u.m
  order by u.m
$$;

revoke all on function public.admin_user_cohorts(int) from public, anon, authenticated;
grant execute on function public.admin_user_cohorts(int) to service_role;
