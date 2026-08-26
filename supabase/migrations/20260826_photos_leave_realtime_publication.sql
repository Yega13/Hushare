-- Take `photos` out of the realtime publication and give back its default replica identity.
--
-- M12 from the 2026-08-20 audit, still open on 2026-08-26.
--
-- WHAT IT WAS COSTING. `REPLICA IDENTITY FULL` makes Postgres write the ENTIRE OLD ROW into the WAL
-- for every UPDATE and every DELETE on the table. photos is the busiest table in the product —
-- 10,095 rows, and every upload, approval, reorder and hide touches it — so this is write
-- amplification on the exact path that is already under strain during an event.
--
-- WHY IT IS PAID FOR NOTHING. The postgres_changes listeners it existed to serve were removed. That
-- removal was itself a SECURITY fix: Supabase only delivers postgres_changes to a client that can
-- SELECT the table under RLS, so supporting it meant granting anon SELECT on photos — and the anon
-- key ships in the page source, which let anyone enumerate 2,951 photo rows with working URLs
-- without knowing a single album link. Deletes, reorders and settings now travel as contentless
-- Broadcast pings instead (see src/lib/broadcast.ts).
--
-- Verified before applying: no `.on('postgres_changes'` subscription exists anywhere in src/.
--
-- BROADCAST IS UNAFFECTED, which is the thing to be sure of before running this. Broadcast is an
-- HTTP endpoint on the Realtime server (/realtime/v1/api/broadcast); it does not read the WAL and
-- does not care what the publication contains. Live album updates keep working exactly as they do
-- now. Re-adding the table would be one line if a postgres_changes listener were ever wanted again
-- — but see the paragraph above before wanting one.
--
-- Idempotent — safe to re-run.

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'photos'
  ) then
    alter publication supabase_realtime drop table public.photos;
  end if;
end $$;

alter table public.photos replica identity default;
