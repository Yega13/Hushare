import { describe, it, expect } from 'vitest'
import { binState, canRestore, isPurgeable, binMessage, BIN_DAYS } from '@/lib/album-bin'

// THE DECISION THAT DESTROYS SOMEBODY'S WEDDING IF IT IS WRONG.
//
// There is no backup of customer photos. Every branch here is written to err toward KEEPING data,
// and these tests exist to prove it errs that way even when the input is nonsense — because the
// inputs that reach it come from a database column that a clock correction, a bad migration or a
// future bug can write anything into.

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-03T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('an album nobody deleted is untouched', () => {
  it('is live for null, undefined and empty', () => {
    for (const v of [null, undefined, '']) {
      expect(binState(v, NOW).state, String(v)).toBe('live')
      expect(isPurgeable(v, NOW), 'a live album must NEVER be purgeable').toBe(false)
      expect(canRestore(v, NOW)).toBe(false)
    }
  })
})

describe('a deleted album is recoverable for exactly seven days', () => {
  it('is in the bin the moment it is deleted', () => {
    const s = binState(ago(0), NOW)
    expect(s.state).toBe('in-bin')
    if (s.state !== 'in-bin') return
    expect(s.daysLeft).toBe(7)
  })

  it('counts down, rounding UP so a day left never means an hour left', () => {
    // The owner is told the optimistic number; the purge uses the pessimistic one.
    const cases: [number, number][] = [[0.5, 7], [1, 6], [6, 1], [6.9, 1]]
    for (const [daysGone, left] of cases) {
      const s = binState(ago(daysGone * DAY), NOW)
      expect(s.state, `${daysGone} days gone`).toBe('in-bin')
      if (s.state !== 'in-bin') continue
      expect(s.daysLeft, `${daysGone} days gone`).toBe(left)
    }
  })

  it('can be restored right up to the boundary, and not after', () => {
    expect(canRestore(ago(7 * DAY - 1000), NOW)).toBe(true)
    expect(canRestore(ago(7 * DAY + 1000), NOW)).toBe(false)
  })

  it('becomes purgeable only once the full seven days have passed', () => {
    // The boundary in the direction that matters: one second early must NOT be purgeable.
    expect(isPurgeable(ago(7 * DAY - 1000), NOW), 'one second early is a wedding destroyed').toBe(false)
    expect(isPurgeable(ago(7 * DAY), NOW)).toBe(true)
    expect(isPurgeable(ago(30 * DAY), NOW)).toBe(true)
  })

  it('is seven days, not some other number', () => {
    // Pinned against a literal: toBe(BIN_DAYS) would say n === n and pass at one day.
    expect(BIN_DAYS).toBe(7)
    expect(isPurgeable(ago(6 * DAY), NOW), 'six days must still be recoverable').toBe(false)
  })
})

describe('nonsense in the column never destroys anything', () => {
  it('refuses to purge an unparseable timestamp', () => {
    for (const junk of ['tomorrow', 'null', '{}', 'NaN', '2026-13-45T99:99:99Z']) {
      expect(binState(junk, NOW).state, junk).toBe('unreadable')
      expect(isPurgeable(junk, NOW), `${junk} must never be purgeable`).toBe(false)
      expect(canRestore(junk, NOW), 'and the data must still be recoverable by hand').toBe(true)
    }
  })

  it('refuses to purge an album deleted in the FUTURE', () => {
    // A clock correction on the writing side. Elapsed time is negative, and a naive
    // `elapsed >= 7 days` comparison would be false — but a naive `Math.abs` would purge it
    // instantly. It is treated as freshly deleted (rule 22).
    const future = new Date(NOW + 3 * DAY).toISOString()
    const s = binState(future, NOW)
    expect(s.state).toBe('in-bin')
    if (s.state !== 'in-bin') return
    expect(s.daysLeft).toBe(7)
    expect(isPurgeable(future, NOW)).toBe(false)
  })

  it('refuses to purge something that has sat in the bin for a year', () => {
    // Either the timestamp is wrong or the cron has been dead for a year. Neither is a reason for
    // an irreversible automatic delete; the storage cost of being wrong is cents.
    expect(binState(ago(400 * DAY), NOW).state).toBe('unreadable')
    expect(isPurgeable(ago(400 * DAY), NOW)).toBe(false)
    expect(canRestore(ago(400 * DAY), NOW)).toBe(true)
  })
})

describe('what the owner is told', () => {
  it('does not say "1 days"', () => {
    expect(binMessage(1)).toContain('1 more day.')
    expect(binMessage(1)).not.toContain('1 more days')
    expect(binMessage(7)).toContain('7 more days')
  })
})
