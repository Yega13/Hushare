import { describe, it, expect } from 'vitest'
import { resolveMaxDurationSeconds } from '../src/lib/stream-duration'
import { videoCaps, clipTooLong } from '../src/lib/album-entitlements'

describe('resolveMaxDurationSeconds — the reservation must never be smaller than the clip', () => {
  it('NEVER returns less than the duration it was given', () => {
    // THE PROPERTY THIS FILE EXISTS FOR. Cloudflare does not refuse an upload longer than
    // maxDurationSeconds up front — it takes the bytes and fails during processing. So a value
    // even slightly too small means a guest uploads their whole video and watches it die at 100%.
    for (let d = 1; d <= 3600; d += 7) {
      expect(resolveMaxDurationSeconds(d), `duration ${d}`).toBeGreaterThan(d)
    }
  })

  it('never hands Cloudflare a ceiling below a clip our own check just APPROVED', () => {
    // The two halves have to agree, and this is where they meet. I once clamped this to the tier
    // cap: a Pro clip of 120.5s passed clipTooLong (cap 120 + 1s slack) and then got a 120s
    // ceiling — approved by us, killed at 100% by Cloudflare. Exactly the person who trimmed
    // their video to the advertised limit.
    for (const tier of ['free', 'pro', 'studio'] as const) {
      const caps = videoCaps(tier)
      for (const d of [caps.maxClipSeconds - 0.5, caps.maxClipSeconds, caps.maxClipSeconds + 0.5, caps.maxClipSeconds + 1]) {
        if (clipTooLong(d, caps)) continue          // we refuse it ourselves; Cloudflare never sees it
        expect(resolveMaxDurationSeconds(d), `${tier} @ ${d}s was approved`).toBeGreaterThan(d)
      }
    }
  })

  it('falls back generously when the browser could not measure the clip', () => {
    // 25 of 155 real videos have no duration — one live album is 15 for 15, because that device
    // never reports it. These must not be squeezed: they are ordinary uploads, not abuse.
    for (const unknown of [undefined, null, 0, -1, NaN, 'abc', {}]) {
      expect(resolveMaxDurationSeconds(unknown), String(unknown)).toBe(900)
    }
  })

  it('stays inside what Cloudflare will accept', () => {
    expect(resolveMaxDurationSeconds(100000)).toBeLessThanOrEqual(21600)
  })

  it('keeps the reservation tight enough that abandoned uploads cannot exhaust the quota', () => {
    // Cloudflare reserves this per PENDING upload. Six abandoned uploads once held 720 of the
    // account's 1,000 minutes and blocked video for everyone, so the margin has an upper bound too.
    expect(resolveMaxDurationSeconds(20)).toBeLessThan(120)
    expect(resolveMaxDurationSeconds(120)).toBeLessThan(300)
  })
})
