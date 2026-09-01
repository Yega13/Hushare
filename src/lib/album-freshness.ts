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
 * MAY THIS BROADCAST SKIP THE PROBE AND PULL THE WHOLE WINDOW?
 *
 * A `changed` broadcast normally forces a full-window fetch, because a REORDER moves neither field
 * the probe compares — count and newest-timestamp are both unchanged when photos merely swap
 * places — so probing first would leave every other viewer on the old order until the next upload.
 *
 * The problem is who can send that broadcast. The channel is `album:<id>` and clients subscribe
 * with the public anon key, so anyone holding an album link (the id is in the page) can publish
 * `changed` to it. Payload spoofing was already handled — the payload is never trusted — but the
 * AMPLIFICATION was not: one forged message made every connected viewer fetch the full window,
 * ~228-424 KB each, from THEIR ip, so the per-ip limit on the photos route never sees it. Three
 * hundred guests at an event turn one attacker message into ~100 MB of database transfer, against
 * the shared allowance whose exhaustion throttles every album on the platform.
 *
 * So a force is allowed once per gap and then degrades to the probe. A real reorder still lands
 * immediately, which is the case force exists for; a flood costs ~40 bytes a message instead of a
 * window. This is a bound, not a fix — the fix is Realtime Authorization with private channels so
 * only the service role can publish — and it is deliberately generous enough that no legitimate
 * burst of owner edits is ever slowed.
 *
 * ERRS TOWARD FORCING, like everything else in this file: an unusable clock reading returns true.
 *
 * CLAMPED, because this is a difference of two wall-clock readings (rule 22). A phone taking an NTP
 * correction or crossing a timezone can make `now - last` negative or enormous; negative would
 * block forced refreshes for the length of the jump, which is precisely the bug that once deferred
 * a refresh by an hour and never recovered for the rest of the session.
 */
export const FORCED_REFRESH_MIN_GAP_MS = 20_000

export function forcedRefreshAllowed(
  lastForcedAt: number | null,
  now: number,
  minGapMs: number = FORCED_REFRESH_MIN_GAP_MS,
): boolean {
  if (lastForcedAt === null) return true
  if (!Number.isFinite(lastForcedAt) || !Number.isFinite(now)) return true
  const elapsed = now - lastForcedAt
  // Backwards, or implausibly far forward: the clock moved, not the album. Allow, and let the
  // caller re-stamp from the new reading.
  if (elapsed < 0 || elapsed > 24 * 60 * 60 * 1000) return true
  return elapsed >= minGapMs
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
