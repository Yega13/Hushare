-- ============================================================
-- Hushare database schema — GENERATED, do not hand-edit.
--
-- Regenerate with:  node scripts/dump-schema.mjs
-- Verify with:      node scripts/dump-schema.mjs --check
--
-- This is the file the database is rebuilt from. It was hand-maintained until 2026-08-26,
-- by which point it was missing 12 of 18 tables and 64 columns, so a restore of a good
-- backup would have failed. Generated from the live database instead of remembered.
--
-- Row-level security is enabled on every table; the application reaches these through the
-- service-role client after its own checks. Any policy that DOES exist is emitted below,
-- read from pg_policies — this line used to assert there were none, which was a hardcoded
-- claim in the generator rather than a fact read from the database, and it was wrong.
-- Grants to anon/authenticated are deliberately absent — see
-- supabase/migrations/20260826_revoke_anon_select.sql.
-- ============================================================

-- ─── active_sessions ───
create table if not exists public.active_sessions (
  id text not null,
  last_seen timestamp with time zone default now() not null,
  path text,
  primary key (id)
);
alter table public.active_sessions enable row level security;

-- ─── albums ───
create table if not exists public.albums (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  title text not null,
  slug text not null,
  custom_slug text,
  owner_token text not null,
  created_at timestamp with time zone default now() not null,
  background_theme text,
  last_activity_at timestamp with time zone default now() not null,
  retired_at timestamp with time zone,
  media_radius integer default 16 not null,
  video_autoplay boolean default true not null,
  media_filter text default 'none'::text not null,
  mobile_grid_columns smallint default 3 not null,
  slideshow_interval_ms integer default 4200 not null,
  slideshow_animation text default 'fade'::text not null,
  last_notification_at timestamp with time zone,
  expiry_warning_sent_at timestamp with time zone,
  guest_uploads_enabled boolean default true not null,
  allow_guest_downloads boolean default true not null,
  cover_photo_id uuid,
  password_hash text,
  reveal_at timestamp with time zone,
  face_finder_enabled boolean default false not null,
  photo_layout text default 'grid'::text not null,
  require_approval boolean default false not null,
  media_cap_override integer,
  accent_color text,
  logo_url text,
  welcome_message text,
  hide_branding boolean default false not null,
  title_font text,
  photo_style text,
  header_image text,
  header_focal text,
  sponsor_logos jsonb default '[]'::jsonb not null,
  header_touched boolean default false not null,
  header_video_mode text,
  header_zoom smallint,
  bib_search_enabled boolean default false not null,
  bib_min integer,
  bib_max integer,
  slideshow_motion jsonb,
  face_consent_at timestamp with time zone,
  face_consent_by uuid,
  branding_locked boolean default false not null,
  desktop_grid_columns smallint,
  photo_order text default 'newest'::text not null,
  primary key (id)
);
alter table public.albums enable row level security;

-- ─── collection_albums ───
create table if not exists public.collection_albums (
  collection_id uuid not null,
  album_id uuid not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  primary key (collection_id, album_id)
);
alter table public.collection_albums enable row level security;

-- ─── collections ───
create table if not exists public.collections (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  name text not null,
  slug text not null,
  description text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  primary key (id)
);
alter table public.collections enable row level security;

-- ─── error_events ───
create table if not exists public.error_events (
  id bigint not null,
  created_at timestamp with time zone default now() not null,
  level text default 'error'::text not null,
  source text not null,
  message text not null,
  album_id uuid,
  context jsonb,
  ua text,
  resolved_at timestamp with time zone,
  primary key (id)
);
alter table public.error_events enable row level security;

-- ─── pending_stream_uploads ───
create table if not exists public.pending_stream_uploads (
  stream_uid text not null,
  album_id uuid not null,
  created_at timestamp with time zone default now() not null,
  upload_url text,
  consumed_at timestamp with time zone,
  primary key (stream_uid)
);
alter table public.pending_stream_uploads enable row level security;

-- ─── photos ───
create table if not exists public.photos (
  id uuid default gen_random_uuid() not null,
  album_id uuid not null,
  storage_path text,
  storage_backend text default 'r2'::text not null,
  url text,
  media_type text default 'image'::text not null,
  caption text,
  author_name text,
  poster_path text,
  poster_url text,
  created_at timestamp with time zone default now() not null,
  display_radius integer,
  display_filter text,
  sort_order integer,
  stream_uid text,
  stream_iframe_url text,
  stream_thumbnail_url text,
  mirror_path text,
  mirror_url text,
  thumb_path text,
  thumb_url text,
  duration_seconds integer,
  face_ids text[],
  width integer,
  height integer,
  hidden boolean default false not null,
  bib_numbers text[],
  primary key (id)
);
alter table public.photos enable row level security;

-- ─── poll_votes ───
create table if not exists public.poll_votes (
  id uuid default gen_random_uuid() not null,
  poll_key text not null,
  option_key text not null,
  voter_id text not null,
  created_at timestamp with time zone default now() not null,
  primary key (id)
);
alter table public.poll_votes enable row level security;

-- ─── profiles ───
create table if not exists public.profiles (
  user_id uuid not null,
  avatar_url text,
  updated_at timestamp with time zone default now() not null,
  primary key (user_id)
);
alter table public.profiles enable row level security;

-- ─── rate_limit_counters ───
create table if not exists public.rate_limit_counters (
  key text not null,
  window_start timestamp with time zone not null,
  hits integer default 0 not null,
  primary key (key, window_start)
);
alter table public.rate_limit_counters enable row level security;

-- ─── rate_limit_events ───
create table if not exists public.rate_limit_events (
  id bigint not null,
  key text not null,
  created_at timestamp with time zone default now() not null,
  primary key (id)
);
alter table public.rate_limit_events enable row level security;

-- ─── schema_migrations ───
create table if not exists public.schema_migrations (
  name text not null,
  applied_at timestamp with time zone default now() not null,
  primary key (name)
);
alter table public.schema_migrations enable row level security;

-- ─── statements ───
create table if not exists public.statements (
  id uuid default gen_random_uuid() not null,
  slug text not null,
  title text not null,
  summary text,
  body_html text not null,
  published_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  poll_key text,
  primary key (id)
);
alter table public.statements enable row level security;

-- ─── subscriptions ───
create table if not exists public.subscriptions (
  id text default gen_random_uuid() not null,
  user_id uuid not null,
  polar_subscription_id text not null,
  polar_customer_id text,
  polar_product_id text not null,
  tier text not null,
  status text not null,
  current_period_end timestamp with time zone,
  cancel_at_period_end boolean default false not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  last_reminder_at timestamp with time zone,
  polar_modified_at timestamp with time zone,
  primary key (id)
);
alter table public.subscriptions enable row level security;

-- ─── system_state ───
create table if not exists public.system_state (
  key text not null,
  value text,
  updated_at timestamp with time zone default now() not null,
  primary key (key)
);
alter table public.system_state enable row level security;

-- ─── Row-level security policies ───
drop policy if exists "statements_public_read" on public.statements;
create policy "statements_public_read" on public.statements for select to public using (true);
drop policy if exists "users can read own subscription" on public.subscriptions;
create policy "users can read own subscription" on public.subscriptions for select to public using ((auth.uid() = user_id));

-- ─── Constraints (foreign keys, checks, unique) ───
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'albums_background_theme_check'
    and conrelid = 'albums'::regclass) then
    alter table albums add constraint albums_background_theme_check CHECK (((background_theme IS NULL) OR (char_length(background_theme) <= 2048)));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'albums_bib_range_valid'
    and conrelid = 'albums'::regclass) then
    alter table albums add constraint albums_bib_range_valid CHECK ((((bib_min IS NULL) OR (bib_min > 0)) AND ((bib_max IS NULL) OR (bib_max > 0)) AND ((bib_min IS NULL) OR (bib_max IS NULL) OR (bib_min <= bib_max))));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'albums_cover_photo_id_fkey'
    and conrelid = 'albums'::regclass) then
    alter table albums add constraint albums_cover_photo_id_fkey FOREIGN KEY (cover_photo_id) REFERENCES photos(id) ON DELETE SET NULL;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'albums_desktop_grid_columns_check'
    and conrelid = 'albums'::regclass) then
    alter table albums add constraint albums_desktop_grid_columns_check CHECK (((desktop_grid_columns IS NULL) OR (desktop_grid_columns = ANY (ARRAY[3, 4, 5, 6, 7, 8]))));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'albums_media_filter_check'
    and conrelid = 'albums'::regclass) then
    alter table albums add constraint albums_media_filter_check CHECK ((media_filter = ANY (ARRAY['none'::text, 'warm'::text, 'cool'::text, 'mono'::text, 'vintage'::text, 'soft'::text])));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'albums_media_radius_check'
    and conrelid = 'albums'::regclass) then
    alter table albums add constraint albums_media_radius_check CHECK (((media_radius >= 0) AND (media_radius <= 10000)));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'albums_mobile_grid_columns_check'
    and conrelid = 'albums'::regclass) then
    alter table albums add constraint albums_mobile_grid_columns_check CHECK ((mobile_grid_columns = ANY (ARRAY[2, 3, 4, 5, 6])));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'albums_photo_layout_check'
    and conrelid = 'albums'::regclass) then
    alter table albums add constraint albums_photo_layout_check CHECK ((photo_layout = ANY (ARRAY['grid'::text, 'justified'::text])));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'albums_photo_order_check'
    and conrelid = 'albums'::regclass) then
    alter table albums add constraint albums_photo_order_check CHECK ((photo_order = ANY (ARRAY['newest'::text, 'oldest'::text, 'manual'::text])));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'albums_slideshow_animation_check'
    and conrelid = 'albums'::regclass) then
    alter table albums add constraint albums_slideshow_animation_check CHECK ((slideshow_animation = ANY (ARRAY['none'::text, 'fade'::text, 'rise'::text, 'zoom'::text])));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'albums_slideshow_interval_ms_check'
    and conrelid = 'albums'::regclass) then
    alter table albums add constraint albums_slideshow_interval_ms_check CHECK (((slideshow_interval_ms >= 2000) AND (slideshow_interval_ms <= 10000)));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'albums_slug_key'
    and conrelid = 'albums'::regclass) then
    alter table albums add constraint albums_slug_key UNIQUE (slug);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'albums_title_check'
    and conrelid = 'albums'::regclass) then
    alter table albums add constraint albums_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 120)));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'albums_user_id_fkey'
    and conrelid = 'albums'::regclass) then
    alter table albums add constraint albums_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'collection_albums_album_id_fkey'
    and conrelid = 'collection_albums'::regclass) then
    alter table collection_albums add constraint collection_albums_album_id_fkey FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'collection_albums_collection_id_fkey'
    and conrelid = 'collection_albums'::regclass) then
    alter table collection_albums add constraint collection_albums_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'collections_name_check'
    and conrelid = 'collections'::regclass) then
    alter table collections add constraint collections_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80)));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'collections_slug_key'
    and conrelid = 'collections'::regclass) then
    alter table collections add constraint collections_slug_key UNIQUE (slug);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'collections_user_id_fkey'
    and conrelid = 'collections'::regclass) then
    alter table collections add constraint collections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'error_events_level_check'
    and conrelid = 'error_events'::regclass) then
    alter table error_events add constraint error_events_level_check CHECK ((level = ANY (ARRAY['error'::text, 'warn'::text])));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'error_events_message_check'
    and conrelid = 'error_events'::regclass) then
    alter table error_events add constraint error_events_message_check CHECK (((char_length(message) >= 1) AND (char_length(message) <= 500)));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'error_events_source_check'
    and conrelid = 'error_events'::regclass) then
    alter table error_events add constraint error_events_source_check CHECK ((char_length(source) <= 60));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'error_events_ua_check'
    and conrelid = 'error_events'::regclass) then
    alter table error_events add constraint error_events_ua_check CHECK (((ua IS NULL) OR (char_length(ua) <= 300)));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pending_stream_uploads_album_id_fkey'
    and conrelid = 'pending_stream_uploads'::regclass) then
    alter table pending_stream_uploads add constraint pending_stream_uploads_album_id_fkey FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pending_stream_uploads_stream_uid_check'
    and conrelid = 'pending_stream_uploads'::regclass) then
    alter table pending_stream_uploads add constraint pending_stream_uploads_stream_uid_check CHECK ((stream_uid ~ '^[a-f0-9]{32}$'::text));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'photos_album_id_fkey'
    and conrelid = 'photos'::regclass) then
    alter table photos add constraint photos_album_id_fkey FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'photos_album_stream_uid_unique'
    and conrelid = 'photos'::regclass) then
    alter table photos add constraint photos_album_stream_uid_unique UNIQUE (album_id, stream_uid);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'photos_display_filter_check'
    and conrelid = 'photos'::regclass) then
    alter table photos add constraint photos_display_filter_check CHECK (((display_filter IS NULL) OR (display_filter = ANY (ARRAY['none'::text, 'warm'::text, 'cool'::text, 'mono'::text, 'vintage'::text, 'soft'::text]))));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'photos_display_radius_check'
    and conrelid = 'photos'::regclass) then
    alter table photos add constraint photos_display_radius_check CHECK (((display_radius IS NULL) OR ((display_radius >= 0) AND (display_radius <= 10000))));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'photos_media_type_check'
    and conrelid = 'photos'::regclass) then
    alter table photos add constraint photos_media_type_check CHECK ((media_type = ANY (ARRAY['image'::text, 'video'::text])));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'photos_r2_requires_storage_path'
    and conrelid = 'photos'::regclass) then
    alter table photos add constraint photos_r2_requires_storage_path CHECK (((storage_backend <> 'r2'::text) OR (storage_path IS NOT NULL)));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'photos_storage_backend_check'
    and conrelid = 'photos'::regclass) then
    alter table photos add constraint photos_storage_backend_check CHECK ((storage_backend = ANY (ARRAY['supabase'::text, 'r2'::text, 'stream'::text])));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'photos_stream_requires_stream_uid'
    and conrelid = 'photos'::regclass) then
    alter table photos add constraint photos_stream_requires_stream_uid CHECK (((storage_backend <> 'stream'::text) OR (stream_uid IS NOT NULL)));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_user_id_fkey'
    and conrelid = 'profiles'::regclass) then
    alter table profiles add constraint profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'statements_slug_key'
    and conrelid = 'statements'::regclass) then
    alter table statements add constraint statements_slug_key UNIQUE (slug);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_polar_subscription_id_key'
    and conrelid = 'subscriptions'::regclass) then
    alter table subscriptions add constraint subscriptions_polar_subscription_id_key UNIQUE (polar_subscription_id);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_status_check'
    and conrelid = 'subscriptions'::regclass) then
    alter table subscriptions add constraint subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'trialing'::text, 'canceled'::text, 'past_due'::text, 'unpaid'::text, 'incomplete'::text, 'incomplete_expired'::text])));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_tier_check'
    and conrelid = 'subscriptions'::regclass) then
    alter table subscriptions add constraint subscriptions_tier_check CHECK ((tier = ANY (ARRAY['pro'::text, 'studio'::text])));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_user_id_fkey'
    and conrelid = 'subscriptions'::regclass) then
    alter table subscriptions add constraint subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  end if;
end $$;

-- ─── Indexes ───
create index if not exists active_sessions_last_seen_idx ON public.active_sessions USING btree (last_seen);
create index if not exists albums_branding_locked_idx ON public.albums USING btree (branding_locked) WHERE branding_locked;
create unique index if not exists albums_custom_slug_unique_idx ON public.albums USING btree (custom_slug) WHERE (custom_slug IS NOT NULL);
create index if not exists albums_retirement_scan_idx ON public.albums USING btree (last_activity_at) WHERE (retired_at IS NULL);
create index if not exists albums_slug_idx ON public.albums USING btree (slug);
create unique index if not exists albums_slug_key ON public.albums USING btree (slug);
create index if not exists albums_user_id_idx ON public.albums USING btree (user_id);
create index if not exists collection_albums_album_id_idx ON public.collection_albums USING btree (album_id);
create unique index if not exists collections_slug_key ON public.collections USING btree (slug);
create index if not exists collections_user_id_idx ON public.collections USING btree (user_id);
create index if not exists error_events_created_idx ON public.error_events USING btree (created_at DESC);
create index if not exists error_events_level_created_idx ON public.error_events USING btree (level, created_at DESC);
create index if not exists error_events_unresolved_created_idx ON public.error_events USING btree (created_at DESC) WHERE (resolved_at IS NULL);
create index if not exists pending_stream_uploads_album_consumed_idx ON public.pending_stream_uploads USING btree (album_id, consumed_at);
create index if not exists pending_stream_uploads_album_id_idx ON public.pending_stream_uploads USING btree (album_id);
create index if not exists pending_stream_uploads_created_at_idx ON public.pending_stream_uploads USING btree (created_at);
create index if not exists photos_album_id_idx ON public.photos USING btree (album_id);
create index if not exists photos_album_sort_order_idx ON public.photos USING btree (album_id, sort_order, created_at);
create unique index if not exists photos_album_storage_path_unique_idx ON public.photos USING btree (album_id, storage_path);
create unique index if not exists photos_album_stream_uid_unique ON public.photos USING btree (album_id, stream_uid);
create index if not exists photos_album_visible_idx ON public.photos USING btree (album_id) WHERE (hidden = false);
create index if not exists photos_bib_numbers_idx ON public.photos USING gin (bib_numbers);
create index if not exists photos_face_ids_gin_idx ON public.photos USING gin (face_ids);
create index if not exists photos_media_type_idx ON public.photos USING btree (media_type);
create index if not exists photos_stream_uid_idx ON public.photos USING btree (stream_uid) WHERE (stream_uid IS NOT NULL);
create index if not exists poll_votes_key_idx ON public.poll_votes USING btree (poll_key);
create unique index if not exists poll_votes_unique ON public.poll_votes USING btree (poll_key, voter_id);
create index if not exists rate_limit_events_key_created_at ON public.rate_limit_events USING btree (key, created_at);
create index if not exists statements_published_idx ON public.statements USING btree (published_at DESC);
create unique index if not exists statements_slug_key ON public.statements USING btree (slug);
create unique index if not exists subscriptions_polar_subscription_id_key ON public.subscriptions USING btree (polar_subscription_id);
create index if not exists subscriptions_renewal_window_idx ON public.subscriptions USING btree (current_period_end) WHERE ((status = 'active'::text) AND (cancel_at_period_end = false));
create index if not exists subscriptions_user_id_idx ON public.subscriptions USING btree (user_id);

-- ─── Functions ───
CREATE OR REPLACE FUNCTION public.admin_growth_series(p_days integer)
 RETURNS TABLE(day date, albums bigint, uploads bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select d::date as day,
    (select count(*) from albums where created_at >= d and created_at < d + interval '1 day') as albums,
    (select count(*) from photos where created_at >= d and created_at < d + interval '1 day') as uploads
  from generate_series(
    date_trunc('day', now()) - make_interval(days => greatest(p_days, 1) - 1),
    date_trunc('day', now()),
    interval '1 day'
  ) as d;
$function$;

CREATE OR REPLACE FUNCTION public.admin_user_cohorts(p_months integer DEFAULT 6)
 RETURNS TABLE(month date, signups bigint, still_active bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_user_overview(p_limit integer DEFAULT 300)
 RETURNS TABLE(user_id uuid, email text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, albums integer, media bigint, last_active timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_weekday_series(p_days integer, p_tz text)
 RETURNS TABLE(dow integer, albums bigint, uploads bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with span as (
    -- Midnight local, p_days-1 days back, converted to an absolute instant so it can be compared
    -- against timestamptz columns directly and use their indexes.
    select (
      (date_trunc('day', now() at time zone p_tz) - make_interval(days => greatest(p_days, 1) - 1))
      at time zone p_tz
    ) as from_ts
  ),
  a as (
    select extract(dow from (albums.created_at at time zone p_tz))::int as dow, count(*) as c
    from albums, span
    where albums.created_at >= span.from_ts
    group by 1
  ),
  p as (
    select extract(dow from (photos.created_at at time zone p_tz))::int as dow, count(*) as c
    from photos, span
    where photos.created_at >= span.from_ts
    group by 1
  )
  select g.dow::int, coalesce(a.c, 0)::bigint, coalesce(p.c, 0)::bigint
  from generate_series(0, 6) as g(dow)
  left join a on a.dow = g.dow
  left join p on p.dow = g.dow
  order by g.dow;
$function$;

CREATE OR REPLACE FUNCTION public.album_is_open(p_album_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.albums
    where id = p_album_id and retired_at is null and password_hash is null
  );
$function$;

CREATE OR REPLACE FUNCTION public.batch_set_sort_order(p_album_id uuid, p_ids uuid[], p_orders integer[])
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  UPDATE public.photos
  SET sort_order = updates.ord
  FROM (SELECT unnest(p_ids) AS id, unnest(p_orders) AS ord) AS updates
  WHERE photos.id = updates.id
    AND photos.album_id = p_album_id;
$function$;

CREATE OR REPLACE FUNCTION public.coalesce_error_event(p_level text, p_source text, p_message text, p_album_id uuid, p_context jsonb, p_ua text, p_window_seconds integer DEFAULT 300)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id bigint;
  v_ctx jsonb;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_level || '|' || p_source || '|' || p_message || '|' || coalesce(p_album_id::text, ''), 0)
  );

  select id, coalesce(context, '{}'::jsonb)
    into v_id, v_ctx
  from public.error_events
  where level = p_level
    and source = p_source
    and message = p_message
    and album_id is not distinct from p_album_id
    and resolved_at is null
    and created_at >= now() - make_interval(secs => p_window_seconds)
  order by created_at desc
  limit 1;

  if v_id is null then
    insert into public.error_events (level, source, message, album_id, context, ua)
    values (p_level, p_source, p_message, p_album_id, p_context, p_ua);
    return;
  end if;

  -- Merge only keys the stored row is MISSING, so the first occurrence stays the sample and a later
  -- report cannot rewrite history -- while a diagnostic only some occurrences carry (directCause /
  -- relayCause) still survives instead of being lost to whichever arrived first.
  v_ctx := coalesce(p_context, '{}'::jsonb) || v_ctx;
  v_ctx := jsonb_set(v_ctx, '{repeats}',
                     to_jsonb(coalesce((v_ctx ->> 'repeats')::int, 1) + 1), true);
  -- created_at stays put so the timeline is not shredded; lastSeen is what says an old-looking row
  -- is still happening right now.
  v_ctx := jsonb_set(v_ctx, '{lastSeen}', to_jsonb(now()), true);
  if p_ua is not null and v_ctx ? 'firstUa' and (v_ctx ->> 'firstUa') <> left(p_ua, 80) then
    v_ctx := jsonb_set(v_ctx, '{multiDevice}', 'true'::jsonb, true);
  elsif p_ua is not null and not (v_ctx ? 'firstUa') then
    v_ctx := jsonb_set(v_ctx, '{firstUa}', to_jsonb(left(p_ua, 80)), true);
  end if;

  update public.error_events set context = v_ctx where id = v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_album_slug_namespace_unique()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.custom_slug IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.albums WHERE id <> NEW.id AND slug = NEW.custom_slug
  ) THEN
    RAISE unique_violation USING message = 'album custom_slug conflicts with existing slug';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.albums WHERE id <> NEW.id AND custom_slug = NEW.slug
  ) THEN
    RAISE unique_violation USING message = 'album slug conflicts with existing custom_slug';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.find_user_id_by_email(p_email text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select id
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1
$function$;

CREATE OR REPLACE FUNCTION public.prune_error_events()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  delete from public.error_events where created_at < now() - interval '30 days';
$function$;

CREATE OR REPLACE FUNCTION public.prune_rate_limit_events()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  delete from public.rate_limit_events where created_at < now() - interval '1 hour';
$function$;

CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
 RETURNS TABLE(allowed boolean, retry_after integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_bucket timestamptz;
  v_hits   integer;
begin
  -- Floor now() to the window. Every caller in the same window shares one row.
  v_bucket := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limit_counters (key, window_start, hits)
  values (p_key, v_bucket, 1)
  on conflict (key, window_start) do update set hits = rate_limit_counters.hits + 1
  returning hits into v_hits;

  if v_hits > p_max then
    -- Time until this window rolls, not the whole window length: a caller rejected near the end of
    -- a window is told to wait seconds rather than an hour. The old implementation always returned
    -- the full window, which is honest but needlessly pessimistic.
    return query select false, greatest(1, ceil(extract(epoch from (v_bucket + make_interval(secs => p_window_seconds)) - now()))::integer);
  end if;
  return query select true, 0;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin new.updated_at = now(); return new; end; $function$;

CREATE OR REPLACE FUNCTION public.studio_add_credits(p_user uuid, p_amount integer, p_reason text, p_meta jsonb DEFAULT NULL::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_balance integer;
begin
  insert into public.studio_credits (user_id, balance) values (p_user, 0)
    on conflict (user_id) do nothing;
  update public.studio_credits
     set balance = balance + p_amount, updated_at = now()
   where user_id = p_user
   returning balance into v_balance;
  insert into public.studio_credit_ledger (user_id, delta, reason, meta, balance_after)
    values (p_user, p_amount, p_reason, p_meta, v_balance);
  return v_balance;
end $function$;

CREATE OR REPLACE FUNCTION public.studio_grant_monthly(p_user uuid, p_amount integer, p_month text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_balance integer; v_last text;
begin
  insert into public.studio_credits (user_id, balance) values (p_user, 0)
    on conflict (user_id) do nothing;
  select balance, last_grant_month into v_balance, v_last
    from public.studio_credits where user_id = p_user for update;
  if v_last is distinct from p_month then
    update public.studio_credits
       set balance = balance + p_amount, last_grant_month = p_month, updated_at = now()
     where user_id = p_user returning balance into v_balance;
    insert into public.studio_credit_ledger (user_id, delta, reason, meta, balance_after)
      values (p_user, p_amount, 'monthly_grant', jsonb_build_object('month', p_month), v_balance);
  end if;
  return v_balance;
end $function$;

CREATE OR REPLACE FUNCTION public.studio_spend_credits(p_user uuid, p_amount integer, p_reason text, p_meta jsonb DEFAULT NULL::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_balance integer;
begin
  select balance into v_balance from public.studio_credits where user_id = p_user for update;
  if v_balance is null or v_balance < p_amount then
    return -1;
  end if;
  update public.studio_credits set balance = balance - p_amount, updated_at = now()
   where user_id = p_user returning balance into v_balance;
  insert into public.studio_credit_ledger (user_id, delta, reason, meta, balance_after)
    values (p_user, -p_amount, p_reason, p_meta, v_balance);
  return v_balance;
end $function$;

-- ─── Triggers ───
CREATE TRIGGER ensure_album_slug_namespace_unique BEFORE INSERT OR UPDATE OF slug, custom_slug ON public.albums FOR EACH ROW EXECUTE FUNCTION ensure_album_slug_namespace_unique();
CREATE TRIGGER collections_set_updated_at BEFORE UPDATE ON public.collections FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER subscriptions_set_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Lock the functions down ───
-- Postgres grants EXECUTE on every new function to PUBLIC, which is how two SECURITY
-- DEFINER functions became callable with the publishable key. scripts/check-db.mjs fails
-- the build on any function that is.
revoke execute on function public.admin_growth_series(p_days integer) from public, anon, authenticated;
revoke execute on function public.admin_user_cohorts(p_months integer) from public, anon, authenticated;
revoke execute on function public.admin_user_overview(p_limit integer) from public, anon, authenticated;
revoke execute on function public.admin_weekday_series(p_days integer, p_tz text) from public, anon, authenticated;
revoke execute on function public.album_is_open(p_album_id uuid) from public, anon, authenticated;
revoke execute on function public.batch_set_sort_order(p_album_id uuid, p_ids uuid[], p_orders integer[]) from public, anon, authenticated;
revoke execute on function public.coalesce_error_event(p_level text, p_source text, p_message text, p_album_id uuid, p_context jsonb, p_ua text, p_window_seconds integer) from public, anon, authenticated;
revoke execute on function public.ensure_album_slug_namespace_unique() from public, anon, authenticated;
revoke execute on function public.find_user_id_by_email(p_email text) from public, anon, authenticated;
revoke execute on function public.prune_error_events() from public, anon, authenticated;
revoke execute on function public.prune_rate_limit_events() from public, anon, authenticated;
revoke execute on function public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer) from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.studio_add_credits(p_user uuid, p_amount integer, p_reason text, p_meta jsonb) from public, anon, authenticated;
revoke execute on function public.studio_grant_monthly(p_user uuid, p_amount integer, p_month text) from public, anon, authenticated;
revoke execute on function public.studio_spend_credits(p_user uuid, p_amount integer, p_reason text, p_meta jsonb) from public, anon, authenticated;
