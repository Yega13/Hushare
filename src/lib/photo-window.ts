import type { Photo } from '@/types'

// WHAT HAPPENS TO THE PHOTOS ON SCREEN WHEN THE ALBUM REFRESHES.
//
// The album page holds a first window of photos and, on a big album, whatever further pages the
// guest has scrolled into. A refresh — a realtime ping, an upload finishing, a settings broadcast —
// re-fetches only the FIRST WINDOW. What happens to the rest is this decision.
//
// Wrong in one direction and photos the guest already scrolled past vanish under them. Wrong in the
// other and the same photo appears twice. Neither throws, and both read as "the app is glitchy"
// rather than as a bug anyone can report precisely.
//
// It lived inside a 1,424-line component as two lines with no test. This is the same code, and
// there are deliberately TWO functions because the two call sites want different things — which was
// not obvious while both were spelled `mergeWindow(prev, r.photos)`.

/**
 * Keep everything already on screen that the new window does not mention.
 *
 * Matched by id, so a photo that MOVED into the window is not also left behind in the tail. Returns
 * `windowPhotos` itself when there is no tail, preserving array identity — a new array with
 * identical contents re-renders every tile in the grid.
 */
export function mergePreservingExtras(prev: Photo[], windowPhotos: Photo[]): Photo[] {
  const inWindow = new Set(windowPhotos.map((p) => p.id))
  const extras = prev.filter((p) => !inWindow.has(p.id))
  return extras.length ? [...windowPhotos, ...extras] : windowPhotos
}

/**
 * The strategy for a REFRESH of the first window, chosen by the album's true size.
 *
 *   total <= firstWindow — the window IS the whole album, so the fetch is authoritative and
 *     replaces everything. The common case, and the entire behaviour before paging existed. It
 *     matters that this is a replace: it is the only path on which a photo deleted elsewhere
 *     actually disappears.
 *
 *   total > firstWindow — the fetch covers only the head, so the loaded tail is kept.
 */
export function applyPhotoWindow(
  prev: Photo[],
  windowPhotos: Photo[],
  total: number,
  firstWindow: number,
): Photo[] {
  if (total <= firstWindow) return windowPhotos
  return mergePreservingExtras(prev, windowPhotos)
}

/**
 * A refresh that FAILED is not an empty album.
 *
 * The distinction is the whole point: null means the request did not come back, and treating that
 * as "the album is now empty" blanks the screen for everyone in the room at once — which is exactly
 * what a flaky venue connection produces. A type predicate so callers get the narrowing too, rather
 * than repeating the null check to satisfy the compiler and drifting from this rule.
 */
export function shouldApplyRefresh<T>(result: T | null | undefined): result is T {
  return result !== null && result !== undefined
}
