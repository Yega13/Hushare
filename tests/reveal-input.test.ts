import { describe, it, expect } from 'vitest'
import { toDatetimeLocal, revealRequestFor, revealStatus } from '@/lib/reveal-input'

// THE DELAYED-REVEAL RULES: what the picker shows, what a save sends, whether the album is sealed.

describe('toDatetimeLocal -- what the picker shows for a stored reveal', () => {
  it('formats a timestamp as the local wall-clock value the input can hold', () => {
    const iso = new Date(2026, 8, 20, 18, 30).toISOString()   // local 20 Sep 2026 18:30
    expect(toDatetimeLocal(iso)).toBe('2026-09-20T18:30')
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
  const now = new Date('2026-09-07T12:00:00Z')
  it('future when the reveal is ahead of now', () => {
    expect(revealStatus('2026-09-08T12:00:00Z', now)).toBe('future')
  })
  it('past when it is behind, and at the exact instant', () => {
    expect(revealStatus('2026-09-06T12:00:00Z', now)).toBe('past')
    expect(revealStatus('2026-09-07T12:00:00Z', now)).toBe('past')
  })
  it('none with no reveal or an unparseable one', () => {
    expect(revealStatus(null, now)).toBe('none')
    expect(revealStatus(undefined, now)).toBe('none')
    expect(revealStatus('garbage', now)).toBe('none')
  })
})
