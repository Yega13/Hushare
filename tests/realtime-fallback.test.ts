import { describe, it, expect } from 'vitest'
import { FALLBACK_POLL_BASE_MS, fallbackPollDelay } from '../src/lib/realtime-fallback'

describe('fallbackPollDelay', () => {
  // Rule 16's founding failure was a jitter test that passed rand in explicitly, proving
  // the parameter and nothing about the real path. These tests call the DEFAULT.
  it('jitters BY DEFAULT: 200 real calls all land in [45s, 75s]', () => {
    for (let i = 0; i < 200; i++) {
      const d = fallbackPollDelay()
      expect(d).toBeGreaterThanOrEqual(FALLBACK_POLL_BASE_MS * 0.75)
      expect(d).toBeLessThanOrEqual(FALLBACK_POLL_BASE_MS * 1.25)
    }
  })

  it('actually varies — a fixed interval would make every blocked client poll in lockstep', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 50; i++) seen.add(fallbackPollDelay())
    expect(seen.size).toBeGreaterThan(10)
  })

  it('is slow enough to be a floor, not a second realtime', () => {
    // 45s minimum: hundreds of websocket-blocked clients polling faster than this is
    // exactly the load spike the fallback exists to avoid causing.
    expect(fallbackPollDelay(() => 0)).toBe(45_000)
    expect(fallbackPollDelay(() => 0.999999)).toBeLessThanOrEqual(75_000)
  })
})
