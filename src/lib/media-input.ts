import { MAX_SLIDESHOW_INTERVAL_MS, MIN_SLIDESHOW_INTERVAL_MS } from '@/lib/media-display'

// WHAT A SLIDER OR A TYPED NUMBER IS ALLOWED TO BECOME, before it is applied or saved.
//
// Three clamps that sat inline in the media panel with nothing executing them: a review removed
// each one in turn and the suite stayed green -- a radius of 999 or -5, a typed empty box becoming
// 0, a slideshow interval of 0 ms, all reaching the album and the server. They are a line each and
// they decide what the grid draws, so they live here with tests (rule 14).

/** A corner radius the grid can honour: whole pixels, never negative, never past what it measured. */
export function clampMediaRadius(value: number, radiusMax: number): number {
  return Math.max(0, Math.min(radiusMax, Math.round(value)))
}

/**
 * What the typed radius box means. Empty or not a number is `null` -- "leave it alone", so a
 * cleared box does not become a radius of 0 -- otherwise the clamped whole number.
 */
export function parseMediaRadiusDraft(value: string, radiusMax: number): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return null
  return clampMediaRadius(parsed, radiusMax)
}

/** A slideshow interval inside the product's bounds, in whole milliseconds. */
export function clampSlideshowInterval(value: number): number {
  return Math.max(MIN_SLIDESHOW_INTERVAL_MS, Math.min(MAX_SLIDESHOW_INTERVAL_MS, Math.round(value)))
}
