-- Migration: schema sync (2026-06-30)
-- The live database had drifted from the application's expectations, causing:
--   * "Album not found" — albums.password_hash / reveal_at columns were missing,
--     so the resolve query errored.
--   * Albums showing no photos to guests — RLS was enabled on `photos` but NO
--     policy existed, and the `album_is_open` function the policy needs was missing.
--   * Video uploads failing — `pending_stream_uploads` table + the (album_id,
--     stream_uid) unique constraint were missing.
-- This migration is idempotent (safe to re-run) and brings the DB into sync.

begin;

-- ── albums: missing columns ──────────────────────────────────────────────────
alter table public.albums add column if not exists password_hash text;
alter table public.albums add column if not exists reveal_at timestamptz;

-- ── functions ────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- SECURITY DEFINER: bypasses albums deny-all RLS so the photos policy can check
-- album openness without exposing any album data (returns only a boolean).
create or replace function public.album_is_open(p_album_id uuid)
returns boolean language sql security definer stable
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.albums
    where id = p_album_id and retired_at is null and password_hash is null
  );
$$;

create or replace function public.prune_rate_limit_events()
returns void language sql security definer
set search_path = public, pg_temp as $$
  delete from public.rate_limit_events where created_at < now() - interval '1 hour';
$$;

-- ── photos: face search column + integrity constraints ───────────────────────
alter table public.photos add column if not exists face_ids text[];
create index if not exists photos_face_ids_gin_idx on public.photos using gin(face_ids);

-- Stream dedup target — the photos/create upsert uses onConflict 'album_id,stream_uid'.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'photos_album_stream_uid_unique') then
    alter table public.photos add constraint photos_album_stream_uid_unique unique (album_id, stream_uid);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'photos_r2_requires_storage_path') then
    alter table public.photos add constraint photos_r2_requires_storage_path
      check (storage_backend <> 'r2' or storage_path is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'photos_stream_requires_stream_uid') then
    alter table public.photos add constraint photos_stream_requires_stream_uid
      check (storage_backend <> 'stream' or stream_uid is not null);
  end if;
end $$;

-- ── RLS policies (were entirely missing on the live DB) ──────────────────────
drop policy if exists "photos readable when album is open" on public.photos;
create policy "photos readable when album is open"
  on public.photos for select using (public.album_is_open(album_id));

drop policy if exists "users can read own subscription" on public.subscriptions;
create policy "users can read own subscription"
  on public.subscriptions for select using (auth.uid() = user_id);

-- ── subscriptions: billing webhook upsert target + status check ──────────────
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_polar_subscription_id_key') then
    alter table public.subscriptions add constraint subscriptions_polar_subscription_id_key unique (polar_subscription_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_status_check') then
    alter table public.subscriptions add constraint subscriptions_status_check
      check (status in ('active','trialing','canceled','past_due','unpaid','incomplete','incomplete_expired'));
  end if;
end $$;

-- ── updated_at triggers ──────────────────────────────────────────────────────
drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();
drop trigger if exists collections_set_updated_at on public.collections;
create trigger collections_set_updated_at before update on public.collections
  for each row execute function public.set_updated_at();

-- ── pending_stream_uploads (stream UID security; video upload flow) ──────────
create table if not exists public.pending_stream_uploads (
  stream_uid  text        primary key check (stream_uid ~ '^[a-f0-9]{32}$'),
  album_id    uuid        not null references public.albums(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists pending_stream_uploads_album_id_idx on public.pending_stream_uploads(album_id);
create index if not exists pending_stream_uploads_created_at_idx on public.pending_stream_uploads(created_at);
alter table public.pending_stream_uploads enable row level security;

commit;
