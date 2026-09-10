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

/** Parents before children, so a foreign key never points at a row that has not been written yet. */
export const ORDER = ['albums', 'photos', 'subscriptions', 'error_events']

/** How many rows go in one insert. Postgres caps a statement at 65535 parameters; a 27-column
 *  table at 200 rows is 5,400, which leaves room for the widest table this database has. */
export const CHUNK = 200

/**
 * The tables to restore, in the order they must be written: the named parents first, then whatever
 * else the dump carries, in its own order. A table the dump does not have is skipped, not invented.
 */
export function restoreOrder(dumpTableNames, order = ORDER) {
  const names = [...dumpTableNames]
  return [...order.filter((t) => names.includes(t)), ...names.filter((t) => !order.includes(t))]
}

/** The rows of one chunk as a parameterised INSERT ... ON CONFLICT DO NOTHING. */
export function insertStatement(table, cols, rowCount) {
  const quoted = cols.map((c) => `"${c}"`).join(', ')
  const placeholders = Array.from({ length: rowCount }, (_, r) =>
    `(${cols.map((_c, k) => `$${r * cols.length + k + 1}`).join(', ')})`).join(', ')
  return `insert into "${table}" (${quoted}) values ${placeholders} on conflict do nothing`
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

  for (const table of restoreOrder(names)) {
    if (onlyTable && table !== onlyTable) continue
    const rows = dump.tables[table]
    if (!rows?.length) continue

    // A table the target no longer has is reported and skipped, never a crash that abandons the
    // tables after it: a restore that stops halfway is worse than one that says what it could not do.
    const liveCols = await liveColumnsOf(client, table)
    if (!liveCols) { skipped.push({ table, reason: 'no such table in the target database', rows: rows.length }); continue }

    const { use, dropped } = reconcileColumns(Object.keys(rows[0]), liveCols)
    if (!use.length) { skipped.push({ table, reason: 'no column of the backup still exists', rows: rows.length }); continue }

    const { rows: [{ count }] } = await client.query(`select count(*)::int as count from "${table}"`)
    const live = Number(count)

    if (!apply) {
      const would = Math.max(0, rows.length - live)
      totalWould += would
      tables.push({ table, backup: rows.length, live, would, dropped })
      continue
    }
    const written = await insertRows(client, table, rows, use)
    totalWritten += written
    tables.push({ table, backup: rows.length, live, written, dropped })
  }

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
