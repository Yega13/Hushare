-- ============================================================
-- Hushare Database Schema v1.0
-- Run this entire file in Supabase SQL Editor as a single batch.
-- ============================================================


-- ─── Shared trigger: auto-update updated_at ──────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;


-- ─── Albums ──────────────────────────────────────────────
create table public.albums (
  id                   uuid        primary key default gen_random_uuid(),
  user_id              uuid        references auth.users(id) on delete set null,
  title                text        not null check (char_length(title) between 1 and 120),
  slug                 text        not null unique check (slug ~ '^[a-z0-9]{8}$'),
  custom_slug          text        unique check (
                                     custom_slug is null or (
                                       char_length(custom_slug) between 4 and 40
                                       and custom_slug ~ '^[a-z0-9-]+$'
                                       and custom_slug not like '-%'
                                       and custom_slug not like '%-'
                                     )
                                   ),
  owner_token          text        not null,
  password_hash        text,
  background_theme     text,
  media_radius         integer     not null default 16  check (media_radius between 0 and 500),
  media_filter         text        not null default 'none' check (media_filter in ('none','warm','cool','mono','vintage','soft')),
  media_hover          text        not null default 'none' check (media_hover in ('none','mono','fade','zoom','lift')),
  mobile_grid_columns  integer     not null default 3   check (mobile_grid_columns in (3,4,5,6)),
  slideshow_interval_ms integer    not null default 4200 check (slideshow_interval_ms between 2000 and 10000),
  slideshow_animation  text        not null default 'fade' check (slideshow_animation in ('none','fade','rise','zoom')),
  video_autoplay       boolean     not null default true,
  cover_photo_id       uuid,        -- intentionally no FK: circular dep with photos; app layer handles consistency
  reveal_at            timestamptz,
  guest_uploads_enabled  boolean   not null default true,
  allow_guest_downloads  boolean   not null default true,
  last_activity_at     timestamptz not null default now(),
  last_notification_at timestamptz,
  retired_at           timestamptz,
  created_at           timestamptz not null default now()
);

create index albums_user_id_idx           on public.albums(user_id);
create index albums_retirement_scan_idx   on public.albums(last_activity_at) where retired_at is null;
create index albums_cover_photo_id_idx    on public.albums(cover_photo_id)   where cover_photo_id is not null;

alter table public.albums enable row level security;
-- No SELECT policy: all album reads go through the admin client in API routes.


-- ─── Photos ──────────────────────────────────────────────
create table public.photos (
  id                    uuid        primary key default gen_random_uuid(),
  album_id              uuid        not null references public.albums(id) on delete cascade,
  media_type            text        not null check (media_type in ('image','video')),
  storage_backend       text        not null check (storage_backend in ('r2','stream')),

  -- R2 fields
  storage_path          text,
  url                   text,
  thumb_url             text,

  -- Stream fields
  stream_uid            text,
  stream_iframe_url     text,
  stream_thumbnail_url  text,
  poster_url            text,

  -- Per-photo display overrides
  caption               text        check (caption is null or char_length(caption) <= 30),
  author_name           text        check (author_name is null or char_length(author_name) <= 16),
  sort_order            integer,
  display_radius        integer     check (display_radius is null or (display_radius >= 0 and display_radius <= 500)),
  display_filter        text        check (display_filter is null or display_filter in ('none','warm','cool','mono','vintage','soft')),
  duration_seconds      integer     check (duration_seconds is null or duration_seconds >= 0),
  face_ids              text[],
  created_at            timestamptz not null default now(),

  -- R2 deduplication (NULLs excluded per SQL standard — correct for stream rows)
  unique(album_id, storage_path),

  -- Backend-discriminating integrity: each backend must supply its key identifier
  constraint photos_r2_requires_storage_path   check (storage_backend <> 'r2'     or storage_path is not null),
  constraint photos_stream_requires_stream_uid  check (storage_backend <> 'stream' or stream_uid   is not null)
);

alter table public.photos replica identity full;

-- Primary sort index for album page load (extremely hot)
create index photos_album_sort_idx   on public.photos(album_id, sort_order nulls last, created_at);

-- Stream UID lookup (webhook processing, not the leading col in the unique idx below → keep both)
create index photos_stream_uid_idx   on public.photos(stream_uid) where stream_uid is not null;

-- Stream deduplication per album
create unique index photos_stream_uid_uniq on public.photos(album_id, stream_uid) where stream_uid is not null;

-- Face search: && operator requires GIN
create index photos_face_ids_gin_idx on public.photos using gin(face_ids);

alter table public.photos enable row level security;

-- albums has deny-all RLS for the anon role, so a bare EXISTS subquery against albums
-- inside a photos policy would always return false (the subquery sees zero album rows).
-- SECURITY DEFINER runs as the DB owner (postgres), which bypasses RLS on albums,
-- and returns only a boolean — no album data is exposed to callers.
create or replace function public.album_is_open(p_album_id uuid)
returns boolean language sql security definer stable
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.albums
    where id           = p_album_id
      and retired_at   is null
      and password_hash is null
  );
$$;

-- Anon clients (album page JS + Realtime) may only read photos from open albums.
-- Password-protected and retired album photos are fetched via API route (admin client)
-- after cookie verification — never via the anon client directly.
create policy "photos readable when album is open"
  on public.photos for select
  using (public.album_is_open(album_id));


-- ─── Subscriptions ───────────────────────────────────────
create table public.subscriptions (
  id                      uuid        primary key default gen_random_uuid(),
  user_id                 uuid        not null references auth.users(id) on delete cascade,
  polar_subscription_id   text        not null unique,
  polar_customer_id       text,
  polar_product_id        text,
  tier                    text        not null check (tier in ('pro','studio')),
  status                  text        not null check (status in (
                                        'active','trialing','canceled',
                                        'past_due','unpaid','incomplete','incomplete_expired'
                                      )),
  current_period_end      timestamptz,
  cancel_at_period_end    boolean     not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Composite covering index: tier check runs on every upload (very hot)
create index subscriptions_user_status_idx
  on public.subscriptions(user_id, status, current_period_end desc);

alter table public.subscriptions enable row level security;

-- Authenticated users can read their own subscription (e.g. account page SSR client)
create policy "users can read own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();


-- ─── Collections (Studio tier) ───────────────────────────
create table public.collections (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  name        text        not null check (char_length(name) between 1 and 80),
  slug        text        not null unique check (
                            char_length(slug) between 4 and 80
                            and slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'
                          ),
  description text        check (description is null or char_length(description) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index collections_user_id_idx on public.collections(user_id);

alter table public.collections enable row level security;

create trigger collections_set_updated_at
  before update on public.collections
  for each row execute function public.set_updated_at();


-- ─── Collection Albums ────────────────────────────────────
create table public.collection_albums (
  collection_id  uuid    not null references public.collections(id) on delete cascade,
  album_id       uuid    not null references public.albums(id)      on delete cascade,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  primary key (collection_id, album_id)
);

create index collection_albums_album_id_idx on public.collection_albums(album_id);

alter table public.collection_albums enable row level security;
-- No policies: all collection_albums reads go through the admin client.


-- ─── Rate Limit Events ───────────────────────────────────
create table public.rate_limit_events (
  id         bigint      generated always as identity primary key,
  key        text        not null,
  created_at timestamptz not null default now()
);

-- Composite order matters: equality on key first, then range on created_at
create index idx_rate_limit_events_key_created on public.rate_limit_events(key, created_at);

alter table public.rate_limit_events enable row level security;
-- No policies: only the admin client inserts here.

-- Called by pg_cron (wire up after Supabase provisioning):
--   select cron.schedule('prune-rate-limits', '*/10 * * * *', 'select public.prune_rate_limit_events()');
create or replace function public.prune_rate_limit_events()
returns void language sql security definer
set search_path = public, pg_temp as $$
  delete from public.rate_limit_events
  where created_at < now() - interval '1 hour';
$$;


-- ─── Batch Reorder RPC ───────────────────────────────────
create or replace function public.batch_set_sort_order(
  p_album_id uuid,
  p_ids      uuid[],
  p_orders   integer[]
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if array_length(p_ids, 1) is distinct from array_length(p_orders, 1) then
    raise exception 'p_ids and p_orders must have the same length';
  end if;
  update public.photos
  set sort_order = u.ord
  from (select unnest(p_ids) as id, unnest(p_orders) as ord) as u
  where photos.id = u.id
    and photos.album_id = p_album_id;
end; $$;
