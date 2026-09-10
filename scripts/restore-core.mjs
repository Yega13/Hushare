// WHAT A RESTORE DOES, separated from the command that runs it.
//
// This is the script most capable of destroying the thing it protects, and until 2026-09-10 the
// whole of it -- the ordering, the chunking, the conflict rule, the dry run -- lived inside a
// top-level `main()` that connected to production the moment it was imported. Nothing about it
// could be tested without a database, so nothing about it was tested (rule 14), and a backup
// nobody has restored is a guess.
//
// The client is INJECTED, so the same code path runs against production, against the in-process
// Postgres the rehearsal boots, and against the one in tests/restore-core.test.ts.
//
// THE SAFETY RULES, unchanged and now assertable:
//   * DRY RUN BY DEFAULT: it reports and writes nothing until apply is asked for.
//   * INSERT ONLY. No delete, no truncate, no update -- pointing it at a healthy database is a
//     no-op rather than a disaster, and it can never be used to wipe live data.
//   * ON CONFLICT DO NOTHING, so a row that still exists is left exactly as it is. Newer data is
//     never overwritten by an older dump. It restores what is MISSING.
//   * Parameterised values, so timestamps, arrays and jsonb round-trip through the driver instead
//     of through escaping written by hand.
//
// WHAT "RESTORES WHAT IS MISSING" ALSO MEANS, said plainly because the dry run of 2026-09-10
// showed it: a row DELIBERATELY deleted since the backup is missing too, and --apply would bring
// it back. That run offered to resurrect three expired sessions and a deleted collection. Nothing
// here can tell a deletion from a loss -- only a human can -- which is why the dry run is the
// default, names every table it would touch, and has to be read before --apply is typed.

// ORDER CANNOT SOLVE THIS, so it no longer tries. `albums.cover_photo_id` references `photos.id`
// and `photos.album_id` references `albums.id`: a cycle, with no order that satisfies both. A
// review found it and a rehearsal against the real schema proved it -- the restore died on its
// FIRST table, having written nothing, which is the whole failure this path exists to prevent.
// Three more tables (collections, profiles, subscriptions) reference auth.users, which a restore
// deliberately never writes, so in the disaster this backup is for -- a new, empty project --
// those were unrestorable too.
//
// The restore now runs inside ONE transaction with `session_replication_role = replica`, which is
// what pg_restore does and is correct here: a full logical dump is internally consistent, so its
// foreign keys are satisfied by the END of the transaction and checking them row by row on the way
// in only forbids orderings that do not exist. Verified against the production role on 2026-09-10
// with a transaction that was rolled back. It is set with SET LOCAL, so it cannot outlive the
// transaction even if the process dies.
//
// The tables are still written parents-first where a parent is known, because a readable log beats
// an arbitrary one -- but nothing depends on it any more.
export const ORDER = ['albums', 'photos', 'subscriptions', 'error_events']

/** Postgres identifier quoting: a name containing a double quote doubles it. Nothing in this
 *  database is named that way; a dump is a file an operator supplies, and a restore is not the
 *  place to re-derive whether that matters. */
export function quoteIdent(name) {
  return String(name).replace(/"/g, '""')
}

/** How many rows go in one insert. Postgres caps a statement at 65535 parameters; a 27-column
 *  table at 200 rows is 5,400 -- and the widest table here is `albums` at 53 columns (counted
 *  from schema.sql, not remembered: this comment used to say 27), so 10,600, comfortably under. */
export const CHUNK = 200

/**
 * The tables to restore, in the order they must be written: the named parents first, then whatever
 * else the dump carries, in its own order. A table the dump does not have is skipped, not invented.
 */
export function restoreOrder(dumpTableNames, order = ORDER) {
  const names = [...dumpTableNames]
  return [...order.filter((t) => names.includes(t)), ...names.filter((t) => !order.includes(t))]
}

/**
 * EVERY column any row carries, not the first row's. `Object.keys(rows[0])` was safe only because
 * backup-db.mjs writes `select *`, so all rows carry all keys -- safe by coincidence of the
 * producer, not by construction. A dump that was hand-edited, trimmed or merged loses every field
 * absent from row zero, for every row, and unlike a dropped column nothing reports it.
 */
export function columnsOf(rows) {
  const seen = []
  const have = new Set()
  for (const row of rows) for (const k of Object.keys(row)) if (!have.has(k)) { have.add(k); seen.push(k) }
  return seen
}

/** Rows whose key set differs from the union: worth naming, because their missing fields become
 *  NULL, and a NOT NULL column would then refuse the whole restore. */
export function heterogeneousCount(rows, columns) {
  return rows.filter((r) => Object.keys(r).length !== columns.length).length
}

/** The rows of one chunk as a parameterised INSERT ... ON CONFLICT DO NOTHING. */
export function insertStatement(table, cols, rowCount) {
  const quoted = cols.map((c) => `"${quoteIdent(c)}"`).join(', ')
  const placeholders = Array.from({ length: rowCount }, (_, r) =>
    `(${cols.map((_c, k) => `$${r * cols.length + k + 1}`).join(', ')})`).join(', ')
  return `insert into "public"."${quoteIdent(table)}" (${quoted}) values ${placeholders} on conflict do nothing`
}

/**
 * WHAT OF THIS DUMP STILL FITS. A backup is restored into the schema of the day it is NEEDED, not
 * the day it was taken, and the two differ: the 2026-08-26 backup carries `albums.media_hover`,
 * a column since dropped, and the first rehearsal of this path died on it -- every table, nothing
 * restored, on exactly the day that matters most.
 *
 * So a column the target no longer has is DROPPED and named. The direction of the error is chosen
 * (rule 19): dropping a column loses one field of a dump that is already historical, while
 * refusing the insert loses every row of every table. A column the target has and the dump does
 * not is simply absent -- it takes its default, which is what a newer column is for.
 */
export function reconcileColumns(dumpColumns, liveColumns) {
  const live = new Set(liveColumns)
  const dump = new Set(dumpColumns)
  return {
    use: dumpColumns.filter((c) => live.has(c)),
    dropped: dumpColumns.filter((c) => !live.has(c)),
    absentFromBackup: liveColumns.filter((c) => !dump.has(c)),
  }
}

/** Split rows into chunks of at most CHUNK. An empty list yields no chunks, never one empty insert. */
export function chunkRows(rows, size = CHUNK) {
  const out = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

async function insertRows(client, table, rows, cols) {
  let written = 0
  for (const chunk of chunkRows(rows)) {
    const values = []
    for (const row of chunk) for (const c of cols) values.push(row[c])
    const res = await client.query(insertStatement(table, cols, chunk.length), values)
    written += res.rowCount ?? 0
  }
  return written
}

/**
 * The primary-key columns of a table, so a dry run can COUNT what is missing instead of
 * subtracting two cardinalities. Empty when the table has no primary key.
 */
async function primaryKeyOf(client, table) {
  const { rows } = await client.query(`
    select kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY' and tc.table_name = $1
    order by kcu.ordinal_position`, [table])
  return rows.map((r) => r.column_name)
}

/**
 * How many rows of this table are genuinely absent. The old answer was `backup - live`, and a
 * review showed what that costs: two albums live, two different albums in the backup, and the dry
 * run reports 0 -- "up to 0 rows are missing live" -- to an operator deciding whether their album
 * needs restoring at all. It is the only number a human reads before betting the database on it,
 * so it is counted, by key, and not inferred from two unrelated totals.
 *
 * A table with a composite or absent primary key falls back to the subtraction and SAYS so.
 */
async function countMissing(client, table, rows) {
  const pk = await primaryKeyOf(client, table)
  if (pk.length !== 1) {
    const { rows: [{ count }] } = await client.query(`select count(*)::int as count from "public"."${quoteIdent(table)}"`)
    return { missing: Math.max(0, rows.length - Number(count)), exact: false }
  }
  const [key] = pk
  const keys = rows.map((r) => r[key])
  const { rows: found } = await client.query(
    `select "${quoteIdent(key)}" as k from "public"."${quoteIdent(table)}" where "${quoteIdent(key)}" = any($1)`, [keys])
  const present = new Set(found.map((r) => String(r.k)))
  return { missing: keys.filter((k) => !present.has(String(k))).length, exact: true }
}

/** The columns the target database actually has for a table, or null when it has no such table. */
async function liveColumnsOf(client, table) {
  const { rows } = await client.query(
    `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`,
    [table],
  )
  return rows.length ? rows.map((r) => r.column_name) : null
}

/**
 * Restore a dump through `client` (anything with `query(sql, params)` returning `{ rows, rowCount }`).
 *
 * Returns a report rather than printing one, so the caller decides what a human sees and a test can
 * assert what happened. In dry-run mode NO insert is issued at all -- the counts come from counting
 * what is already live, which is the only question a dry run can honestly answer. The dry run also
 * reports the columns and tables the dump has lost, so the mismatch is seen BEFORE the write.
 *
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<{ rows: any[], rowCount?: number }> }} client
 * @param {{ tables?: Record<string, Record<string, unknown>[]>, authUsers?: unknown[] }} dump
 * @param {{ apply?: boolean, onlyTable?: string | null }} [options]
 */
export async function applyRestore(client, dump, { apply = false, onlyTable = null } = {}) {
  const names = Object.keys(dump.tables ?? {})
  const tables = []
  const skipped = []
  let totalWould = 0
  let totalWritten = 0

  // ALL OR NOTHING, and with the foreign keys deferred to the commit (see ORDER above). A restore
  // that stops half way leaves a database nobody can reason about; this one either happens or does
  // not. The SET is LOCAL, so it dies with the transaction.
  if (apply) {
    await client.query('begin')
    try {
      await client.query(`set local session_replication_role = 'replica'`)
    } catch (e) {
      await client.query('rollback')
      throw new Error(
        'this database role cannot defer foreign-key checks (session_replication_role), and the '
        + 'schema has a cycle that no insert order can satisfy, so a restore would abort part way. '
        + `Ask for a role that can, and try again. Original error: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  try {
  for (const table of restoreOrder(names)) {
    if (onlyTable && table !== onlyTable) continue
    const rows = dump.tables[table]
    if (!rows?.length) continue

    // A table the target no longer has is reported and skipped, never a crash that abandons the
    // tables after it: a restore that stops halfway is worse than one that says what it could not do.
    const liveCols = await liveColumnsOf(client, table)
    if (!liveCols) { skipped.push({ table, reason: 'no such table in the target database', rows: rows.length }); continue }

    const dumpCols = columnsOf(rows)
    const uneven = heterogeneousCount(rows, dumpCols)
    const { use, dropped } = reconcileColumns(dumpCols, liveCols)
    if (!use.length) { skipped.push({ table, reason: 'no column of the backup still exists', rows: rows.length }); continue }

    const { rows: [{ count }] } = await client.query(`select count(*)::int as count from "public"."${quoteIdent(table)}"`)
    const live = Number(count)

    if (!apply) {
      const { missing, exact } = await countMissing(client, table, rows)
      totalWould += missing
      tables.push({ table, backup: rows.length, live, missing, exact, dropped, uneven })
      continue
    }
    const written = await insertRows(client, table, rows, use)
    totalWritten += written
    // What the server declined without erroring: a row whose primary key is already there, and
    // also one whose UNIQUE constraint clashes -- `on conflict do nothing` swallows both. Saying
    // "inserted 80" while the backup held 83 leaves the operator to do that subtraction.
    tables.push({ table, backup: rows.length, live, written, skippedByConflict: rows.length - written, dropped, uneven })
  }

  } catch (e) {
    if (apply) await client.query('rollback')
    throw e
  }
  if (apply) await client.query('commit')

  return {
    apply,
    tables,
    skipped,
    totalWould,
    totalWritten,
    // Supabase owns auth.users; recreating accounts is an auth operation, not a row copy. The
    // rows travel in the backup for reference and are deliberately never inserted.
    authUsersInBackup: dump.authUsers?.length ?? 0,
  }
}
