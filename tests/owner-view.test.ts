import { describe, it, expect } from 'vitest'
import { shouldHoldForOwnerCheck } from '@/lib/owner-view'

// The owner opening their own gated album, and the outage that fixing it caused the first time.
const base = { ownerHashPresent: true, ownerTokenReady: false, ownerCheckTimedOut: false, hasGate: true }

describe('an owner is not shown their own album\'s gate', () => {
  it('holds while the owner check is genuinely in flight', () => {
    expect(shouldHoldForOwnerCheck(base)).toBe(true)
  })

  it('STOPS holding when the check times out — the outage guard', () => {
    // This is the line that matters. The earlier version of this fix waited forever, and on
    // production the check sometimes never resolved: a gated album then never opened for ANYONE,
    // owner or guest. Showing the gate late is an annoyance; never showing the album is an outage.
    expect(shouldHoldForOwnerCheck({ ...base, ownerCheckTimedOut: true })).toBe(false)
  })

  it('shows the gate immediately to someone with no owner link', () => {
    // A guest must never be made to wait behind an owner check that has nothing to do with them.
    expect(shouldHoldForOwnerCheck({ ...base, ownerHashPresent: false })).toBe(false)
  })

  it('shows the answer as soon as it is known', () => {
    expect(shouldHoldForOwnerCheck({ ...base, ownerTokenReady: true })).toBe(false)
  })

  it('never holds an album that has no gate at all', () => {
    // An open album renders the same either way, so holding it would be a delay that buys nothing —
    // and this is the common case, so getting it wrong would slow down every album on the site.
    for (const extra of [{}, { ownerTokenReady: true }, { ownerCheckTimedOut: true }]) {
      expect(shouldHoldForOwnerCheck({ ...base, ...extra, hasGate: false })).toBe(false)
    }
  })

  it('holds in exactly one combination and no other', () => {
    // Exhaustive, because the failure in both directions is bad and there are only 16 cases: hold
    // when you should not and the album never appears; fail to hold and the owner is asked for
    // their own password.
    let held = 0
    for (const hasGate of [true, false])
      for (const ownerHashPresent of [true, false])
        for (const ownerTokenReady of [true, false])
          for (const ownerCheckTimedOut of [true, false])
            if (shouldHoldForOwnerCheck({ hasGate, ownerHashPresent, ownerTokenReady, ownerCheckTimedOut })) held++
    expect(held, 'only "gated + owner link + not resolved + not timed out" may hold').toBe(1)
  })
})
