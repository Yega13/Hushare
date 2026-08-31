// WHICH END OF THE ALBUM A VISITOR SEES FIRST.
//
// This is not a cosmetic preference. The album page loads a WINDOW of 500 photos and refreshes
// that same window on every realtime ping. While the order was always oldest-first, the window
// was the 500 OLDEST photos — so on any album past 500 photos a new upload sorted to position
// 4,567 and the live refresh reloaded a slice that could not, by construction, contain it.
//
// Measured on the real table: a guest opening a 4,567-photo race album saw photos from a
// 21-minute slice at the very start of the day, and nothing newer, for the entire event. The
// realtime machinery worked perfectly and refreshed a window where nothing ever changed.
//
// So the order is now explicit per album, and 'newest' is the default for new ones — because an
// album that is still being filled is the case where this matters, and its visitors want the
// most recent photos. Existing albums were backfilled to what they already displayed, so nobody
// woke up to a rearranged album.

export type PhotoOrder = 'newest' | 'oldest' | 'manual'

export const PHOTO_ORDERS: readonly PhotoOrder[] = ['newest', 'oldest', 'manual']

/** What an owner may PICK. 'manual' is excluded in the type, not merely by convention — an album
 *  becomes manual by being dragged into an order, and choosing it from a menu would claim an
 *  arrangement that does not exist. Typing it this way makes the save function reject it at
 *  compile time rather than relying on every call site to remember. */
export type PickablePhotoOrder = Exclude<PhotoOrder, 'manual'>
export const PHOTO_ORDER_CHOICES: readonly PickablePhotoOrder[] = ['newest', 'oldest']

export function isPhotoOrder(v: unknown): v is PhotoOrder {
  return typeof v === 'string' && (PHOTO_ORDERS as readonly string[]).includes(v)
}

export type OrderClause = { column: string; ascending: boolean; nullsFirst?: boolean }

/**
 * The ORDER BY the photo query should use, as a list applied in sequence.
 *
 * Always ends on a column with a unique value per row. Ordering by a non-unique column alone
 * leaves ties broken arbitrarily, and Postgres is free to break them differently between two
 * requests — which for a PAGED query means a photo can appear on page 1 and page 2, or on
 * neither. `id` is the tiebreak because created_at is not unique: a burst upload writes many
 * rows in the same millisecond, which is exactly what an event album is made of.
 */
export function orderClausesFor(order: PhotoOrder): OrderClause[] {
  if (order === 'manual') {
    // Hand-arranged albums keep their arrangement, and a photo the owner has NOT placed yet sorts
    // FIRST rather than last.
    //
    // "Last" is where an unplaced photo intuitively belongs, and it was wrong for the same reason
    // oldest-first was: the album page loads a 500-photo window and refreshes that window, so on a
    // hand-arranged album past 500 photos a new upload sorted beyond it and no visitor ever saw it
    // arrive. Two such albums are live, the largest 906 photos.
    //
    // Sorting unplaced photos first means new uploads are visible immediately, and the owner's
    // arrangement is untouched below them — dragging one into position is what moves it out of
    // the unplaced group, which is the same gesture that arranged the album in the first place.
    return [
      { column: 'sort_order', ascending: true, nullsFirst: true },
      { column: 'created_at', ascending: false },
      { column: 'id', ascending: false },
    ]
  }
  const ascending = order === 'oldest'
  return [
    { column: 'created_at', ascending },
    { column: 'id', ascending },
  ]
}

/**
 * Whether a new photo lands inside the FIRST window under this order — which is the whole
 * question for a live album, because the first window is what every refresh reloads.
 *
 * Used to decide whether the page must tell a visitor that newer photos exist further down.
 */
export function newPhotosLandInFirstWindow(order: PhotoOrder): boolean {
  // 'manual' qualifies because unplaced photos sort first (see orderClausesFor). 'oldest' does
  // not, and that is the honest answer: on an oldest-first album past one window, a new upload
  // is genuinely not on screen until the visitor loads more.
  return order === 'newest' || order === 'manual'
}
