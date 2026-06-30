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
  { table: 'photos', name: 'photos readable when album is open' },
  { table: 'subscriptions', name: 'users can read own subscription' },
]

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

await client.end()

const missing = []
for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
  if (!have[table]) { missing.push(`table ${table}`); continue }
  for (const c of columns) if (!have[table].has(c)) missing.push(`column ${table}.${c}`)
}
for (const f of REQUIRED_FUNCTIONS) if (!fns.has(f)) missing.push(`function ${f}()`)
for (const p of REQUIRED_POLICIES) if (!pols.includes(p.table + '::' + p.name)) missing.push(`policy ${p.table} "${p.name}"`)

if (missing.length) {
  console.error('[check-db] SCHEMA DRIFT — the live DB is missing:')
  for (const m of missing) console.error('  ✗ ' + m)
  console.error('\nRun `npm run db:migrate` (or add a migration) to fix.')
  process.exit(1)
}
console.log('[check-db] ✓ live schema has all required tables, columns, functions and policies.')
