// Restore rows from a backup written by scripts/backup-db.mjs.
//
// A backup nobody has ever restored is a guess, not a backup. This exists so the restore path is
// something that has actually been run before the day it matters.
//
// SAFETY, because this is the script most capable of destroying the thing it protects:
//   * DRY RUN BY DEFAULT. It reports what it would insert and writes nothing until --apply.
//   * It only ever INSERTS. There is no delete, no truncate, no update -- a restore cannot be used
//     to wipe live data, and pointing it at a healthy database is a no-op rather than a disaster.
//   * Every insert is ON CONFLICT DO NOTHING, so rows that still exist are left exactly as they
//     are. Newer data is never overwritten by an older dump.
//   * Values go through parameterised queries, so timestamps, arrays and jsonb round-trip through
//     the driver instead of through escaping written by hand.
//
// This means the tool restores what is MISSING. Recovering from "a table was wrongly modified"
// is a different operation and deliberately not automated here.
//
// USAGE
//   node scripts/restore-db.mjs backups/hushare-<stamp>.json.gz              (dry run)
//   node scripts/restore-db.mjs backups/hushare-<stamp>.json.gz --apply
//   node scripts/restore-db.mjs <file> --apply --table albums               (one table)

import fs from 'node:fs'
import zlib from 'node:zlib'
import pg from 'pg'
import { connectionString } from './db-connection.mjs'

const args = process.argv.slice(2)
const file = args.find(a => !a.startsWith('--'))
const apply = args.includes('--apply')
const only = args[args.indexOf('--table') + 1]
const onlyTable = args.includes('--table') ? only : null

if (!file) {
  console.error('usage: node scripts/restore-db.mjs <backup.json.gz> [--apply] [--table <name>]')
  process.exit(1)
}

// Parents before children, so a foreign key never points at a row that has not been written yet.
// Anything not named here is restored afterwards in whatever order it appears.
const ORDER = ['albums', 'photos', 'subscriptions', 'error_events']

const client = new pg.Client({
  connectionString: connectionString('restore'),
  ssl: { rejectUnauthorized: false },
})

const CHUNK = 200

async function insertRows(table, rows) {
  const cols = Object.keys(rows[0])
  const quoted = cols.map(c => `"${c}"`).join(', ')
  let written = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const values = []
    const placeholders = chunk.map((row, r) =>
      `(${cols.map((c, k) => { values.push(row[c]); return `$${r * cols.length + k + 1}` }).join(', ')})`,
    ).join(', ')
    const res = await client.query(
      `insert into "${table}" (${quoted}) values ${placeholders} on conflict do nothing`,
      values,
    )
    written += res.rowCount
  }
  return written
}

async function main() {
  const dump = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString())
  console.log(`  backup taken: ${dump.meta?.takenAt ?? 'unknown'}`)
  if (dump.meta?.skipped?.length) console.log(`  skipped at backup time: ${dump.meta.skipped.join(', ')}`)
  console.log(apply ? '  MODE: APPLY (will write)' : '  MODE: dry run (writes nothing)\n')

  await client.connect()

  const names = Object.keys(dump.tables)
  const ordered = [...ORDER.filter(t => names.includes(t)), ...names.filter(t => !ORDER.includes(t))]

  let totalWould = 0
  let totalDid = 0
  for (const table of ordered) {
    if (onlyTable && table !== onlyTable) continue
    const rows = dump.tables[table]
    if (!rows?.length) continue

    const { rows: [{ count }] } = await client.query(`select count(*)::int as count from "${table}"`)
    const missing = rows.length - count
    totalWould += Math.max(0, missing)

    if (!apply) {
      console.log(`  ${table.padEnd(26)} backup ${String(rows.length).padStart(6)} · live ${String(count).padStart(6)} · would insert up to ${Math.max(0, missing)}`)
      continue
    }
    const written = await insertRows(table, rows)
    totalDid += written
    console.log(`  ${table.padEnd(26)} inserted ${String(written).padStart(6)} (live was ${count})`)
  }

  console.log(apply
    ? `\n  done — ${totalDid.toLocaleString('en-US')} rows inserted, nothing deleted or overwritten.`
    : `\n  dry run — up to ${totalWould.toLocaleString('en-US')} rows are missing live. Re-run with --apply to write them.`)

  if (dump.authUsers?.length) {
    console.log(`\n  NOTE: ${dump.authUsers.length} auth.users rows are in the backup for reference and were NOT restored.`)
    console.log('  Supabase owns that schema; recreating accounts is an auth operation, not a row copy.')
  }
}

main()
  .catch(e => { console.error('restore failed:', e.message); process.exitCode = 1 })
  .finally(() => client.end())
