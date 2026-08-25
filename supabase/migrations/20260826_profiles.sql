-- A place for the few things an account has that are not a subscription.
--
-- Only an avatar today. It could have gone in auth.users.user_metadata with no migration at all, and
-- that is exactly why it did not: user_metadata is writable by the account holder through the client
-- SDK, so the server would not own the one field it is responsible for validating. A picture that is
-- only ever shown back to its owner is a small thing to get wrong, but "the client can write this
-- column" is not a property worth acquiring for the sake of skipping a migration.
--
-- RLS on with NO policies, matching albums and collections: nothing reaches this table except the
-- service role, which is the only thing that should. Grants are revoked explicitly rather than left
-- to whatever the default happens to be — the same treatment find_user_id_by_email was given, and
-- for the same reason: this table is keyed by user and a mistake here is a user-data leak.
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  avatar_url text,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

revoke all on table public.profiles from public, anon, authenticated;

-- Deleting the account takes the row with it (on delete cascade above). The R2 object is removed by
-- the application when the avatar is replaced or cleared; an orphaned image is a wasted byte, while
-- a dangling row would be a wasted lookup on every page load.
comment on table public.profiles is
  'Per-account settings that are not billing. Server-written only; see api/account/avatar.';
