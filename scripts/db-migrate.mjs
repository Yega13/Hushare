// Tracked database migration runner.
//
// Applies every file in supabase/migrations/*.sql that hasn't been applied yet,
// in filename order, each inside its own transaction, and records it in a
// `schema_migrations` table so it never runs twice. Migrations must be idempotent.
//
// THIS is what keeps the live DB in sync with the code: all schema changes go in a
// migration file, and this runner applies them. Never hand-edit the database.
//
// Connection: shared with scripts/check-db.mjs — see scripts/db-connection.mjs. Set
// SUPABASE_DB_URL (the Supabase pooler "session" connection string) in CI; locally it
// falls back to the password file in ~/.hushare-secrets/, outside this repository.
//
//   node scripts/db-migrate.mjs

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { connectionString } from './db-connection.mjs'

const MIGRATIONS_DIR = 'supabase/migrations'
// Non-secret connection coordinates (project ref + pooler host). Password only is secret.

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
const client = new pg.Client({ connectionString: connectionString('db-migrate'), ssl: { rejectUnauthorized: false } })

await client.connect()
await client.query(`
  create table if not exists public.schema_migrations (
    name        text        primary key,
    applied_at  timestamptz not null default now()
  )
`)
const done = new Set(
  (await client.query('select name from public.schema_migrations')).rows.map((r) => r.name)
)

let applied = 0
for (const file of files) {
  if (done.has(file)) {
    console.log('· already applied: ' + file)
    continue
  }
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
  try {
    await client.query('begin')
    await client.query(sql)
    await client.query('insert into public.schema_migrations(name) values($1)', [file])
    await client.query('commit')
    console.log('✓ applied: ' + file)
    applied++
  } catch (e) {
    await client.query('rollback').catch(() => {})
    console.error('✗ FAILED: ' + file + '\n  ' + (e instanceof Error ? e.message : String(e)))
    await client.end()
    process.exit(1)
  }
}
console.log(applied ? `\n[db-migrate] ${applied} migration(s) applied.` : '\n[db-migrate] up to date.')
await client.end()
