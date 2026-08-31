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
out.push('-- Row-level security is enabled on every table; the application reaches these through the')
out.push('-- service-role client after its own checks. Any policy that DOES exist is emitted below,')
out.push('-- read from pg_policies — this line used to assert there were none, which was a hardcoded')
out.push('-- claim in the generator rather than a fact read from the database, and it was wrong.')
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

// ─── Constraints ───
//
// FOREIGN KEYS AND CHECKS WERE MISSING ENTIRELY, and that is the one omission that makes this
// file dangerous rather than merely incomplete. Rebuild from a version without them and the
// database comes up looking correct — then `delete from albums` stops cascading to photos, and
// lib/album-delete's "delete the row FIRST, it cascades" (which is true today) silently leaves
// every photo row behind pointing at bytes that were destroyed. Nothing throws. The storage
// audit then counts those destroyed keys as referenced, so real orphans hide behind them.
//
// Emitted after the tables so every referenced table exists, and each is guarded by a DO block
// rather than "if not exists" — Postgres has no such form for ADD CONSTRAINT.
// ─── Policies ───
// Read, never asserted. A restore that silently drops a policy grants less than production does
// (a locked-out feature) or, if one is ever permissive, more than it should.
out.push('-- ─── Row-level security policies ───')
const pols = await q(`select tablename, policyname, cmd, roles, qual, with_check
  from pg_policies where schemaname='public' order by tablename, policyname`)
if (pols.length === 0) {
  out.push('-- (none)')
} else {
  for (const r of pols) {
    out.push(`drop policy if exists "${r.policyname}" on public.${r.tablename};`)
    const rawRoles = r.roles
    const roles = (Array.isArray(rawRoles)
      ? rawRoles
      : String(rawRoles ?? '').replace(/^\{|\}$/g, '').split(',').filter(Boolean)
    ).join(', ') || 'public'
    let stmt = `create policy "${r.policyname}" on public.${r.tablename} for ${String(r.cmd).toLowerCase()} to ${roles}`
    if (r.qual) stmt += ` using (${r.qual})`
    if (r.with_check) stmt += ` with check (${r.with_check})`
    out.push(stmt + ';')
  }
}
out.push('')

out.push('-- ─── Constraints (foreign keys, checks, unique) ───')
const cons = await q(`select c.conrelid::regclass::text as tbl, c.conname,
    pg_get_constraintdef(c.oid) as def
  from pg_constraint c
  join pg_class rel on rel.oid = c.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public' and c.contype in ('f','c','u')
  order by c.conrelid::regclass::text, c.conname`)
for (const r of cons) {
  out.push(`do $$ begin`)
  out.push(`  if not exists (select 1 from pg_constraint where conname = '${r.conname}'`)
  out.push(`    and conrelid = '${r.tbl}'::regclass) then`)
  out.push(`    alter table ${r.tbl} add constraint ${r.conname} ${r.def};`)
  out.push(`  end if;`)
  out.push(`end $$;`)
}
out.push('')

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
