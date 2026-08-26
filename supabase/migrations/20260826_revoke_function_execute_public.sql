-- The revoke that actually works. Read 20260826_revoke_function_execute.sql first — it did nothing.
--
-- WHY THE FIRST ONE FAILED, because this is a trap worth only falling into once:
--
-- Postgres grants EXECUTE on every new function to the pseudo-role PUBLIC. `anon` and
-- `authenticated` were therefore never granted anything DIRECTLY — they could call these functions
-- by virtue of being members of PUBLIC. `revoke execute ... from anon, authenticated` removes a
-- grant that was never there and leaves the one that matters untouched.
--
-- Worse, the check agrees with you: has_function_privilege('anon', oid, 'EXECUTE') keeps returning
-- true, because it answers "can this role execute it", not "was it granted directly". The only
-- honest reading is the raw ACL. A default-granted function shows a leading `=X/owner` entry with
-- an EMPTY grantee, which is how PUBLIC is spelled:
--
--   batch_set_sort_order   {=X/postgres,postgres=X/postgres,service_role=X/postgres}   <- PUBLIC
--   prune_rate_limit_events    {postgres=X/postgres,service_role=X/postgres}           <- revoked
--
-- prune_rate_limit_events and studio_add_credits were fixed correctly earlier and show the second
-- shape. These two were left in the first.
--
-- Verified after applying by invoking both through PostgREST with the publishable key.
--
-- Idempotent — safe to re-run.

revoke execute on function public.batch_set_sort_order(uuid, uuid[], integer[]) from public;
revoke execute on function public.album_is_open(uuid) from public;

-- Belt and braces: revoke the direct grants too, so a future GRANT ... TO anon does not quietly
-- reopen this without anyone noticing the ACL changed shape.
revoke execute on function public.batch_set_sort_order(uuid, uuid[], integer[]) from anon, authenticated;
revoke execute on function public.album_is_open(uuid) from anon, authenticated;
