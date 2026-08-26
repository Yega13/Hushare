// Database drift check.
//
// Asserts that the critical tables / columns / functions / RLS policies the
// application depends on actually exist in the live database. Exits non-zero if
// anything is missing — wire this into CI so schema drift can never ship silently
// (this is the class of bug that caused "Album not found" and blank albums).
//
// Connection: shared with scripts/db-migrate.mjs — see scripts/db-connection.mjs.
//
//   node scripts/check-db.mjs

import pg from 'pg'
import { connectionString } from './db-connection.mjs'

// What the application requires. Add to this whenever code starts depending on a
// new column/table/function/policy — that keeps the check honest.
const REQUIRED_COLUMNS = {
  albums: ['password_hash', 'reveal_at', 'owner_token', 'slug', 'custom_slug', 'retired_at', 'guest_uploads_enabled'],
  photos: ['album_id', 'storage_backend', 'storage_path', 'stream_uid', 'face_ids', 'sort_order', 'thumb_url'],
  subscriptions: ['user_id', 'polar_subscription_id', 'tier', 'status', 'current_period_end'],
  collections: ['user_id', 'slug', 'name'],
  collection_albums: ['collection_id', 'album_id'],
  rate_limit_events: ['key', 'created_at'],
  pending_stream_uploads: ['stream_uid', 'album_id'],
}
const REQUIRED_FUNCTIONS = ['album_is_open', 'set_updated_at', 'batch_set_sort_order', 'prune_rate_limit_events']
const REQUIRED_POLICIES = [
  // 'photos readable when album is open' was REMOVED on purpose, see
  // supabase/migrations/20260814_close_photo_enumeration.sql. It let anyone holding the public anon
  // key enumerate every photo on the platform without knowing an album link. Photos are served
  // exclusively through the service-role client after server-side access checks. Do not re-add it.
  { table: 'subscriptions', name: 'users can read own subscription' },
]

// Tables that must NOT be reachable with the public anon key. These are regression guards for real
// leaks that shipped: photos (2951 rows enumerable), active_sessions (live album slugs).
//
// The list is now EVERY application table, because on 2026-08-26 an audit found thirteen of them
// still carrying a live anon SELECT grant. Nothing was exposed — RLS was on with no permissive
// policy, so anon reads came back empty, verified against the live REST API — but that made the
// whole thing rest on one layer. albums carries owner_token and password_hash; subscriptions
// carries billing identifiers. Adding a single permissive policy while building a feature would
// have published those to anyone holding the key that ships in the browser bundle.
//
// Nothing in the browser reads a table directly (auth and realtime Broadcast only), so the grants
// were pure surface area and were revoked. This keeps them revoked.
const MUST_DENY_ANON = [
  'photos', 'active_sessions', 'schema_migrations', 'profiles',
  'albums', 'collections', 'collection_albums', 'subscriptions', 'statements',
  'error_events', 'pending_stream_uploads', 'poll_votes', 'rate_limit_events',
  'studio_credits', 'studio_credit_ledger', 'studio_generations', 'system_state',
]

const client = new pg.Client({ connectionString: connectionString('check-db'), ssl: { rejectUnauthorized: false } })
await client.connect()

const cols = (await client.query(
  `select table_name, column_name from information_schema.columns where table_schema='public'`
)).rows
const have = {}
for (const r of cols) (have[r.table_name] ||= new Set()).add(r.column_name)

const fns = new Set((await client.query(
  `select proname from pg_proc where pronamespace='public'::regnamespace`
)).rows.map((r) => r.proname))

const pols = (await client.query(
  `select tablename, policyname from pg_policies where schemaname='public'`
)).rows.map((r) => r.tablename + '::' + r.policyname)

// Regression guard: these tables must not be selectable by the public anon key.
const anonGrants = (await client.query(
  `select table_name from information_schema.role_table_grants
   where table_schema='public' and grantee='anon' and privilege_type='SELECT'`
)).rows.map((r) => r.table_name)

// FUNCTIONS, which are the ones that keep getting missed — twice now, one at a time.
//
// Postgres grants EXECUTE on every new function to PUBLIC, so a SECURITY DEFINER function is
// world-callable through PostgREST the moment it is created unless somebody remembers to revoke.
// batch_set_sort_order sat like that: SECURITY DEFINER, an UPDATE, reachable with the publishable
// key that ships in every page. Anyone could rewrite the photo order of any album.
//
// Read from the raw ACL, NOT has_function_privilege(): that returns true for anon whether the
// grant is direct or inherited from PUBLIC, so it cannot tell "granted" from "left at the default",
// and a revoke aimed at anon alone looks like it worked while changing nothing. A default-granted
// function shows an entry with an EMPTY grantee -- `=X/owner` -- which is how PUBLIC is spelled.
const publicExecutable = (await client.query(
  `select p.proname, p.prosecdef
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
      and (
        p.proacl is null
        or exists (
          select 1 from aclexplode(p.proacl) a
          where a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole)
        )
      )
    order by p.proname`
)).rows

await client.end()

const missing = []
for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
  if (!have[table]) { missing.push(`table ${table}`); continue }
  for (const c of columns) if (!have[table].has(c)) missing.push(`column ${table}.${c}`)
}
for (const f of REQUIRED_FUNCTIONS) if (!fns.has(f)) missing.push(`function ${f}()`)
for (const p of REQUIRED_POLICIES) if (!pols.includes(p.table + '::' + p.name)) missing.push(`policy ${p.table} "${p.name}"`)

// Exposure is drift too, and the more dangerous direction: a missing column breaks a page, but a
// stray anon grant publishes customer data. Reported alongside the missing-things list.
const exposed = MUST_DENY_ANON.filter((t) => anonGrants.includes(t))
if (exposed.length) {
  console.error('[check-db] SECURITY DRIFT - these tables are readable with the PUBLIC anon key:')
  for (const t of exposed) console.error(`  !! ${t} - revoke select on ${t} from anon`)
  process.exit(1)
}

// No allowlist on purpose. Nothing in this product needs a function callable straight from the
// browser -- every RPC goes through the service-role client after a server-side check -- so the
// correct number is zero, and "zero" is a rule that cannot rot the way a list of exceptions does.
if (publicExecutable.length) {
  console.error('[check-db] SECURITY DRIFT - these functions are callable with the PUBLIC anon key:')
  for (const f of publicExecutable) {
    console.error(`  !! ${f.proname}()${f.prosecdef ? ' [SECURITY DEFINER - bypasses RLS]' : ''}`)
  }
  console.error('  Fix: revoke execute on function public.<name>(<args>) from public;')
  console.error('  (from PUBLIC, not from anon - see supabase/migrations/20260826_revoke_function_execute_public.sql)')
  process.exit(1)
}

if (missing.length) {
  console.error('[check-db] SCHEMA DRIFT — the live DB is missing:')
  for (const m of missing) console.error('  ✗ ' + m)
  console.error('\nRun `npm run db:migrate` (or add a migration) to fix.')
  process.exit(1)
}
console.log('[check-db] ✓ live schema has all required tables, columns, functions and policies.')
