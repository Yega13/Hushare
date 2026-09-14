import { albumChanged, deltaRowsNeeded, type AlbumFreshness } from '@/lib/album-freshness'

// ONE REQUEST PER LIVE REFRESH, NOT TWO.
//
// Every refresh of an open album asked the cheap question first -- how many photos, and when was the
// newest added (the probe) -- and then, when that answer had moved, made a second request for the new
// rows. During an event the answer has moved on nearly every check, so nearly every refresh was two
// requests while the capacity arithmetic counted one. The review of 2026-09-14 put the result at about
// 420 guests on one venue IP crossing the 20,000-a-minute photo limit, and a refused refresh is an album
// that silently stops updating.
//
// The since read now answers the probe's question itself: the rows newer than what the viewer holds,
// the total, and the newest time, in one response. When the viewer knows what it holds, that one request
// decides everything -- nothing moved, or here are the new photos. Only what a delta cannot express (a
// deletion, an edit in place, a reorder, a burst larger than a delta) still needs the window, as before.
//
// ERRS TOWARD FETCHING, like lib/album-freshness: a failed or incomplete answer never skips the window,
// and freshness is remembered only from a fetch that succeeded. Why a broadcast forces, and how often it
// may, is lib/realtime-supervisor.

export type PhotoPage<P> = { photos: P[]; total: number }
export type SinceAnswer<P> = PhotoPage<P> & { latest: string | null }

export type RefreshDeps<P> = {
  /** What the viewer last knew it held. */
  seen(): AlbumFreshness | null
  remember(freshness: AlbumFreshness): void
  /** The count and the newest time only -- for a viewer that does not yet know what it holds. */
  probe(): Promise<AlbumFreshness | null>
  /** Rows newer than `since`, at most `limit`, with the total and the newest time. */
  since(since: string, limit: number): Promise<SinceAnswer<P> | null>
  /** The first window. */
  window(): Promise<PhotoPage<P> | null>
  applyDelta(page: PhotoPage<P>): void
  /** Handed null on a failed fetch, so the caller keeps what is on screen rather than blanking it. */
  applyWindow(page: PhotoPage<P> | null): void
  maxDelta: number
}

export type RefreshOutcome = 'unchanged' | 'delta' | 'window'

export async function refreshAlbum<P>(deps: RefreshDeps<P>, opts: { force: boolean }): Promise<RefreshOutcome> {
  const seen = deps.seen()
  let answer: SinceAnswer<P> | null = null
  let probe: AlbumFreshness | null
  if (seen?.latest) {
    answer = await deps.since(seen.latest, deps.maxDelta)
    probe = answer ? { total: answer.total, latest: answer.latest } : null
  } else {
    probe = await deps.probe()
  }

  if (!opts.force && !albumChanged(seen, probe)) return 'unchanged'

  const delta = deltaRowsNeeded(seen, probe, deps.maxDelta)
  // Trusted only when the answer holds exactly the rows its own total promises. Anything else -- a row
  // this viewer deleted a moment ago and filtered out, a count that moved between the server's queries --
  // takes the window rather than leaving the grid quietly wrong.
  if (delta !== null && answer && probe && answer.photos.length === delta) {
    deps.remember(probe)
    deps.applyDelta(answer)
    return 'delta'
  }

  const page = await deps.window()
  // Only a fetch that succeeded is remembered, or a failed window would be recorded as the current
  // state and the next check would skip the retry.
  if (page && probe) deps.remember(probe)
  deps.applyWindow(page)
  return 'window'
}
