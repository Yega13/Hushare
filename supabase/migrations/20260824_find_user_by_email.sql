-- Look a user up by email in one indexed query instead of scanning the whole user list.
--
-- findOrCreateUserByEmail() paginated auth.users 200 at a time for at most 25 pages: a hard ceiling
-- of 5,000 users. Past that an EXISTING customer is simply not found, createUser then fails on the
-- duplicate email, and the caller returns null — at which point the Polar webhook answers 200 and
-- Polar never retries. A real payment is taken and silently grants nothing.
--
-- It is also 25 round trips per unresolved lookup, on a path that runs during checkout.
--
-- SECURITY DEFINER because auth.users is owned by the auth role and not readable by the API roles.
-- The function returns ONLY the id for an exact, case-normalised email match — it cannot enumerate,
-- cannot list, and exposes no other column. EXECUTE is granted to service_role alone; anon and
-- authenticated are revoked explicitly rather than left to default, matching the treatment the
-- prune functions were given on 2026-08-20.
create or replace function public.find_user_id_by_email(p_email text)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select id
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1
$$;

revoke all on function public.find_user_id_by_email(text) from public;
revoke all on function public.find_user_id_by_email(text) from anon;
revoke all on function public.find_user_id_by_email(text) from authenticated;
grant execute on function public.find_user_id_by_email(text) to service_role;

-- auth.users already has a unique index on email, so this is a single index probe regardless of how
-- many users exist. The 5,000 ceiling disappears rather than moving.
