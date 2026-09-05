import { describe, it, expect } from 'vitest'
import { parseSponsorLogos } from '@/lib/sponsor-logos'

// THE CRASH THIS EXISTS FOR, written as a test.
//
// MISTAKES.md: `sponsor_logos` is jsonb, so a `url` field could hold a NUMBER, and `startsWith` on
// it threw IN THE MIDDLE OF DELETING AN ALBUM. The hand-written type said SponsorLogo[], so nothing
// checked. Every case below is a shape the database will happily store and the old type denied.

describe('anything the jsonb column can actually hold', () => {
  it('a url holding a NUMBER is dropped, not passed on', () => {
    // The exact row that threw. If this ever returns the entry, startsWith is live again.
    expect(parseSponsorLogos([{ id: 'a', url: 12345, name: 'Acme' }])).toEqual([])
  })

  it('keeps the good entries from a mixed array', () => {
    // Dropping the whole array because one entry is bad would lose marks the owner paid for.
    expect(parseSponsorLogos([
      { id: 'a', url: 'https://x/1.png', name: 'Acme' },
      { id: 'b', url: 99, name: 'Broken' },
      { id: 'c', url: 'https://x/2.png', name: null },
    ])).toEqual([
      { id: 'a', url: 'https://x/1.png', name: 'Acme' },
      { id: 'c', url: 'https://x/2.png', name: null },
    ])
  })

  it('a value that is not an array at all gives an empty list', () => {
    // jsonb accepts a bare object, a string, a number or a bool. None of them is a sponsor list.
    for (const v of [null, undefined, {}, 'nope', 42, true, { url: 'https://x/1.png' }]) {
      expect(parseSponsorLogos(v), String(v)).toEqual([])
    }
  })

  it('drops entries that are null, arrays, or primitives', () => {
    expect(parseSponsorLogos([null, ['https://x/1.png'], 'https://x/2.png', 7])).toEqual([])
  })

  it('drops an entry with no url and one with an empty url', () => {
    // An empty string renders nothing and produces no R2 key, so it is not a usable mark.
    expect(parseSponsorLogos([{ id: 'a', name: 'x' }, { id: 'b', url: '', name: 'y' }])).toEqual([])
  })

  it('a non-string name becomes null rather than reaching the page', () => {
    expect(parseSponsorLogos([{ id: 'a', url: 'https://x/1.png', name: 999 }]))
      .toEqual([{ id: 'a', url: 'https://x/1.png', name: null }])
  })

  it('a missing id falls back to the url instead of dropping a usable mark', () => {
    // The url is what identifies the object in storage, so the mark still renders and still
    // deletes. Dropping it would cost the owner a sponsor they are paying to show.
    expect(parseSponsorLogos([{ url: 'https://x/1.png' }]))
      .toEqual([{ id: 'https://x/1.png', url: 'https://x/1.png', name: null }])
  })

  it('an already-correct array passes through unchanged', () => {
    // The other half of rule 20's shape: having made the bad case impossible, the good case must
    // still work exactly as before.
    const good = [{ id: 'a', url: 'https://x/1.png', name: 'Acme' }]
    expect(parseSponsorLogos(good)).toEqual(good)
  })
})
