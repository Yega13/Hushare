import { describe, it, expect } from 'vitest'
import { toDatetimeLocal, revealRequestFor, revealStatus } from '@/lib/reveal-input'

// THE DELAYED-REVEAL RULES: what the picker shows, what a save sends, whether the album is sealed.

describe('toDatetimeLocal -- what the picker shows for a stored reveal', () => {
  it('formats a timestamp as the local wall-clock value the input can hold', () => {
    const iso = new Date(2026, 8, 20, 18, 30).toISOString()   // local 20 Sep 2026 18:30
    expect(toDatetimeLocal(iso)).toBe('2026-09-20T18:30')
  })
  it('reads the LOCAL date even when UTC is a different day -- half past midnight on the first', () => {
    // The one bug class this exists to prevent: an owner near midnight reading yesterday's date in
    // the picker. A review's mutation swapped the local getters for UTC ones and every mid-day
    // fixture stayed green; this one does not, in any timezone that is not UTC itself.
    const iso = new Date(2026, 9, 1, 0, 30).toISOString()   // local 1 Oct 2026 00:30
    expect(toDatetimeLocal(iso)).toBe('2026-10-01T00:30')
    const d = new Date(iso)
    if (d.getTimezoneOffset() !== 0) {
      expect(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`).not.toBe('2026-10-01')
    }
  })
  it('pads single-digit months, days, hours and minutes', () => {
    expect(toDatetimeLocal(new Date(2026, 0, 5, 7, 4).toISOString())).toBe('2026-01-05T07:04')
  })
  it('is empty for no reveal, and for a value that is not a date', () => {
    expect(toDatetimeLocal(null)).toBe('')
    expect(toDatetimeLocal('')).toBe('')
    expect(toDatetimeLocal('not a date')).toBe('')
  })
})

describe('revealRequestFor -- what a save or a clear sends', () => {
  it('a clear sends null whatever the input holds', () => {
    expect(revealRequestFor('clear', '2026-09-20T18:30')).toEqual({ ok: true, revealAt: null })
  })
  it('a set sends the input as an ISO instant', () => {
    const r = revealRequestFor('set', '2026-09-20T18:30')
    expect(r).toEqual({ ok: true, revealAt: new Date('2026-09-20T18:30').toISOString() })
  })
  it('a set with an empty input sends null -- the keyboard path past a disabled button', () => {
    expect(revealRequestFor('set', '')).toEqual({ ok: true, revealAt: null })
  })
  it('REFUSES text that is not a date before any request goes out', () => {
    // The old panel validated after flipping "saving" on; an invalid date left the button on
    // "Saving..." forever. Refusing here is what keeps that from being possible.
    expect(revealRequestFor('set', 'tomorrow-ish')).toEqual({ ok: false, error: 'invalid' })
  })
})

describe('revealStatus -- is the album still sealed?', () => {
  // A `now` years from the wall clock, so a version that ignored the argument and read the clock
  // could not pass by coincidence (it did, with fixtures a day either side of the day it was written).
  const now = new Date('2031-03-15T12:00:00Z')
  it('future when the reveal is ahead of now, even though the wall clock has long passed it', () => {
    expect(revealStatus('2031-03-16T12:00:00Z', now)).toBe('future')
    // A reveal the wall clock passed years ago is still FUTURE against a `now` before it: the only
    // outcome a version reading the real clock cannot produce.
    expect(revealStatus('2020-06-01T00:00:00Z', new Date('2020-01-01T00:00:00Z'))).toBe('future')
  })
  it('past when it is behind, and at the exact instant', () => {
    expect(revealStatus('2031-03-14T12:00:00Z', now)).toBe('past')
    expect(revealStatus('2031-03-15T12:00:00Z', now)).toBe('past')
  })
  it('none with no reveal or an unparseable one', () => {
    expect(revealStatus(null, now)).toBe('none')
    expect(revealStatus(undefined, now)).toBe('none')
    expect(revealStatus('garbage', now)).toBe('none')
  })
})
