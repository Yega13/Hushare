// Regenerate schema.sql from the LIVE database.
//
// WHY THIS EXISTS: schema.sql is the file you rebuild from when the database is gone. It was
// hand-maintained, and on 2026-08-26 it was missing 12 of 18 tables and 64 columns — including
// albums.face_finder_enabled, hide_branding and bib_search_enabled. Backups had just started
// working; restoring 11,000 rows into that schema would have failed. A backup you cannot restore
// is not a backup, so the schema has to be generated, not remembered.
//
//   node scripts/dump-schema.mjs            write schema.sql
//   node scripts/dump-schema.mjs --check    exit 1 if it is out of date (for CI)
import fs from 'node:fs'
import pg from 'pg'
import { connectionString } from './db-connection.mjs'

const CHECK = process.argv.includes('--check')
const c = new pg.Client({ connectionString: connectionString('dump-schema'), ssl: { rejectUnauthorized: false } })
await c.connect()

const q = async (sql, params = []) => (await c.query(sql, params)).rows

const tables = (await q(`select table_name from information_schema.tables
  where table_schema='public' and table_type='BASE TABLE' order by table_name`)).map(r => r.table_name)

const out = []
out.push('-- ============================================================')
out.push('-- Hushare database schema — GENERATED, do not hand-edit.')
out.push('--')
out.push('-- Regenerate with:  node scripts/dump-schema.mjs')
out.push('-- Verify with:      node scripts/dump-schema.mjs --check')
out.push('--')
out.push('-- This is the file the database is rebuilt from. It was hand-maintained until 2026-08-26,')
out.push('-- by which point it was missing 12 of 18 tables and 64 columns, so a restore of a good')
out.push('-- backup would have failed. Generated from the live database instead of remembered.')
out.push('--')
out.push('-- Row-level security is enabled on every table and NO permissive policies are created:')
out.push('-- the application reaches these through the service-role client after its own checks.')
out.push('-- Grants to anon/authenticated are deliberately absent — see')
out.push('-- supabase/migrations/20260826_revoke_anon_select.sql.')
out.push('-- ============================================================')
out.push('')

for (const t of tables) {
  const cols = await q(`select column_name, data_type, udt_name, is_nullable, column_default,
      character_maximum_length
    from information_schema.columns where table_schema='public' and table_name=$1
    order by ordinal_position`, [t])
  out.push(`-- ─── ${t} ───`)
  out.push(`create table if not exists public.${t} (`)
  const lines = cols.map(col => {
    let type = col.data_type === 'USER-DEFINED' ? col.udt_name : col.data_type
    if (type === 'character varying' && col.character_maximum_length) type = `varchar(${col.character_maximum_length})`
    if (type === 'ARRAY') type = `${col.udt_name.replace(/^_/, '')}[]`
    let line = `  ${col.column_name} ${type}`
    if (col.column_default) line += ` default ${col.column_default}`
    if (col.is_nullable === 'NO') line += ' not null'
    return line
  })
  const pk = await q(`select a.attname from pg_index i
    join pg_attribute a on a.attrelid=i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = $1::regclass and i.indisprimary order by array_position(i.indkey, a.attnum)`, [`public.${t}`])
  if (pk.length) lines.push(`  primary key (${pk.map(r => r.attname).join(', ')})`)
  out.push(lines.join(',\n'))
  out.push(');')
  out.push(`alter table public.${t} enable row level security;`)
  out.push('')
}

out.push('-- ─── Indexes ───')
const idx = await q(`select indexdef from pg_indexes where schemaname='public'
  and indexname not like '%_pkey' order by tablename, indexname`)
for (const r of idx) out.push(r.indexdef.replace(/^CREATE INDEX /, 'create index if not exists ').replace(/^CREATE UNIQUE INDEX /, 'create unique index if not exists ') + ';')
out.push('')

out.push('-- ─── Functions ───')
const fns = await q(`select pg_get_functiondef(p.oid) as def from pg_proc p
  where p.pronamespace='public'::regnamespace and p.prokind='f' order by p.proname`)
for (const r of fns) { out.push(r.def.trim() + ';'); out.push('') }

out.push('-- ─── Triggers ───')
const trg = await q(`select pg_get_triggerdef(t.oid) as def from pg_trigger t
  join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and not t.tgisinternal order by c.relname, t.tgname`)
for (const r of trg) out.push(r.def + ';')
out.push('')

out.push('-- ─── Lock the functions down ───')
out.push('-- Postgres grants EXECUTE on every new function to PUBLIC, which is how two SECURITY')
out.push('-- DEFINER functions became callable with the publishable key. scripts/check-db.mjs fails')
out.push('-- the build on any function that is.')
for (const r of await q(`select p.proname, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' order by p.proname`)) {
  out.push(`revoke execute on function public.${r.proname}(${r.args}) from public, anon, authenticated;`)
}
out.push('')

await c.end()

const text = out.join('\n')
if (CHECK) {
  const current = fs.existsSync('schema.sql') ? fs.readFileSync('schema.sql', 'utf8') : ''
  if (current.trim() !== text.trim()) {
    console.error('[dump-schema] schema.sql is OUT OF DATE with the live database.')
    console.error('  Run: node scripts/dump-schema.mjs')
    process.exit(1)
  }
  console.log('[dump-schema] ✓ schema.sql matches the live database.')
} else {
  fs.writeFileSync('schema.sql', text)
  console.log(`[dump-schema] wrote schema.sql — ${tables.length} tables, ${idx.length} indexes, ${fns.length} functions, ${trg.length} triggers`)
}
