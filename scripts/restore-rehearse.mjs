// REHEARSE THE RESTORE. A backup nobody has ever restored is a guess.
//
// This boots a real Postgres in-process (PGlite), builds the tables from the live schema snapshot,
// restores an actual backup file into it, and then CHECKS the result instead of trusting the exit
// code: row counts against the dump, a deep comparison of sampled rows so arrays, jsonb and
// timestamps are proven to round-trip, and a second run to prove the restore is idempotent.
//
// Nothing here touches production. The snapshot is read-only introspection taken separately
// (scripts/db-schema-snapshot.mjs) and the backup is a file on disk.
//
//   node scripts/restore-rehearse.mjs                          (newest file in backups/)
//   node scripts/restore-rehearse.mjs backups/hushare-....json.gz
//
// It exits non-zero if any check fails, so it can be believed.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { PGlite } from '@electric-sql/pglite'
import { applyRestore } from './restore-core.mjs'

const SNAPSHOT = path.join(process.cwd(), 'tests', 'fixtures', 'live-schema.json')

/** The live schema as CREATE TABLE. Types come from udt_name, which is the honest one: an array is
 *  reported by information_schema as 'ARRAY' and only udt_name says what it is an array of. */
export function createTableSql(name, table) {
  const cols = table.columns.map((c) => {
    const type = c.udt.startsWith('_') ? `${c.udt.slice(1)}[]` : c.udt
    return `  "${c.name}" ${type}`
  })
  // The primary key is what makes ON CONFLICT DO NOTHING mean anything, so a rehearsal without it
  // would prove the opposite of what it claims: every row would insert, twice.
  if (table.primaryKey.length) cols.push(`  primary key (${table.primaryKey.map((c) => `"${c}"`).join(', ')})`)
  return `create table "${name}" (\n${cols.join(',\n')}\n)`
}

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

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? newestBackup()
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'))
  const dump = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString())

  console.log(`  backup:   ${path.relative(process.cwd(), file)}`)
  console.log(`  taken:    ${dump.meta?.takenAt ?? 'unknown'}`)
  console.log(`  schema:   snapshot of ${new Date(snapshot.takenAt).toISOString()} (${Object.keys(snapshot.tables).length} tables)`)
  if (dump.meta?.skipped?.length) console.log(`  skipped at backup time: ${dump.meta.skipped.join(', ')}`)

  const db = await PGlite.create()
  const failures = []

  // 1. Build the schema the dump has to fit.
  const dumpTables = Object.keys(dump.tables ?? {})
  const goneTables = []
  for (const name of dumpTables) {
    const table = snapshot.tables[name]
    // A table dropped since the backup is not a failure of the restore -- it is the shape of an old
    // dump, and the restore has to survive it rather than abandon the tables after it. Reported,
    // and the rehearsal goes on.
    if (!table) { goneTables.push(`${name} (${dump.tables[name].length} rows)`); continue }
    await db.exec(createTableSql(name, table))
  }
  if (goneTables.length) console.log(`  dropped since the backup: ${goneTables.join(', ')}`)

  // 2. The dry run must write NOTHING. Asserted, not assumed.
  const dry = await applyRestore(db, dump, { apply: false })
  for (const t of dry.tables) {
    const { rows: [{ count }] } = await db.query(`select count(*)::int as count from "${t.table}"`)
    if (Number(count) !== 0) failures.push(`dry run wrote ${count} rows into ${t.table}`)
  }
  console.log(`\n  dry run:  would insert ${dry.totalWould.toLocaleString('en-US')} rows, wrote 0`)

  // 3. The real thing.
  const started = Date.now()
  const res = await applyRestore(db, dump, { apply: true })
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
    console.log(`    ${t.table.padEnd(26)} ${String(live).padStart(6)} / ${String(expected).padEnd(6)} ${ok ? 'ok' : 'MISMATCH'}`)
  }

  // 4. The values themselves, not just the counts: arrays, jsonb, timestamps, nulls.
  let compared = 0
  for (const [name, rows] of Object.entries(dump.tables)) {
    if (!rows.length) continue
    const pk = snapshot.tables[name]?.primaryKey
    if (!pk?.length) continue
    for (const original of sample(rows, 5)) {
      const where = pk.map((c, i) => `"${c}" = $${i + 1}`).join(' and ')
      const { rows: [back] } = await db.query(`select * from "${name}" where ${where}`, pk.map((c) => original[c]))
      if (!back) { failures.push(`${name}: row ${pk.map((c) => original[c]).join('/')} did not come back`); continue }
      // A column the schema has since dropped cannot come back, and saying so once in the report
      // above is honest; counting it as a changed value 83 times is noise.
      const gone = new Set(res.tables.find((t) => t.table === name)?.dropped ?? [])
      for (const [col, value] of Object.entries(original)) {
        if (gone.has(col)) continue
        compared++
        if (!sameValue(back[col], value)) {
          failures.push(`${name}.${col} changed: ${JSON.stringify(value)} -> ${JSON.stringify(back[col])}`)
        }
      }
    }
  }
  console.log(`\n  values:   ${compared.toLocaleString('en-US')} fields compared across sampled rows`)

  // 5. Idempotent: restoring the same dump again must insert nothing and change nothing.
  const again = await applyRestore(db, dump, { apply: true })
  if (again.totalWritten !== 0) failures.push(`second restore inserted ${again.totalWritten} rows; it must insert none`)
  console.log(`  repeat:   second restore inserted ${again.totalWritten} rows`)

  if (res.authUsersInBackup) {
    console.log(`\n  NOTE: ${res.authUsersInBackup} auth.users rows are in the backup for reference and were NOT restored.`)
    console.log('  Supabase owns that schema; recreating accounts is an auth operation, not a row copy.')
  }

  if (failures.length) {
    console.error(`\n  FAILED — ${failures.length} problem(s):`)
    for (const f of failures.slice(0, 20)) console.error(`    ${f}`)
    process.exitCode = 1
    return
  }
  console.log(`\n  REHEARSAL PASSED — ${res.totalWritten.toLocaleString('en-US')} rows restored into a real Postgres and verified.`)
}

main().catch((e) => { console.error('rehearsal failed:', e.message); process.exitCode = 1 })
