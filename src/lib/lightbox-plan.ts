// What the lightbox loads beyond the photo on screen — decided HERE and nowhere else.
//
// This module exists because the answer used to live in two places that disagreed:
// useLightboxMedia prefetched the current photo ±2 neighbours at full resolution, and
// LightboxOverlay ran its own second loop prefetching ±1 again. Up to seven full-size
// (~3500px, 1-2MB) downloads per swipe, competing on a phone's connection with the one
// image the guest is actually waiting for. In a several-thousand-photo album, swiping
// fast queued dozens of decodes and the lightbox visibly lagged. One list, one owner.

/** Offsets from the open photo whose originals are worth having in cache.
 *  Current first (fetchPriority high), then one ahead, then one behind. Nothing else:
 *  every extra neighbour costs megabytes of contention on the connection the visible
 *  photo needs, and cache-hit-on-swipe only ever needs the adjacent one. */
export const PREFETCH_DELTAS: readonly number[] = [0, 1, -1]

/** Which slice of the slideshow filmstrip to render, as [start, end).
 *
 *  The strip used to render EVERY photo — one <button><img> per photo, all mounted the
 *  moment the slideshow opened. At event scale (3,700+ photos) that is thousands of DOM
 *  nodes and thousands of thumbnail requests at once, which is a hang on a phone. A strip
 *  is a position indicator; only the neighbourhood of the current slide is visible, so
 *  only the neighbourhood exists. */
export function stripWindow(index: number, total: number, span = 20): { start: number; end: number } {
  if (total <= 0) return { start: 0, end: 0 }
  const i = Math.min(Math.max(index, 0), total - 1)
  return { start: Math.max(0, i - span), end: Math.min(total, i + span + 1) }
}

/** Whether the open/close morph animation is worth running at this album size.
 *
 *  startViewTransition snapshots the WHOLE page twice — cost scales with mounted DOM, and an
 *  event album mounts thousands of image tiles. At 4,500 photos the snapshot alone was a
 *  visible stall on every open and close, on the most-tapped interaction in the product. The
 *  morph is polish; past this many loaded photos the plain cut is the faster, better
 *  experience. 600 keeps the morph for every ordinary album (weddings, parties) and drops it
 *  only where the page is too heavy to animate. */
export const MORPH_TILE_LIMIT = 600
export function morphAllowed(loadedPhotoCount: number): boolean {
  return loadedPhotoCount <= MORPH_TILE_LIMIT
}
