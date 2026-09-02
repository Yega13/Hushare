import { describe, it, expect } from 'vitest'
import {
  occurrencesOf, totalOccurrences, tallyByAlbum, tallyByMessage, MAX_REPEATS_PER_ROW,
  alertVerdict, albumBlockFor, parseAlertState, THRESHOLD, MAX_ALERTS_PER_HOUR,
  MAX_ALERTED_TRACKED, RETRY_AFTER_FAILURE_MINUTES, COOLDOWN_MINUTES,
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

  it('the hourly ceiling is FOUR, pinned to a literal', () => {
    // A LITERAL, because asserting against the imported constant only says `n === n`. Raising it to
    // 99999 — which removes the ceiling the whole flood argument rests on — passed the entire file
    // (rule 17). Lowering it to 3 passed too. Every value >= 3 did.
    expect(MAX_ALERTS_PER_HOUR).toBe(4)
  })

  it('never exceeds the hourly ceiling, whatever the signature', () => {
    // The floor under the signature rule, and the reason a poisoner cannot turn the alarm into a
    // flood. It is NOT a guarantee of "never silence" — see the test below, which is the honest
    // version of a claim this file used to make and the code could not keep.
    const previous = { sentAt: ago(5), signature: 'x', hourStart: ago(50), sentThisHour: 4 }
    expect(alertVerdict({ count: 50, signature: 'brand new', previous, nowMs: NOW }))
      .toEqual({ send: false, reason: 'hourly-cap' })
  })

  it('AND THAT CEILING CAN BE SPENT BY AN ATTACKER, which is the residual', () => {
    // THE CLAIM THIS REPLACES WAS FALSE. The module said "a poisoner can make the alarm noisier,
    // never silent" and the commit message repeated it. Four unauthenticated POSTs to
    // /api/log/client-error, each with a different message so each becomes the dominating
    // signature, send four alerts and spend the hour — after which a GENUINE incident with a brand
    // new signature is refused with 'hourly-cap' for the rest of that hour.
    //
    // The hole is narrowed, not closed: one request bought 60 minutes of silence before, four buy
    // about 56 now, and the operator gets four emails telling them something is happening. It
    // cannot be closed at this layer at all — the endpoint has to accept anonymous reports from
    // guests' browsers or it stops being telemetry, so the real fix is authentication or corroborating
    // signal, not a bigger number here.
    //
    // Asserted rather than commented, so nobody can believe the old claim again.
    const spent = { sentAt: ago(1), signature: 'attacker-4', hourStart: ago(3), sentThisHour: 4 }
    expect(alertVerdict({ count: 500, signature: 'a real incident nobody has seen', previous: spent, nowMs: NOW }))
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

describe('the hourly counter can never be sent backwards', () => {
  it('always claims at least one, whatever the previous state', () => {
    // THE INVARIANT THE CRON'S ROLLBACK DEPENDS ON. When a send fails, the route gives the hourly
    // slot back by subtracting one from what it claimed. That is only safe while a claim is always
    // >= 1 — and it is, because this function emits `sentThisHour + 1` from a count it has already
    // floored at zero. Asserted here, where the number is decided, rather than clamped again at the
    // call site where no test could ever make the clamp fire (rule 15).
    const previous = [
      null,
      {},
      { sentThisHour: 0 },
      { sentThisHour: -5 },
      { sentThisHour: 0.5 },
      { sentThisHour: Number.NaN },
      { sentThisHour: 1, hourStart: new Date().toISOString() },
    ]
    for (const prev of previous) {
      const v = alertVerdict({
        count: 999, signature: `sig-${JSON.stringify(prev)}`,
        previous: prev as never, nowMs: Date.now(),
      })
      if (!v.send) continue
      expect(v.nextState.sentThisHour, `previous=${JSON.stringify(prev)}`).toBeGreaterThanOrEqual(1)
      // And it is a whole number, or the rollback leaves a fraction behind that never returns to 0.
      expect(Number.isInteger(v.nextState.sentThisHour)).toBe(true)
    }
  })
})

describe('two failure modes at equal weight do not look like two incidents', () => {
  // One network drop on Safari produces "Failed to fetch" and "Load failed" in roughly equal
  // numbers. With no tiebreak the winner was decided by which row arrived first — and rows arrive
  // newest-first, so it FLIPPED between ticks. Every flip reads as a new incident, so the alarm
  // sends again and again until it hits the hourly ceiling, and is then silent for the rest of the
  // hour: four emails about one problem, then nothing while it is still happening.
  const tied = (order: string[]) => order.map((message) => ({
    album_id: 'a', message, source: 's', ua: null, context: { repeats: 50 },
  }))

  it('ranks a tie the same way whatever order the rows arrive in', () => {
    const forward = tallyByMessage(tied(['Failed to fetch', 'Load failed']))
    const reversed = tallyByMessage(tied(['Load failed', 'Failed to fetch']))
    // The reversed case is the one that does the killing: V8's sort is stable, so without a
    // tiebreak these two disagree.
    expect(forward[0][0]).toBe(reversed[0][0])
    expect(forward.map((t) => t[0])).toEqual(reversed.map((t) => t[0]))
  })

  it('and the tie does not defeat the same-incident rule', () => {
    // The consequence, asserted where it costs something rather than only in the sort.
    const first = tallyByMessage(tied(['Failed to fetch', 'Load failed']))[0][0]
    const second = tallyByMessage(tied(['Load failed', 'Failed to fetch']))[0][0]
    const previous = { sentAt: new Date(Date.now() - 60_000).toISOString(), signature: first, sentThisHour: 1, hourStart: new Date().toISOString() }
    const v = alertVerdict({ count: 999, signature: second, previous, nowMs: Date.now() })
    expect(v.send, 'one incident must not re-alert a minute later because a tie flipped').toBe(false)
  })
})

describe('a loud attacker cannot hide a real incident behind their own message', () => {
  // THE HOLE THIS CLOSES. /api/log/client-error is unauthenticated, its `source` is attacker-chosen
  // free text and part of the coalescing key (so N sources = N rows), and MAX_REPEATS_PER_ROW caps a
  // ROW while tallyByMessage sums ACROSS rows. Whoever shouted loudest therefore owned the
  // signature — and matching on that ONE message suppressed the entire tick. About 1,340 requests an
  // hour silenced every genuine incident indefinitely, while a plausible-looking email kept arriving
  // once an hour, which reads as the alarm working.
  //
  // Suppression is keyed to every NOTABLE message now: a tick is "the same incident" only when
  // nothing in it is new.
  const attacker = 'ResizeObserver loop limit exceeded'
  const real = 'tus chunk failed'
  const minuteAgo = () => new Date(Date.now() - 60_000).toISOString()

  it('still suppresses a repeat of the very same thing', () => {
    // The cooldown has to keep working, or this trade is a bad one.
    const previous = { sentAt: minuteAgo(), signature: attacker, alerted: [attacker], sentThisHour: 1, hourStart: new Date().toISOString() }
    const v = alertVerdict({ count: 300000, signature: attacker, notable: [attacker], previous, nowMs: Date.now() })
    expect(v.send).toBe(false)
    if (v.send) return
    expect(v.reason).toBe('same-incident')
  })

  it('ALERTS when a real failure appears behind the pinned one', () => {
    // The attacker still dominates the ranking, so the signature is still theirs — but the genuine
    // message reached the threshold on its own, so it is new, so the alarm fires.
    const previous = { sentAt: minuteAgo(), signature: attacker, alerted: [attacker], sentThisHour: 1, hourStart: new Date().toISOString() }
    const v = alertVerdict({
      count: 300900, signature: attacker, notable: [attacker, real], previous, nowMs: Date.now(),
    })
    expect(v.send, 'a real incident must not be suppressed by somebody else noise').toBe(true)
    if (!v.send) return
    expect(v.nextState.alerted).toContain(real)
  })

  it('does not re-alert once that real failure has been reported', () => {
    const previous = { sentAt: minuteAgo(), signature: attacker, alerted: [attacker, real], sentThisHour: 1, hourStart: new Date().toISOString() }
    const v = alertVerdict({ count: 300900, signature: attacker, notable: [attacker, real], previous, nowMs: Date.now() })
    expect(v.send).toBe(false)
  })

  it('falls back to the signature when no single message is big on its own', () => {
    // A broad incident: many different small failures that only reach the threshold together. That
    // is the behaviour that existed before, and it must not change.
    const previous = { sentAt: minuteAgo(), signature: 'mixed', alerted: ['mixed'], sentThisHour: 1, hourStart: new Date().toISOString() }
    expect(alertVerdict({ count: 50, signature: 'mixed', notable: [], previous, nowMs: Date.now() }).send).toBe(false)
    expect(alertVerdict({ count: 50, signature: 'something else', notable: [], previous, nowMs: Date.now() }).send).toBe(true)
  })

  it('reads an OLD state row, which has no alerted list at all', () => {
    // A deploy must not make every incident look new (a mail burst) or every incident look old
    // (silence). The signature is the fallback.
    const legacy = { sentAt: minuteAgo(), signature: attacker, sentThisHour: 1, hourStart: new Date().toISOString() }
    expect(alertVerdict({ count: 99, signature: attacker, notable: [attacker], previous: legacy, nowMs: Date.now() }).send).toBe(false)
    expect(alertVerdict({ count: 99, signature: real, notable: [real], previous: legacy, nowMs: Date.now() }).send).toBe(true)
  })

  it('bounds what it carries forward, so the state row cannot grow without limit', () => {
    const many = Array.from({ length: 50 }, (_, i) => `failure ${i}`)
    const v = alertVerdict({ count: 999, signature: many[0], notable: many, previous: null, nowMs: Date.now() })
    expect(v.send).toBe(true)
    if (!v.send) return
    expect(v.nextState.alerted!.length).toBeLessThanOrEqual(MAX_ALERTED_TRACKED)
    expect(MAX_ALERTED_TRACKED).toBe(8)
  })
})

describe('a failed send is not a send', () => {
  // One 500 from the mail API used to buy sixty minutes of silence about the incident that was
  // actually happening: the cooldown was claimed before sending and only the counter was given back.
  it('waits a short moment, then tries the same incident again', () => {
    const justFailed = { lastFailedAt: new Date(Date.now() - 5_000).toISOString() }
    const v1 = alertVerdict({ count: 99, signature: 'boom', notable: ['boom'], previous: justFailed, nowMs: Date.now() })
    expect(v1.send).toBe(false)
    if (!v1.send) expect(v1.reason).toBe('retry-wait')

    const older = { lastFailedAt: new Date(Date.now() - (RETRY_AFTER_FAILURE_MINUTES + 1) * 60_000).toISOString() }
    expect(alertVerdict({ count: 99, signature: 'boom', notable: ['boom'], previous: older, nowMs: Date.now() }).send).toBe(true)
  })

  it('the wait is short — minutes, not the hour it used to cost', () => {
    expect(RETRY_AFTER_FAILURE_MINUTES).toBe(2)
    expect(RETRY_AFTER_FAILURE_MINUTES).toBeLessThan(COOLDOWN_MINUTES)
  })
})
