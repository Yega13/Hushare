// TURNING A DECODED IMAGE BACK INTO BYTES, in a place a test can reach.
//
// This is the code that lost twelve photos on 2026-09-12. Album dm1ybi7j uploaded twelve rows
// pointing at twelve zero-byte objects in R2, every tile green, because the encoder returned an
// EMPTY blob and the check was `if (blob)` -- an empty Blob is truthy. The same function already
// had `fallback.size > 0` on its last-resort path, so the guard existed in the branch that almost
// never runs and was missing from the two that always do.
//
// It sat inside UploadZone.tsx, where none of the suite's tests execute, which is why 2,490 tests
// and 800 mutations never touched it. Rule 14 measured that gap on 2026-08-30 and this is the part
// of it that can destroy a customer's photo, so it moves first.
//
// WHAT IS INJECTED AND WHY. Every browser encoder here fails in a way that only shows up on a
// particular device -- WebKit returns null from toBlob under memory pressure, OffscreenCanvas is
// absent on Safari < 16.4, a 2D context can be refused outright. None of those are reproducible by
// running a browser in CI, so the surface is an interface and the tests drive each failure
// directly. The real implementations live beside the component that owns the DOM.

/**
 * 0.92, up from 0.86. Above ~0.90 JPEG artefacts stop being visible on a photograph; 0.86 was low
 * enough to soften skin and flatten gradients on every photo the site stored.
 *
 * Not 1.0 and not "keep the original bytes": full originals were measured at roughly 4 MB a photo,
 * which for the 5,000-photo event this was sized against is ~20 GB up a single connection -- a
 * couple of hours of uploading. Storage is not the constraint (20 GB is about $0.30/month); the
 * photographer's time is.
 */
export const MAIN_QUALITY = 0.92
export const THUMB_QUALITY = 0.85

/**
 * 600px longest edge: sharp on the grid even at 2-3x DPR (a 3-col mobile tile is ~120 CSS px =
 * ~360 physical px on a 3x screen), and small enough to stay a fast-loading thumbnail. The lightbox
 * swaps in the full-resolution original.
 */
export const THUMB_MAX_DIM = 600

/**
 * Deliberately carries no dimensions or sizes: /admin groups by exact message text, so a number
 * that changes per photo would scatter one recurring problem across a column of single rows.
 */
export const ENCODE_FAILED = 'Could not process this photo on this device — try again, or with fewer photos at once.'

/**
 * A data: URL back into bytes. Needed because toDataURL is the only encoder left when toBlob
 * refuses, and every caller downstream wants a Blob.
 */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  const header = dataUrl.slice(0, comma)
  if (!header.startsWith('data:') || !header.includes(';base64')) return null
  const mime = header.slice(5, header.indexOf(';')) || 'image/jpeg'
  const binary = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** One drawing surface, whichever browser API is behind it. */
export type Surface = {
  /** Draw the source at w x h. Throws when the 2D context is unavailable. */
  draw(source: CanvasImageSource, w: number, h: number): void
  /** Encode it. Resolves NULL when the encoder declines -- WebKit's toBlob does this under memory pressure rather than throwing. */
  encode(mime: string, quality: number): Promise<Blob | null>
  /**
   * The last-resort encoder, present only where the platform has one. A genuinely different path
   * in WebKit: toDataURL allocates a string rather than a Blob and regularly succeeds where toBlob
   * has just returned null. It costs a base64 round trip, which is why it is tried third.
   */
  encodeDataUrl?(mime: string, quality: number): string | null
}

export type SurfaceFactory = {
  /** OffscreenCanvas, or null where the platform lacks it (Safari < 16.4). Tried first. */
  offscreen: ((w: number, h: number) => Surface) | null
  /** A DOM canvas. Always available in a browser, and the fallback for everything above. */
  element: (w: number, h: number) => Surface
}

export type EncoderDeps = {
  surfaces: SurfaceFactory
  /** Injected so a test does not wait 150ms of real time for the memory-pressure retry. */
  sleep?: (ms: number) => Promise<void>
}

/** How long to wait before the second encode attempt. A moment is all the previous file's buffers need. */
export const ENCODE_RETRY_MS = 150

export function createImageEncoder(deps: EncoderDeps) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  /**
   * Three attempts at getting BYTES out of one surface, and an empty result counts as a failure at
   * every one of them.
   *
   * `blob.size > 0`, never `blob`: an empty Blob is truthy, and that single word is how twelve
   * photos became twelve empty objects in R2 behind twelve green tiles. R2 did nothing wrong -- an
   * empty object is a valid object -- so this is the last place the difference can still be seen.
   */
  async function encodeSurface(surface: Surface, mime: string, quality: number): Promise<Blob> {
    let blob = await surface.encode(mime, quality)

    // Memory pressure is a moment, not a verdict: the previous file's buffers are released between
    // these two attempts, and the retry usually lands.
    if (!blob || blob.size === 0) {
      await sleep(ENCODE_RETRY_MS)
      blob = await surface.encode(mime, quality)
    }

    if ((!blob || blob.size === 0) && surface.encodeDataUrl) {
      try {
        const url = surface.encodeDataUrl(mime, quality)
        const fallback = url ? dataUrlToBlob(url) : null
        if (fallback && fallback.size > 0) blob = fallback
      } catch { /* fall through to the throw below */ }
    }

    if (blob && blob.size > 0) return blob
    throw new Error(ENCODE_FAILED)
  }

  /**
   * OffscreenCanvas first, DOM canvas second -- and the second is a genuinely different encoder,
   * not a repeat of the first, which is why falling through is worth doing at all.
   *
   * Both halves now get the retry and the data-URL fallback. They did not before: the offscreen
   * path took exactly one attempt and any failure there skipped straight to the DOM canvas, so the
   * cheapest recovery was only ever applied to one of the two encoders.
   */
  async function bitmapToBlob(
    bitmap: CanvasImageSource,
    w: number,
    h: number,
    mime: string,
    quality: number,
  ): Promise<Blob> {
    if (deps.surfaces.offscreen) {
      try {
        const surface = deps.surfaces.offscreen(w, h)
        surface.draw(bitmap, w, h)
        return await encodeSurface(surface, mime, quality)
      } catch { /* fall through to the DOM canvas */ }
    }
    const surface = deps.surfaces.element(w, h)
    surface.draw(bitmap, w, h)
    return encodeSurface(surface, mime, quality)
  }

  return { bitmapToBlob, encodeSurface }
}
