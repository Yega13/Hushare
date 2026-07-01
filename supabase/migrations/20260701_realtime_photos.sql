-- Migration: enable realtime on photos.
--
-- The album page subscribes to postgres_changes on public.photos (INSERT + DELETE,
-- filtered by album_id) to live-update the grid as media is added/removed. But the
-- supabase_realtime publication was empty, so no realtime event ever fired — newly
-- uploaded photos/videos only appeared after a manual page refresh.
--
-- Realtime respects RLS, so guests only receive events for photos they can already
-- read (the "photos readable when album is open" policy). Idempotent.

do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'photos'
  ) then
    alter publication supabase_realtime add table public.photos;
  end if;
end $$;

-- DELETE events must carry the old row's album_id so the client-side filter matches.
alter table public.photos replica identity full;
