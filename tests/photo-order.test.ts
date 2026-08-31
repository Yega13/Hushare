import { describe, it, expect } from 'vitest'
import {
  PHOTO_ORDERS, PHOTO_ORDER_CHOICES, isPhotoOrder, orderClausesFor, newPhotosLandInFirstWindow,
} from '../src/lib/photo-order'

describe('orderClausesFor', () => {
  it('newest puts the most recent photo first, so it lands in the refreshed window', () => {
    // THE BUG THIS MODULE EXISTS FOR. The window a live album refreshes is the first 500 rows;
    // under oldest-first a new upload sorts to position 4,567 and can never appear.
    const [primary] = orderClausesFor('newest')
    expect(primary).toEqual({ column: 'created_at', ascending: false })
    expect(newPhotosLandInFirstWindow('newest')).toBe(true)
  })

  it('oldest is chronological, and knows a new photo will NOT be in the first window', () => {
    const [primary] = orderClausesFor('oldest')
    expect(primary).toEqual({ column: 'created_at', ascending: true })
    expect(newPhotosLandInFirstWindow('oldest')).toBe(false)
  })

  it('manual leads on sort_order, so a hand-arranged album keeps its arrangement', () => {
    const [primary] = orderClausesFor('manual')
    expect(primary).toMatchObject({ column: 'sort_order', ascending: true })
    // Unplaced photos sort FIRST — see the "still shows new uploads" block below for why.
    expect(newPhotosLandInFirstWindow('manual')).toBe(true)
  })

  it('EVERY order ends on a unique column, or paging can duplicate and drop photos', () => {
    // created_at is not unique — a burst upload writes many rows in the same millisecond, which
    // is what an event album is made of. Without a unique tiebreak Postgres may order ties
    // differently between two requests, so a photo appears on page 1 and page 2, or on neither.
    for (const order of PHOTO_ORDERS) {
      const clauses = orderClausesFor(order)
      expect(clauses[clauses.length - 1].column, `${order} has no unique tiebreak`).toBe('id')
    }
  })

  it('the tiebreak runs the same direction as the column it breaks', () => {
    // A descending primary with an ascending tiebreak interleaves rows written in the same
    // millisecond in the opposite direction to everything around them.
    for (const order of PHOTO_ORDERS) {
      const clauses = orderClausesFor(order)
      const last = clauses[clauses.length - 1]
      const primary = clauses[0]
      if (order !== 'manual') expect(last.ascending).toBe(primary.ascending)
    }
  })
})

describe('isPhotoOrder', () => {
  it('accepts exactly the three real orders', () => {
    for (const v of PHOTO_ORDERS) expect(isPhotoOrder(v)).toBe(true)
    for (const v of ['', 'NEWEST', 'random', 0, null, undefined, {}]) expect(isPhotoOrder(v)).toBe(false)
  })
})

describe('PHOTO_ORDER_CHOICES', () => {
  it('does not offer manual as something to pick', () => {
    // An album becomes manual by being dragged into an order. Offering it in a menu would claim
    // an arrangement that does not exist, and picking it would render sort_order NULL for every
    // row — an album in no particular order at all.
    expect(PHOTO_ORDER_CHOICES).not.toContain('manual')
    expect([...PHOTO_ORDER_CHOICES].sort()).toEqual(['newest', 'oldest'])
  })
})

describe('a hand-arranged album still shows new uploads', () => {
  it('sorts UNPLACED photos first, not last', () => {
    // The same bug as oldest-first, one layer along: a photo the owner has not placed has a NULL
    // sort_order, and putting those last on a 906-photo album meant new uploads landed beyond the
    // 500-photo window every refresh reloads, so nobody ever saw them arrive.
    const [primary] = orderClausesFor('manual')
    expect(primary.column).toBe('sort_order')
    expect(primary.nullsFirst).toBe(true)
  })

  it('newest unplaced photo comes before older unplaced ones', () => {
    // Within the unplaced group the order is newest-first, matching what an arriving visitor
    // wants — the tiebreaks run the same direction.
    const clauses = orderClausesFor('manual')
    expect(clauses[1]).toMatchObject({ column: 'created_at', ascending: false })
    expect(clauses[2]).toMatchObject({ column: 'id', ascending: false })
  })

  it('and the page can now say so', () => {
    // newPhotosLandInFirstWindow was written to warn a visitor when new photos are NOT reachable,
    // and had drifted into describing behaviour that no longer matched.
    expect(newPhotosLandInFirstWindow('manual')).toBe(true)
    expect(newPhotosLandInFirstWindow('newest')).toBe(true)
    expect(newPhotosLandInFirstWindow('oldest')).toBe(false)
  })
})
