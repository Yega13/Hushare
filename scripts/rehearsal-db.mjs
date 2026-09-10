// A real Postgres, built from the file the database is REBUILT from.
//
// The rehearsal used to create tables from a JSON snapshot of column names and types. That proved
// the restore's mechanics and nothing about its constraints -- and a review showed the difference
// was the whole game: `albums.cover_photo_id` references `photos.id` while `photos.album_id`
// references `albums.id`, so writing albums first violates a foreign key the snapshot did not
// carry, and the real restore would have died on its first table having written nothing.
//
// So the rehearsal builds from `schema.sql`, which is generated from the live database, is what a
// recovery would actually run, and is already guarded against drift by the deploy
// (`node scripts/dump-schema.mjs --check`). One artifact, one source of truth (rule 13), and no
// second fixture to go stale behind everyone's back.
//
// WHAT IS SCAFFOLDED, and why each: Supabase owns the `auth` schema, so it is created here with
// the columns `schema.sql` refers to. The three Supabase roles are created so GRANT statements
// resolve. Nothing else is faked: every table, foreign key, check, unique constraint, default and
// policy in `schema.sql` is applied as written.

import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

/** The parts of a Supabase project that are not in schema.sql because Supabase owns them. */
export const SUPABASE_SCAFFOLD = `
  create schema if not exists auth;
  create schema if not exists extensions;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
  end $$;
  create table if not exists auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb,
    created_at timestamptz default now(),
    last_sign_in_at timestamptz
  );
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create or replace function auth.role() returns text language sql stable as $$ select 'service_role'::text $$;
`

/**
 * Split SQL into statements on semicolons that are not inside a string or a $$ body. Naive
 * splitting cuts every function in this file in half, and `exec`ing the whole thing at once means
 * one unsupported statement loses all 986 lines -- which is how the first attempt reported zero
 * tables and a misleading "FAILED".
 */
export function splitSql(sql) {
  const out = []
  let buf = ''
  let i = 0
  let quote = null      // "'" or '"' when inside one
  let dollar = null     // the tag, e.g. '$$' or '$func$', when inside a dollar-quoted body
  while (i < sql.length) {
    const c = sql[i]
    if (dollar) {
      if (sql.startsWith(dollar, i)) { buf += dollar; i += dollar.length; dollar = null; continue }
      buf += c; i++; continue
    }
    if (quote) {
      buf += c
      if (c === quote) quote = null
      else if (c === '\\') { buf += sql[i + 1] ?? ''; i++ }
      i++
      continue
    }
    if (c === '-' && sql[i + 1] === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue }
    if (c === "'" || c === '"') { quote = c; buf += c; i++; continue }
    const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
    if (tag) { dollar = tag[0]; buf += tag[0]; i += tag[0].length; continue }
    if (c === ';') { if (buf.trim()) out.push(buf.trim()); buf = ''; i++; continue }
    buf += c; i++
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

/**
 * A Postgres holding the real schema. Returns the database and the statements that did not apply,
 * so a caller can decide whether the gap matters instead of a silent partial build.
 */
export async function buildRehearsalDb(schemaSql = readFileSync('schema.sql', 'utf8')) {
  const db = await PGlite.create()
  await db.exec(SUPABASE_SCAFFOLD)
  const failed = []
  for (const statement of splitSql(schemaSql)) {
    try { await db.exec(statement) }
    catch (e) { failed.push({ statement: statement.slice(0, 90).replace(/\s+/g, ' '), error: String(e.message).split('\n')[0] }) }
  }
  return { db, failed }
}

/** What the built database actually enforces, for a rehearsal that has to say so out loud. */
export async function describeConstraints(db) {
  const q = async (sql) => Number((await db.query(sql)).rows[0].n)
  return {
    tables: await q(`select count(*)::int n from information_schema.tables where table_schema='public'`),
    foreignKeys: await q(`select count(*)::int n from pg_constraint where contype='f'`),
    checks: await q(`select count(*)::int n from pg_constraint where contype='c'`),
    uniques: await q(`select count(*)::int n from pg_constraint where contype='u'`),
    notNulls: await q(`select count(*)::int n from information_schema.columns where table_schema='public' and is_nullable='NO'`),
  }
}
