// The live public schema, written down so a restore can be REHEARSED against it offline.
//
// The migrations in supabase/migrations do not build the database: the base tables were created
// before the project kept migrations, so applying all 71 of them into an empty Postgres yields six
// tables out of sixteen. That is fine for the drift check, which compares against the live schema,
// and useless for a rehearsal, which needs somewhere to restore INTO.
//
// So the shape of the real thing is introspected here, read-only, and checked in. It carries column
// names, types, nullability and primary keys -- enough to create the tables and enough for a dump's
// values to fail honestly if they do not fit. It carries NO DATA.
//
//   node scripts/db-schema-snapshot.mjs            (writes tests/fixtures/live-schema.json)
//
// Re-run it when the schema changes; tests/restore-core.test.ts and scripts/restore-rehearse.mjs
// both build their Postgres from it.

import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { connectionString } from './db-connection.mjs'

const OUT = path.join(process.cwd(), 'tests', 'fixtures', 'live-schema.json')

const client = new pg.Client({
  connectionString: connectionString('schema-snapshot'),
  ssl: { rejectUnauthorized: false },
})

async function main() {
  await client.connect()

  const { rows: cols } = await client.query(`
    select table_name, column_name, data_type, udt_name, is_nullable, ordinal_position
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, ordinal_position
  `)

  const { rows: pks } = await client.query(`
    select tc.table_name, kcu.column_name, kcu.ordinal_position
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY'
    order by tc.table_name, kcu.ordinal_position
  `)

  const tables = {}
  for (const c of cols) {
    const t = (tables[c.table_name] ??= { columns: [], primaryKey: [] })
    // udt_name is the honest one: information_schema reports an array as 'ARRAY' and a domain by
    // its domain name, and a restore has to write the actual type.
    t.columns.push({ name: c.column_name, type: c.data_type, udt: c.udt_name, nullable: c.is_nullable === 'YES' })
  }
  for (const p of pks) tables[p.table_name]?.primaryKey.push(p.column_name)

  const snapshot = {
    takenAt: new Date().toISOString(),
    note: 'Column names and types only, never data. See scripts/db-schema-snapshot.mjs.',
    tables,
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`)
  const n = Object.keys(tables).length
  console.log(`wrote ${OUT.replace(process.cwd(), '.')} — ${n} tables, ${cols.length} columns`)
}

main()
  .catch((e) => { console.error('snapshot failed:', e.message); process.exitCode = 1 })
  .finally(() => client.end())
