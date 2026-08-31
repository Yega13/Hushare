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

/**
 * What a refresh should actually FETCH, given the probe's answer.
 *
 * The probe made an idle album free, and then the event audit measured the live case: during an
 * event the album really does change on most checks, so the full 500-row window — 424 KB — was
 * pulled anyway. Halved the bill; it needed to be cut by fifty.
 *
 * The insight is that the probe already knows enough. If the count grew and nothing was removed,
 * the only rows the client is missing are the ones newer than what it last saw, and there are
 * usually a handful. Anything else — a deletion, an edit in place, a gap the client cannot
 * reconcile — falls back to the whole window, which is always correct and merely expensive.
 *
 * Returns the number of new rows to ask for, or null meaning "fetch the window".
 */
export function deltaRowsNeeded(
  seen: AlbumFreshness | null,
  probe: AlbumFreshness | null,
  maxDelta: number,
): number | null {
  // Nothing to reason from, or a probe that failed: the window is the only safe answer.
  if (!seen || !probe) return null
  // A DELETION (or a delete paired with an upload) cannot be expressed as "rows newer than X" —
  // the client would keep showing a photo that no longer exists. Only growth is deltable.
  const grew = probe.total - seen.total
  if (grew <= 0) return null
  // More new rows than a delta would save anything on, so take the window and re-sync properly.
  if (grew > maxDelta) return null
  // Growth with no newer timestamp means rows appeared that are not newer than what we hold —
  // an import, a restored photo, a clock that went backwards. Not something to guess about.
  if (!probe.latest || !seen.latest || probe.latest <= seen.latest) return null
  return grew
}
