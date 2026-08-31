// HOW MANY UPLOAD SLOTS AN ALBUM MAY BE HANDED IN AN HOUR.
//
// A presign hands out a writable R2 slot. The per-album media cap cannot bound this, because the
// cap counts ROWS and an abuser never creates one: they ask for a slot, PUT the bytes, and never
// call photos/create. Nothing then references those objects, every deletion path works from
// database rows, and the storage audit deletes nothing — so the bytes are permanent, and the bill
// is permanent with them. The flat 40,000/hour ceiling meant one album id was worth ~1 TB an hour
// at the free-tier file size.
//
// So the budget is tied to what the album could legitimately still need. A photographer filling a
// 10,000-photo event album needs thousands of slots; an album that is already full needs a handful
// for retries and nothing more. The multiplier is the slack for failed PUTs, network retries and
// the thumbnail that rides along with each photo.
//
// Deliberately NOT a tight bound. This is a cost ceiling, not a quota — the honest per-album limit
// is the media cap enforced at row creation, and every number here is generous enough that no real
// event can reach it.

/** Retries, relay fallbacks, and the thumb slot issued beside each photo. */
export const PRESIGN_SLACK = 4

/** Even a full album must still be able to retry a failed upload. */
export const PRESIGN_FLOOR = 300

/** No album, however large its cap, may be handed more than this in an hour. */
export const PRESIGN_CEILING = 8000

/**
 * The hourly presign budget for an album that currently holds `photoCount` of `cap` items.
 *
 * A failed count passes null, and the answer is then the ceiling: this bounds cost, and refusing
 * every guest at an event because one COUNT query failed would be a far worse outcome than a
 * generous hour. Same direction as the row-cap's own failure mode, deliberately.
 */
export function presignBudget(photoCount: number | null, cap: number): number {
  if (photoCount === null || !Number.isFinite(photoCount)) return PRESIGN_CEILING
  const remaining = Math.max(0, cap - photoCount)
  return Math.min(PRESIGN_CEILING, Math.max(PRESIGN_FLOOR, remaining * PRESIGN_SLACK))
}
