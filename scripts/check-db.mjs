// Database drift check.
//
// Asserts that the critical tables / columns / functions / RLS policies the
// application depends on actually exist in the live database. Exits non-zero if
// anything is missing — wire this into CI so schema drift can never ship silently
// (this is the class of bug that caused "Album not found" and blank albums).
//
// Connection: same as scripts/db-migrate.mjs (SUPABASE_DB_URL or local password file).
//
//   node scripts/check-db.mjs

import { readFileSync, existsSync } from 'node:fs'
import pg from 'pg'

const POOLER_HOST = 'aws-1-ap-southeast-2.pooler.supabase.com'
const DB_USER = 'postgres.yqngmyjquwemwogdyuwv'

function connectionString() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL
  if (existsSync('Supabase Password.txt')) {
    const pw = encodeURIComponent(readFileSync('Supabase Password.txt', 'utf8').trim())
    return `postgresql://${DB_USER}:${pw}@${POOLER_HOST}:5432/postgres`
  }
  console.error('[check-db] No SUPABASE_DB_URL and no local password file. Aborting.')
  process.exit(1)
}

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
const MUST_DENY_ANON = ['photos', 'active_sessions', 'schema_migrations']

const client = new pg.Client({ connectionString: connectionString(), ssl: { rejectUnauthorized: false } })
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

if (missing.length) {
  console.error('[check-db] SCHEMA DRIFT — the live DB is missing:')
  for (const m of missing) console.error('  ✗ ' + m)
  console.error('\nRun `npm run db:migrate` (or add a migration) to fix.')
  process.exit(1)
}
console.log('[check-db] ✓ live schema has all required tables, columns, functions and policies.')
