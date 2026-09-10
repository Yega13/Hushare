// Restore rows from a backup written by scripts/backup-db.mjs.
//
// A backup nobody has ever restored is a guess, not a backup. The RULES of the restore live in
// scripts/restore-core.mjs, which is exercised end to end against a real Postgres by
// `npm run restore:rehearse` and by tests/restore-core.test.ts -- so the code that runs on the day
// it matters is the code that has been run before. This file is the command around it: the
// connection, the arguments, and what a human sees.
//
// SAFETY, because this is the script most capable of destroying the thing it protects:
//   * DRY RUN BY DEFAULT. It reports what it would insert and writes nothing until --apply.
//   * It only ever INSERTS. There is no delete, no truncate, no update -- a restore cannot be used
//     to wipe live data, and pointing it at a healthy database is a no-op rather than a disaster.
//   * Every insert is ON CONFLICT DO NOTHING, so rows that still exist are left exactly as they
//     are. Newer data is never overwritten by an older dump.
//   * Values go through parameterised queries, so timestamps, arrays and jsonb round-trip through
//     the driver instead of through escaping written by hand.
//   * A column or table the schema has dropped since the backup is REPORTED and skipped, not a
//     crash. The first rehearsal of this path died on `albums.media_hover` and restored nothing.
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
import { applyRestore } from './restore-core.mjs'

const args = process.argv.slice(2)
const file = args.find(a => !a.startsWith('--'))
const apply = args.includes('--apply')
const onlyTable = args.includes('--table') ? args[args.indexOf('--table') + 1] : null

if (!file) {
  console.error('usage: node scripts/restore-db.mjs <backup.json.gz> [--apply] [--table <name>]')
  process.exit(1)
}

const client = new pg.Client({
  connectionString: connectionString('restore'),
  ssl: { rejectUnauthorized: false },
})

async function main() {
  const dump = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString())
  console.log(`  backup taken: ${dump.meta?.takenAt ?? 'unknown'}`)
  if (dump.meta?.skipped?.length) console.log(`  skipped at backup time: ${dump.meta.skipped.join(', ')}`)
  console.log(apply ? '  MODE: APPLY (will write)' : '  MODE: dry run (writes nothing)\n')

  await client.connect()
  const res = await applyRestore(client, dump, { apply, onlyTable })

  for (const s of res.skipped) {
    console.log(`  ${s.table.padEnd(26)} SKIPPED — ${s.reason} (${s.rows} rows in the backup)`)
  }
  for (const t of res.tables) {
    if (t.dropped?.length) {
      console.log(`  ${t.table.padEnd(26)} columns the schema no longer has, dropped: ${t.dropped.join(', ')}`)
    }
    console.log(apply
      ? `  ${t.table.padEnd(26)} inserted ${String(t.written).padStart(6)} (live was ${t.live})`
      : `  ${t.table.padEnd(26)} backup ${String(t.backup).padStart(6)} · live ${String(t.live).padStart(6)} · would insert up to ${t.would}`)
  }

  console.log(apply
    ? `\n  done — ${res.totalWritten.toLocaleString('en-US')} rows inserted, nothing deleted or overwritten.`
    : `\n  dry run — up to ${res.totalWould.toLocaleString('en-US')} rows are missing live. Re-run with --apply to write them.`)

  if (res.authUsersInBackup) {
    console.log(`\n  NOTE: ${res.authUsersInBackup} auth.users rows are in the backup for reference and were NOT restored.`)
    console.log('  Supabase owns that schema; recreating accounts is an auth operation, not a row copy.')
  }
}

main()
  .catch(e => { console.error('restore failed:', e.message); process.exitCode = 1 })
  .finally(() => client.end())
