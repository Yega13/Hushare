// ASK A CHEAP QUESTION BEFORE ASKING AN EXPENSIVE ONE.
//
// The album page keeps itself current by refetching a 500-photo window. Measured on a real event
// album that window is ~228 KB, and it is fetched on every realtime ping and — for every visitor
// past the realtime connection cap — on a timer, whether or not anything changed. Four hundred
// guests doing that burns the whole database plan's monthly transfer allowance in under an hour,
// and the throttling that follows lands on every album on the platform, not just the busy one.
//
// The overwhelming majority of those fetches return exactly what the client already has. So the
// client now asks a question whose answer is about forty bytes — how many photos are there, and
// when was the newest one added — and only pulls the window when that answer has moved.
//
// The two fields together, not either alone: a count catches additions but not a deletion paired
// with an upload between two polls, and a newest-timestamp catches uploads but no deletion at all.

export type AlbumFreshness = {
  /** Total photos the viewer is allowed to see. */
  total: number
  /** created_at of the newest visible photo, as the database's own string. Null on an empty album. */
  latest: string | null
}

/**
 * Whether the window is worth re-fetching.
 *
 * Errs toward FETCHING. A probe that failed, a client with nothing recorded yet, or any shape
 * that cannot be compared all return true: a wasted fetch costs bytes, while a wrongly skipped
 * one leaves a guest looking at a stale album and quietly believing it is complete — which is
 * the failure this whole path exists to prevent.
 */
export function albumChanged(seen: AlbumFreshness | null, probe: AlbumFreshness | null): boolean {
  if (!probe) return true
  if (!seen) return true
  return seen.total !== probe.total || seen.latest !== probe.latest
}
