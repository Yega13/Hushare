// How the admin error table combines its two data sources.
//
// The page arrives server-rendered with up to 200 open rows; the live poll refreshes the
// NEWEST 30 every 5 seconds. Swapping the whole table for the poll payload silently shrank
// 200 rows to 30 five seconds after load, and every count derived from the table (tab badges,
// top-message chips, the "Clear N warnings?" confirm) quietly disagreed with the stat cards,
// which read exact database counts. Merging keeps the full picture: live rows are the freshest
// truth for what they cover, server rows fill in the older tail.
//
// Known cost, chosen deliberately: a row resolved on the server after page load can linger
// from the server tail until reload. Showing a stale extra row errs safe; the swap erred the
// other way — toward asserting an all-clear the data could not back (rule 20).

type MergeableRow = { created_at: string; message: string }

/** Live rows first (they are, by construction, the newest N unresolved rows overall), then
 *  every server row the live window does not cover. Both inputs arrive newest-first, and any
 *  server row missing from the live window is older than the window's oldest — so the
 *  concatenation is still newest-first without re-sorting. */
export function mergeLiveRows<T extends MergeableRow>(live: T[], initial: T[]): T[] {
  const covered = new Set(live.map((r) => r.created_at + ' ' + r.message))
  return [...live, ...initial.filter((r) => !covered.has(r.created_at + ' ' + r.message))]
}
