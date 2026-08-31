// HOW MUCH OF AN ALBUM MAY BE HELD IN MEMORY AT ONCE.
//
// "Download all" builds the ZIP inside the browser tab, so every photo in a part sits in memory
// until that part is written out. The batch was 500 PHOTOS — a count, which is the wrong unit,
// because photos are not a fixed size. Five hundred phone snaps is a couple of hundred megabytes
// and fine; five hundred 25 MB originals is over twelve gigabytes and the tab is killed long
// before it finishes. Same album, same button, and which one you get depends on what the
// photographer happened to shoot. Guests have this button too, so the device is usually a phone.
//
// The unit is now bytes. Nothing records a photo's file size — there is no such column — so the
// size is estimated from its pixel dimensions, which 99.9% of rows have.

/** Bytes per pixel for a stored JPEG. Real photos land around 0.2–0.35; 0.4 is deliberately
 *  pessimistic, because guessing SMALL is how a batch ends up holding twenty 25 MB files and
 *  guessing large only costs an extra part file. */
const BYTES_PER_PIXEL = 0.4

/** For the handful of rows with no dimensions, and for videos. */
export const ZIP_ASSUMED_BYTES = 8 * 1024 * 1024

/** Peak memory is roughly TWICE the batch: the input blobs, plus the ZIP being built beside them
 *  (STORE, so the output is about the same size as the input). These budgets are therefore half
 *  of what the device can really hold. A phone tab is killed well under 400 MB. */
export const ZIP_BUDGET_MOBILE = 120 * 1024 * 1024
export const ZIP_BUDGET_DESKTOP = 500 * 1024 * 1024

/** A ceiling regardless of size, so one network failure never costs an enormous re-download. */
export const ZIP_MAX_PER_BATCH = 500

type Sized = { width?: number | null; height?: number | null }

/** Estimated stored size of one photo. */
export function estimateBytes(photo: Sized): number {
  const { width, height } = photo
  if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
    return Math.max(64 * 1024, Math.round(width * height * BYTES_PER_PIXEL))
  }
  return ZIP_ASSUMED_BYTES
}

/** The whole download's estimated size — what to tell somebody before they start it on a phone. */
export function estimateTotalBytes(photos: Sized[]): number {
  return photos.reduce((sum, p) => sum + estimateBytes(p), 0)
}

/**
 * Split photos into parts, each within the byte budget.
 *
 * A single photo larger than the entire budget still gets its own part rather than being dropped:
 * the download must contain everything, and one oversized file is the browser's problem to
 * survive, never ours to silently omit.
 */
export function batchByBytes<T extends Sized>(
  photos: T[],
  budget: number,
  maxPerBatch = ZIP_MAX_PER_BATCH,
): T[][] {
  const parts: T[][] = []
  let current: T[] = []
  let currentBytes = 0

  for (const photo of photos) {
    const size = estimateBytes(photo)
    if (current.length > 0 && (currentBytes + size > budget || current.length >= maxPerBatch)) {
      parts.push(current)
      current = []
      currentBytes = 0
    }
    current.push(photo)
    currentBytes += size
  }
  if (current.length > 0) parts.push(current)
  return parts
}

/** Human size, for a warning somebody reads before committing to a long download. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
