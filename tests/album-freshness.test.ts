import { describe, it, expect } from 'vitest'
import { albumChanged, deltaRowsNeeded, forcedRefreshAllowed, FORCED_REFRESH_MIN_GAP_MS, type AlbumFreshness } from '../src/lib/album-freshness'

const at = (total: number, latest: string | null): AlbumFreshness => ({ total, latest })

describe('albumChanged', () => {
  it('skips the fetch when nothing moved — the whole point', () => {
    expect(albumChanged(at(4567, '2026-08-31T01:07:58Z'), at(4567, '2026-08-31T01:07:58Z'))).toBe(false)
  })

  it('fetches when a photo was added', () => {
    expect(albumChanged(at(4567, '2026-08-31T01:07:58Z'), at(4568, '2026-08-31T01:09:00Z'))).toBe(true)
  })

  it('fetches when a photo was deleted, which the timestamp alone cannot see', () => {
    // Deleting an older photo leaves the newest one untouched. Without the count this is invisible
    // and the guest keeps a tile for a photo that no longer exists.
    expect(albumChanged(at(4567, '2026-08-31T01:07:58Z'), at(4566, '2026-08-31T01:07:58Z'))).toBe(true)
  })

  it('fetches when one was added and one deleted between polls, which the count alone cannot see', () => {
    // The count is unchanged; only the newest timestamp reveals it. This is exactly why both
    // fields are compared and neither is sufficient.
    expect(albumChanged(at(4567, '2026-08-31T01:07:58Z'), at(4567, '2026-08-31T01:20:00Z'))).toBe(true)
  })

  it('fetches when the probe failed — never skips on a non-answer', () => {
    // A failed probe knows nothing. Skipping would leave a guest on a stale album believing it is
    // complete, which is the failure this path exists to prevent; a wasted fetch only costs bytes.
    expect(albumChanged(at(4567, '2026-08-31T01:07:58Z'), null)).toBe(true)
  })

  it('fetches on the first run, when nothing has been recorded yet', () => {
    expect(albumChanged(null, at(4567, '2026-08-31T01:07:58Z'))).toBe(true)
    expect(albumChanged(null, null)).toBe(true)
  })

  it('handles an empty album on both sides without treating null as unknown', () => {
    expect(albumChanged(at(0, null), at(0, null))).toBe(false)
    expect(albumChanged(at(0, null), at(1, '2026-08-31T01:07:58Z'))).toBe(true)
    // Emptied since last look: count moved, so it refetches and the grid clears honestly.
    expect(albumChanged(at(1, '2026-08-31T01:07:58Z'), at(0, null))).toBe(true)
  })
})

describe('deltaRowsNeeded', () => {
  const at = (total: number, latest: string | null): AlbumFreshness => ({ total, latest })
  const A = '2026-08-31T01:00:00Z'
  const B = '2026-08-31T01:05:00Z'

  it('asks for only the new rows when photos were added', () => {
    // The whole point: 3 new photos should cost 3 rows, not a 500-row window.
    expect(deltaRowsNeeded(at(4564, A), at(4567, B), 100)).toBe(3)
  })

  it('falls back to the window on a DELETION, which a delta cannot express', () => {
    // "Rows newer than X" can never remove a photo the client is still showing.
    expect(deltaRowsNeeded(at(4564, A), at(4563, A), 100)).toBeNull()
    expect(deltaRowsNeeded(at(4564, A), at(4563, B), 100)).toBeNull()
  })

  it('falls back when nothing changed at all', () => {
    expect(deltaRowsNeeded(at(4564, A), at(4564, A), 100)).toBeNull()
  })

  it('falls back when an edit moved the timestamp but not the count', () => {
    // A reorder or a settings change: no new rows to ask for, and the window is the honest answer.
    expect(deltaRowsNeeded(at(4564, A), at(4564, B), 100)).toBeNull()
  })

  it('falls back when the growth is bigger than a delta would save', () => {
    expect(deltaRowsNeeded(at(4000, A), at(4600, B), 100)).toBeNull()
    expect(deltaRowsNeeded(at(4000, A), at(4100, B), 100)).toBe(100)
  })

  it('falls back when the album grew but nothing is NEWER — never guesses', () => {
    // An import backdated behind what we hold, or a clock that moved backwards. Growth alone is
    // not enough to know which rows are missing.
    expect(deltaRowsNeeded(at(4564, B), at(4567, A), 100)).toBeNull()
    expect(deltaRowsNeeded(at(4564, B), at(4567, B), 100)).toBeNull()
    expect(deltaRowsNeeded(at(0, null), at(3, B), 100)).toBeNull()
  })

  it('falls back with nothing recorded, or a failed probe', () => {
    expect(deltaRowsNeeded(null, at(4567, B), 100)).toBeNull()
    expect(deltaRowsNeeded(at(4564, A), null, 100)).toBeNull()
  })
})

describe('how often a broadcast may force a full-window fetch', () => {
  // WHY THIS BOUND EXISTS. The `changed` channel is `album:<id>` and clients subscribe with the
  // public anon key, so anyone holding an album link can publish to it. The payload was already
  // untrusted, but the FORCE was not bounded: one forged message made every connected viewer pull
  // the whole ~228-424 KB window, from their own ip, so the per-ip limit on the photos route never
  // saw it. A real reorder must still land immediately, which is the only reason force exists.

  it('allows the first force, because a reorder must land immediately', () => {
    expect(forcedRefreshAllowed(null, 1_000_000)).toBe(true)
  })

  it('refuses a second force inside the gap — this is the amplification bound', () => {
    expect(forcedRefreshAllowed(1_000_000, 1_000_000 + 2_500)).toBe(false)
    expect(forcedRefreshAllowed(1_000_000, 1_000_000 + FORCED_REFRESH_MIN_GAP_MS - 1)).toBe(false)
  })

  it('allows again once the gap has passed', () => {
    expect(forcedRefreshAllowed(1_000_000, 1_000_000 + FORCED_REFRESH_MIN_GAP_MS)).toBe(true)
  })

  it('a clock that went BACKWARDS does not block refreshes for the length of the jump', () => {
    // Rule 22. An NTP correction or a timezone change makes now < last. Left unclamped this
    // returns false until real time catches up, which for an hour-long jump means an hour of a
    // guest looking at a stale album — the exact failure that once deferred a refresh forever.
    expect(forcedRefreshAllowed(5_000_000, 1_000_000)).toBe(true)
  })

  it('an implausibly large jump forward is treated as a clock move, not an allowance', () => {
    expect(forcedRefreshAllowed(1_000, 1_000 + 25 * 60 * 60 * 1000)).toBe(true)
  })

  it('an unusable reading errs toward fetching, like everything else here', () => {
    expect(forcedRefreshAllowed(Number.NaN, 1_000_000)).toBe(true)
    expect(forcedRefreshAllowed(1_000_000, Number.NaN)).toBe(true)
    expect(forcedRefreshAllowed(Number.POSITIVE_INFINITY, 1_000_000)).toBe(true)
  })
})
