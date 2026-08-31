import { describe, it, expect } from 'vitest'
import { albumChanged, type AlbumFreshness } from '../src/lib/album-freshness'

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
