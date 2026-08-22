// Logical backup of the Postgres database, written as gzipped JSON.
//
// WHY THIS EXISTS: the database is on Supabase's free plan, which has NO backups of any kind. Every
// album, every photo row, every owner token and password hash lives in exactly one place with no
// restore point. The bytes themselves (photos, videos) are in R2 and Stream, which have their own
// durability -- Postgres holds only the rows that point at them, so losing it does not lose the
// media, it loses every album that gives the media meaning. That is the whole product.
//
// WHY JSON RATHER THAN SQL: pg_dump is not installed on this machine, and hand-building INSERT
// statements in JavaScript means hand-building the escaping for timestamps, arrays, jsonb and
// nulls -- exactly the code that is wrong in a way you discover during a restore, which is the
// worst possible moment. Rows are dumped as JSON and restored through parameterised queries, so
// the driver does the type handling in both directions and there is no escaping to get wrong.
//
// WHAT IT DOES NOT COVER, stated plainly rather than assumed:
//   * auth.users is exported for reference but CANNOT be meaningfully restored by this script --
//     Supabase owns that schema, and recreating accounts is an auth operation, not a row copy.
//   * This is a point-in-time snapshot, not point-in-time RECOVERY. Anything written between the
//     last dump and a disaster is gone. That gap is what Supabase Pro's PITR buys; at ~5 MB of real
//     data a nightly dump closes most of the risk for nothing.
//
// USAGE
//   node scripts/backup-db.mjs                 -> backups/hushare-<stamp>.json.gz
//   node scripts/backup-db.mjs --out D:/safe   -> somewhere off this machine (recommended)
//   node scripts/backup-db.mjs --all           -> include regenerable tables too
//
// THE OUTPUT IS SECRET. It contains owner tokens, album password hashes and user emails -- anyone
// holding it can open any private album. /backups/ is gitignored (this repo is PUBLIC), but a dump
// that only ever sits next to the database it came from is not a backup. Copy it somewhere else.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import pg from 'pg'
import { connectionString } from './db-connection.mjs'

// Regenerable, and 11 MB of the database's 30 MB. rate_limit_events is a rolling window of
// counters that rebuilds itself within the hour; carrying it would triple every dump to protect
// data whose loss costs nothing. --all includes it when a byte-exact copy is wanted.
const SKIP_BY_DEFAULT = new Set(['rate_limit_events'])

const args = process.argv.slice(2)
const includeAll = args.includes('--all')
const outIdx = args.indexOf('--out')
const outDir = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : 'backups'

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
const outFile = path.join(outDir, `hushare-${stamp}.json.gz`)

const client = new pg.Client({
  connectionString: connectionString('backup'),
  ssl: { rejectUnauthorized: false },
})

async function main() {
  await client.connect()
  fs.mkdirSync(outDir, { recursive: true })

  const { rows: tableRows } = await client.query(`
    select tablename from pg_tables where schemaname = 'public' order by tablename
  `)
  const tables = tableRows
    .map(r => r.tablename)
    .filter(t => includeAll || !SKIP_BY_DEFAULT.has(t))

  const dump = {
    meta: {
      takenAt: new Date().toISOString(),
      note: 'Hushare logical backup. Restore with scripts/restore-db.mjs. CONTAINS SECRETS.',
      includedRegenerable: includeAll,
      skipped: includeAll ? [] : [...SKIP_BY_DEFAULT],
    },
    tables: {},
  }

  let total = 0
  for (const table of tables) {
    // Identifier quoted, never interpolated as a value: these names come from pg_tables rather than
    // from input, but a dump script that builds SQL by concatenation is a habit worth not having.
    const { rows } = await client.query(`select * from "${table}"`)
    dump.tables[table] = rows
    total += rows.length
    console.log(`  ${table.padEnd(26)} ${String(rows.length).padStart(7)} rows`)
  }

  // Exported for reference only -- see the note at the top about why this cannot be restored here.
  try {
    const { rows } = await client.query(
      `select id, email, created_at, last_sign_in_at from auth.users order by created_at`,
    )
    dump.authUsers = rows
    console.log(`  auth.users (reference only) ${String(rows.length).padStart(4)} rows`)
  } catch (e) {
    console.log('  auth.users: not readable —', e.message)
  }

  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(dump)), { level: 9 })
  fs.writeFileSync(outFile, gz)

  console.log(`\n  wrote ${outFile}`)
  console.log(`  ${total.toLocaleString('en-US')} rows across ${tables.length} tables · ${(gz.length / 1024 / 1024).toFixed(2)} MB gzipped`)
  console.log('\n  This file contains owner tokens and password hashes. Copy it OFF this machine.')
}

main()
  .catch(e => { console.error('backup failed:', e.message); process.exitCode = 1 })
  .finally(() => client.end())
