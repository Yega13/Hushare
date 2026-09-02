import { describe, it, expect } from 'vitest'
import { occurrencesOf, totalOccurrences, tallyByAlbum, tallyByMessage } from '@/lib/error-alert-grouping'

// WHAT THE 3AM EMAIL HAS TO SAY.
//
// The alert used to be a number and nothing else: "23 things failed for guests in the last 10
// minutes". Enough to know something is wrong, useless for doing anything — the reader cannot tell
// one album melting down from twenty guests each hitting one blip, cannot open the album, and
// cannot contact whoever it is happening to. The rows carried album_id the whole time; the cron
// simply never selected it.
//
// The counting is the delicate half. This alarm has already been silently disarmed once by counting
// ROWS instead of repeats: api/log/client-error merges a repeat of the same message into the
// existing row and increments context.repeats, so one message failing a hundred times in one album
// — the exact incident the alert exists to catch — became two rows and never reached a threshold
// of eight. Every tally here shares one definition so that cannot happen again in a new place.

describe('how many failures one row represents', () => {
  it('a row with no repeats is one failure, never zero', () => {
    // Zero would let a malformed context hide an incident, which is the direction that matters.
    expect(occurrencesOf({})).toBe(1)
    expect(occurrencesOf({ context: null })).toBe(1)
    expect(occurrencesOf({ context: {} })).toBe(1)
  })

  it('counts the repeats a coalesced row absorbed', () => {
    expect(occurrencesOf({ context: { repeats: 40 } })).toBe(40)
  })

  it('refuses nonsense rather than trusting it', () => {
    // A NaN or a negative would otherwise subtract from the total and could push a real incident
    // back under the threshold.
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(occurrencesOf({ context: { repeats: bad } }), String(bad)).toBe(1)
    }
    expect(occurrencesOf({ context: { repeats: 7.9 } })).toBe(7)
  })

  it('totals by repeats, not by rows — the disarming bug, asserted', () => {
    // Two rows, one hundred failures. Counting rows gives 2 and the alarm never fires.
    const rows = [{ context: { repeats: 60 } }, { context: { repeats: 40 } }]
    expect(totalOccurrences(rows)).toBe(100)
  })
})

describe('which albums the email names', () => {
  const rows = [
    { album_id: 'a', context: { repeats: 5 } },
    { album_id: 'b', context: null },
    { album_id: 'a', context: { repeats: 3 } },
    { album_id: null, context: { repeats: 99 } },   // a failure on a page with no album
  ]

  it('groups by album and ranks worst first', () => {
    const { albums } = tallyByAlbum(rows)
    expect(albums).toEqual([{ albumId: 'a', count: 8 }, { albumId: 'b', count: 1 }])
  })

  it('drops rows with no album WITHOUT hiding them from the total', () => {
    // The headline count must still include them — the reader learns about them from the
    // difference between the total and the listed albums, never from a silent omission.
    expect(tallyByAlbum(rows).albums.some(a => a.albumId === null as unknown as string)).toBe(false)
    expect(totalOccurrences(rows)).toBe(108)
  })

  it('bounds the list and says how many were left out', () => {
    // "3 albums" and "3 albums plus 19 more" are very different mornings.
    const many = Array.from({ length: 9 }, (_, i) => ({ album_id: `album-${i}`, context: { repeats: 9 - i } }))
    const { albums, moreAlbums } = tallyByAlbum(many, 5)
    expect(albums).toHaveLength(5)
    expect(albums[0].albumId).toBe('album-0')      // worst first
    expect(moreAlbums).toBe(4)
  })

  it('reports no extras when everything fits', () => {
    expect(tallyByAlbum(rows, 5).moreAlbums).toBe(0)
  })

  it('is stable when two albums tie, so the same incident reads the same twice', () => {
    const tied = [{ album_id: 'zz', context: null }, { album_id: 'aa', context: null }]
    expect(tallyByAlbum(tied).albums.map(a => a.albumId)).toEqual(['aa', 'zz'])
  })

  it('says nothing at all when no row carries an album', () => {
    expect(tallyByAlbum([{ album_id: null, context: null }])).toEqual({ albums: [], moreAlbums: 0 })
  })
})

describe('which messages the email names', () => {
  it('weights by repeats, so the dominating message wins over the chattiest one', () => {
    // One row that absorbed 50 repeats matters more than three rows of one — the opposite of what
    // counting rows would report.
    const rows = [
      { message: 'upload failed', context: { repeats: 50 } },
      { message: 'chunk error', context: null },
      { message: 'chunk error', context: null },
      { message: 'chunk error', context: null },
    ]
    expect(tallyByMessage(rows)).toEqual([['upload failed', 50], ['chunk error', 3]])
  })

  it('ignores rows with no message instead of inventing an empty one', () => {
    expect(tallyByMessage([{ message: null, context: null }, { message: '', context: null }])).toEqual([])
  })

  it('bounds the list', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ message: `m${i}`, context: { repeats: 8 - i } }))
    expect(tallyByMessage(many, 5)).toHaveLength(5)
  })
})
