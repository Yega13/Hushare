import { describe, it, expect } from 'vitest'
import {
  occurrencesOf, totalOccurrences, tallyByAlbum, tallyByMessage, MAX_REPEATS_PER_ROW,
  alertVerdict, albumBlockFor, parseAlertState, THRESHOLD, MAX_ALERTS_PER_HOUR,
} from '@/lib/error-alert-grouping'

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

describe('one request must not be able to silence the alarm', () => {
  // context.repeats is ATTACKER-WRITTEN. api/log/client-error accepts any small object as context
  // and stores it verbatim; its only protection is an Origin header, which curl sets for free. So
  //
  //     POST /api/log/client-error
  //     Origin: https://hushare.space
  //     {"source":"x","message":"y","level":"error","context":{"repeats":100000}}
  //
  // cleared the threshold of 8 on its own, fired the alert, and CLAIMED THE 60-MINUTE COOLDOWN —
  // so every real incident in the next hour was never sent. Hourly repetition keeps the alarm
  // permanently occupied.
  it('caps what a single row may claim', () => {
    expect(occurrencesOf({ context: { repeats: 100000 } })).toBe(MAX_REPEATS_PER_ROW)
    expect(occurrencesOf({ context: { repeats: Number.MAX_SAFE_INTEGER } })).toBe(MAX_REPEATS_PER_ROW)
  })

  it('leaves every honest row untouched', () => {
    // The coalescing window is five minutes, so a real row never approaches the cap. A bound that
    // clipped ordinary rows would understate real incidents, which is the opposite failure.
    expect(occurrencesOf({ context: { repeats: 1 } })).toBe(1)
    expect(occurrencesOf({ context: { repeats: 40 } })).toBe(40)
    expect(occurrencesOf({ context: { repeats: 999 } })).toBe(999)
  })

  it('a capped row still reads as a big row, so a real storm is not hidden', () => {
    // The cap must not make a genuine flood look small — it only stops one request manufacturing
    // one. Two capped rows still dwarf the threshold.
    const flood = [{ context: { repeats: 5000 } }, { context: { repeats: 5000 } }]
    expect(totalOccurrences(flood)).toBe(2 * MAX_REPEATS_PER_ROW)
    expect(totalOccurrences(flood)).toBeGreaterThan(8)
  })
})

describe('whether to send at all', () => {
  // TWELVE MUTATIONS TO THIS LOGIC PASSED THE WHOLE SUITE while it was four comparisons inside the
  // cron route — including THRESHOLD to 100000, after which the alarm can never fire again, and
  // deleting the cooldown claim, after which it emails every minute for the length of an incident.
  const NOW = Date.parse('2026-09-02T12:00:00.000Z')
  const ago = (mins: number) => new Date(NOW - mins * 60_000).toISOString()

  it('stays quiet below the threshold, and fires exactly AT it', () => {
    const base = { signature: 'boom', previous: null, nowMs: NOW }
    expect(alertVerdict({ ...base, count: THRESHOLD - 1 })).toEqual({ send: false, reason: 'below-threshold' })
    expect(alertVerdict({ ...base, count: THRESHOLD }).send).toBe(true)
  })

  it('suppresses the SAME incident inside the hour', () => {
    const previous = { sentAt: ago(30), signature: 'boom', hourStart: ago(30), sentThisHour: 1 }
    expect(alertVerdict({ count: 50, signature: 'boom', previous, nowMs: NOW }))
      .toEqual({ send: false, reason: 'same-incident' })
  })

  it('SENDS a different incident in the same hour — the defect with nobody attacking anything', () => {
    // A flat hourly cooldown dropped this: different failure, different album, same hour, never
    // sent. That is the reason to change it; closing the poisoning attack is the side effect.
    const previous = { sentAt: ago(30), signature: 'boom', hourStart: ago(30), sentThisHour: 1 }
    expect(alertVerdict({ count: 50, signature: 'a completely different failure', previous, nowMs: NOW }).send).toBe(true)
  })

  it('sends the same incident again once the hour has passed', () => {
    const previous = { sentAt: ago(61), signature: 'boom', hourStart: ago(61), sentThisHour: 1 }
    expect(alertVerdict({ count: 50, signature: 'boom', previous, nowMs: NOW }).send).toBe(true)
  })

  it('never exceeds the hourly ceiling, whatever the signature', () => {
    // The floor under the signature rule: a poisoner can make the alarm noisier, never silent, and
    // never a flood. Worst case is MAX_ALERTS_PER_HOUR emails.
    const previous = { sentAt: ago(5), signature: 'x', hourStart: ago(50), sentThisHour: MAX_ALERTS_PER_HOUR }
    expect(alertVerdict({ count: 50, signature: 'brand new', previous, nowMs: NOW }))
      .toEqual({ send: false, reason: 'hourly-cap' })
  })

  it('starts a fresh hour once the old one has elapsed', () => {
    const previous = { sentAt: ago(70), signature: 'x', hourStart: ago(70), sentThisHour: MAX_ALERTS_PER_HOUR }
    const v = alertVerdict({ count: 50, signature: 'x2', previous, nowMs: NOW })
    expect(v.send).toBe(true)
    if (!v.send) return
    expect(v.nextState.sentThisHour).toBe(1)
  })

  it('counts sends within the hour so the ceiling can be reached', () => {
    const previous = { sentAt: ago(5), signature: 'a', hourStart: ago(50), sentThisHour: 2 }
    const v = alertVerdict({ count: 50, signature: 'b', previous, nowMs: NOW })
    expect(v.send).toBe(true)
    if (!v.send) return
    expect(v.nextState.sentThisHour).toBe(3)
    expect(v.nextState.hourStart, 'the hour window must not restart on every send').toBe(previous.hourStart)
  })

  it('a clock that jumped does not suppress an incident', () => {
    // Rule 22: both elapsed times are differences of two stored readings. Negative or absurd means
    // the clock moved, not the incident — and the safe reading is to SEND.
    const backwards = { sentAt: new Date(NOW + 5 * 60_000).toISOString(), signature: 'boom', hourStart: ago(10), sentThisHour: 1 }
    expect(alertVerdict({ count: 50, signature: 'boom', previous: backwards, nowMs: NOW }).send).toBe(true)
    const ancient = { sentAt: ago(60 * 48), signature: 'boom', hourStart: ago(60 * 48), sentThisHour: 99 }
    expect(alertVerdict({ count: 50, signature: 'boom', previous: ancient, nowMs: NOW }).send).toBe(true)
  })

  it('with no history at all, it sends', () => {
    expect(alertVerdict({ count: 50, signature: 'boom', previous: null, nowMs: NOW }).send).toBe(true)
  })
})

describe('reading the stored alert state', () => {
  it('understands the OLD bare-timestamp format a deploy will find in the column', () => {
    // Before this it stored a plain ISO string. Treating that as "no previous alert" would fire
    // immediately on deploy; throwing would take the alarm out entirely.
    const parsed = parseAlertState('2026-09-02T11:00:00.000Z')
    expect(parsed?.sentAt).toBe('2026-09-02T11:00:00.000Z')
    expect(parsed?.signature, 'a legacy row has no fingerprint, so it cannot suppress by signature').toBeUndefined()
  })

  it('reads the new format', () => {
    const parsed = parseAlertState('{"sentAt":"2026-09-02T11:00:00.000Z","signature":"boom","sentThisHour":2}')
    expect(parsed).toMatchObject({ signature: 'boom', sentThisHour: 2 })
  })

  it('treats junk as no history, which errs toward sending', () => {
    for (const junk of [null, undefined, '', '   ', 'not a date', '{oops']) {
      expect(parseAlertState(junk), String(junk)).toBeNull()
    }
  })
})

describe('the album block the email renders', () => {
  const resolved = (slug: string, email: string) => ({ title: 'T', slug, email })

  it('keeps an album we could not name, and drops one that is gone', () => {
    const { albums, moreAlbums, lookupFailed } = albumBlockFor([
      { album_id: 'a', count: 5, album: resolved('aaa', 'a@b.com') },
      { album_id: 'b', count: 3, album: null },
      { album_id: 'c', count: 2, album: undefined },
    ], 0)
    expect(albums.map(a => a.slug)).toEqual(['aaa', ''])
    expect(albums[1].owner).toBe('(unknown user)')
    expect(moreAlbums, 'the dropped album is counted, not silently lost').toBe(1)
    expect(lookupFailed).toBe(false)
  })

  it('says the lookup failed only when NOTHING resolved', () => {
    expect(albumBlockFor([{ album_id: 'a', count: 1, album: undefined }], 0).lookupFailed).toBe(true)
    expect(albumBlockFor([
      { album_id: 'a', count: 1, album: undefined },
      { album_id: 'b', count: 1, album: resolved('bbb', 'b@c.com') },
    ], 0).lookupFailed).toBe(false)
  })

  it('adds the capped-out albums to the dropped ones, and never goes negative', () => {
    const { moreAlbums } = albumBlockFor([
      { album_id: 'a', count: 1, album: resolved('aaa', 'a@b.com') },
      { album_id: 'b', count: 1, album: null },
      { album_id: 'c', count: 1, album: null },
    ], 4)
    expect(moreAlbums).toBe(6)
    expect(albumBlockFor([], 0).moreAlbums).toBe(0)
  })

  it('an empty list is not a failed lookup', () => {
    expect(albumBlockFor([], 0)).toEqual({ albums: [], moreAlbums: 0, lookupFailed: false })
  })
})
