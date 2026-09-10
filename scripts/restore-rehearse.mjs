// REHEARSE THE RESTORE. A backup nobody has ever restored is a guess.
//
// This boots a real Postgres in-process (PGlite), builds it from `schema.sql` -- the file the
// database is actually rebuilt from, generated from the live database and guarded against drift by
// the deploy -- restores an actual backup file into it, and then CHECKS the result instead of
// trusting the exit code: row counts against the dump, a field-by-field comparison of sampled rows
// so arrays, jsonb and timestamps are proven to round-trip, a dry run that must write nothing, and
// a second pass that must insert nothing.
//
// IT BUILDS THE CONSTRAINTS, and that is the point. The first version created tables from a
// snapshot of column names and types, so its database had no foreign keys, no NOT NULLs, no CHECKs
// and no unique constraints -- and it passed while the real restore was broken: `albums`
// references `photos` and `photos` references `albums`, a cycle no insert order can satisfy, so
// the restore died on its first table having written nothing. A rehearsal against a target that
// cannot fail is not a rehearsal.
//
// Nothing here touches production. schema.sql is a file, the backup is a file.
//
//   node scripts/restore-rehearse.mjs                          (newest file in backups/)
//   node scripts/restore-rehearse.mjs backups/hushare-....json.gz
//
// It exits non-zero if any check fails, so it can be believed.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { buildRehearsalDb, describeConstraints } from './rehearsal-db.mjs'
import { applyRestore } from './restore-core.mjs'

function newestBackup() {
  const dir = path.join(process.cwd(), 'backups')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json.gz')).sort()
  if (!files.length) throw new Error('no backup files in backups/')
  return path.join(dir, files[files.length - 1])
}

function sample(rows, n) {
  if (rows.length <= n) return rows
  const step = Math.floor(rows.length / n)
  return Array.from({ length: n }, (_, i) => rows[i * step])
}

/** Postgres hands back a Date for timestamptz and the dump holds a string; compare as instants. */
function sameValue(a, b) {
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : Date.parse(a)
    const tb = b instanceof Date ? b.getTime() : Date.parse(b)
    return Number.isNaN(ta) && Number.isNaN(tb) ? String(a) === String(b) : ta === tb
  }
  if (a === null || b === null) return a === b
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return String(a) === String(b)
}

async function primaryKeyOf(db, table) {
  const { rows } = await db.query(`
    select kcu.column_name from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY' and tc.table_name = $1
    order by kcu.ordinal_position`, [table])
  return rows.map((r) => r.column_name)
}

export async function rehearse(file) {
  const dump = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString())

  console.log(`  backup:   ${path.relative(process.cwd(), file)}`)
  console.log(`  taken:    ${dump.meta?.takenAt ?? 'unknown'}`)
  if (dump.meta?.skipped?.length) console.log(`  skipped at backup time: ${dump.meta.skipped.join(', ')}`)

  const { db, failed } = await buildRehearsalDb()
  const failures = []
  for (const f of failed) failures.push(`schema.sql statement did not apply: ${f.error} — ${f.statement}`)

  const enforced = await describeConstraints(db)
  console.log(`  schema:   schema.sql — ${enforced.tables} tables, ${enforced.foreignKeys} foreign keys, `
    + `${enforced.checks} checks, ${enforced.uniques} unique, ${enforced.notNulls} not-null columns`)

  // A table in the backup that the schema no longer has is the shape of an old dump, not a fault.
  const gone = Object.keys(dump.tables ?? {}).filter((t) => !(t in dump.tables) || false)
  if (gone.length) console.log(`  dropped since the backup: ${gone.join(', ')}`)

  // 1. The dry run must write NOTHING. Asserted, not assumed.
  const dry = await applyRestore(db, dump, { apply: false })
  for (const t of dry.tables) {
    const { rows: [{ count }] } = await db.query(`select count(*)::int as count from "${t.table}"`)
    if (Number(count) !== 0) failures.push(`dry run wrote ${count} rows into ${t.table}`)
  }
  const inexact = dry.tables.filter((t) => !t.exact).map((t) => t.table)
  console.log(`\n  dry run:  would insert ${dry.totalWould.toLocaleString('en-US')} rows, wrote 0`
    + (inexact.length ? ` (estimated, no single-column key: ${inexact.join(', ')})` : ' (counted by key)'))

  // 2. The real thing, into a schema that can refuse it.
  const started = Date.now()
  let res
  try {
    res = await applyRestore(db, dump, { apply: true })
  } catch (e) {
    console.error(`\n  RESTORE FAILED: ${e instanceof Error ? e.message : String(e)}`)
    const { rows: [{ count }] } = await db.query('select count(*)::int as count from albums')
    console.error(`  albums in the database afterwards: ${count} (the transaction rolled back)`)
    process.exitCode = 1
    return
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\n  restored in ${seconds}s:`)
  for (const s of res.skipped) console.log(`    ${s.table.padEnd(26)} SKIPPED — ${s.reason} (${s.rows} rows)`)
  for (const t of res.tables.filter((x) => x.dropped?.length)) {
    console.log(`    ${t.table.padEnd(26)} columns the schema no longer has, dropped: ${t.dropped.join(', ')}`)
  }
  for (const t of res.tables) {
    const expected = dump.tables[t.table].length
    const { rows: [{ count }] } = await db.query(`select count(*)::int as count from "${t.table}"`)
    const live = Number(count)
    const ok = live === expected && t.written === expected
    if (!ok) failures.push(`${t.table}: backup ${expected}, inserted ${t.written}, in database ${live}`)
    const note = t.skippedByConflict ? ` (${t.skippedByConflict} already present or refused by a unique constraint)` : ''
    console.log(`    ${t.table.padEnd(26)} ${String(live).padStart(6)} / ${String(expected).padEnd(6)} ${ok ? 'ok' : 'MISMATCH'}${note}`)
  }

  // 3. The values themselves, not just the counts: arrays, jsonb, timestamps, nulls.
  let compared = 0
  for (const [name, rows] of Object.entries(dump.tables)) {
    if (!rows.length) continue
    const pk = await primaryKeyOf(db, name)
    if (!pk.length) continue
    const droppedCols = new Set(res.tables.find((t) => t.table === name)?.dropped ?? [])
    for (const original of sample(rows, 5)) {
      const where = pk.map((c, i) => `"${c}" = $${i + 1}`).join(' and ')
      const { rows: [back] } = await db.query(`select * from "${name}" where ${where}`, pk.map((c) => original[c]))
      if (!back) { failures.push(`${name}: row ${pk.map((c) => original[c]).join('/')} did not come back`); continue }
      for (const [col, value] of Object.entries(original)) {
        if (droppedCols.has(col)) continue
        compared++
        if (!sameValue(back[col], value)) failures.push(`${name}.${col} changed: ${JSON.stringify(value)} -> ${JSON.stringify(back[col])}`)
      }
    }
  }
  console.log(`\n  values:   ${compared.toLocaleString('en-US')} fields compared across sampled rows`)

  // 4. Idempotent: restoring the same dump again must insert nothing and change nothing.
  const again = await applyRestore(db, dump, { apply: true })
  if (again.totalWritten !== 0) failures.push(`second restore inserted ${again.totalWritten} rows; it must insert none`)
  console.log(`  repeat:   second restore inserted ${again.totalWritten} rows`)

  if (res.authUsersInBackup) {
    console.log(`\n  NOTE: ${res.authUsersInBackup} auth.users rows are in the backup for reference and were NOT restored.`)
    console.log('  Supabase owns that schema; recreating accounts is an auth operation, not a row copy. The rows')
    console.log('  of collections, profiles and subscriptions that point at them restore anyway, because the')
    console.log('  foreign keys are deferred -- but those accounts do not exist until someone recreates them.')
  }
  console.log('\n  NOT PROVEN HERE: the photos themselves. The bytes live in R2 and Cloudflare Stream; this')
  console.log('  database holds only the pointers, and restoring it does not bring back a single image.')

  if (failures.length) {
    console.error(`\n  FAILED — ${failures.length} problem(s):`)
    for (const f of failures.slice(0, 20)) console.error(`    ${f}`)
    process.exitCode = 1
    return
  }
  console.log(`\n  REHEARSAL PASSED — ${res.totalWritten.toLocaleString('en-US')} rows restored into a real Postgres`)
  console.log(`  holding ${enforced.foreignKeys} foreign keys, ${enforced.checks} checks and ${enforced.uniques} unique constraints, and verified.`)
}

// Only when RUN, never when imported: tests/restore-core.test.ts imports from this module's
// neighbours, and a module that rehearses 11,166 rows as an import side effect is the same defect
// the restore itself was just cured of.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? newestBackup()
  rehearse(file).catch((e) => { console.error('rehearsal failed:', e.message); process.exitCode = 1 })
}
