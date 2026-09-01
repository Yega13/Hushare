import { describe, it, expect } from 'vitest'
import {
  packageThanksState, packagePurchaseAllowed, THANKS_SLOW_AFTER_MS,
} from '../src/lib/package-thanks'

// THE GAP BETWEEN TAKING THE MONEY AND THE PACKAGE ARRIVING.
//
// Polar returns the buyer to the album the instant they pay; the webhook that applies the package
// lands separately. For that gap the album looked untouched — no acknowledgement, and the owner
// toolbar still offering the same two "Get" buttons. Someone who had just paid $99 and saw nothing
// had one obvious thing to try.

describe('what the buyer is told after paying', () => {
  it('says nothing at all on an ordinary page load', () => {
    // The banner must never appear for someone who simply opened the album.
    expect(packageThanksState(false, false, 0)).toBeNull()
    expect(packageThanksState(false, true, 999_999)).toBeNull()
  })

  it('acknowledges the payment before the package arrives', () => {
    expect(packageThanksState(true, false, 0)).toBe('applying')
    expect(packageThanksState(true, false, 5_000)).toBe('applying')
  })

  it('switches to applied the moment the package is live', () => {
    expect(packageThanksState(true, true, 0)).toBe('applied')
  })

  it('an applied package outranks a slow clock', () => {
    // The money question is answered; how long it took stops mattering.
    expect(packageThanksState(true, true, THANKS_SLOW_AFTER_MS * 10)).toBe('applied')
  })

  it('offers a human once it has taken too long', () => {
    expect(packageThanksState(true, false, THANKS_SLOW_AFTER_MS)).toBe('slow')
    expect(packageThanksState(true, false, THANKS_SLOW_AFTER_MS - 1)).toBe('applying')
  })

  it('a broken clock reads as "just started", never as "something is wrong"', () => {
    // performance.now differences should never be negative or NaN, but a false alarm telling a
    // paying customer to email support is worse than a few more seconds of "applying" (rule 19).
    expect(packageThanksState(true, false, -50_000)).toBe('applying')
    expect(packageThanksState(true, false, NaN)).toBe('applying')
    // Infinity included, deliberately: EVERY unreadable duration errs the same way. A real wait is
    // measured by the poll that keeps running, not by a reading nothing can trust.
    expect(packageThanksState(true, false, Infinity)).toBe('applying')
  })
})

describe('when a second purchase may be offered', () => {
  it('never while a payment is in flight', () => {
    expect(packagePurchaseAllowed('applying')).toBe(false)
  })

  it('not even when it has stalled — a duplicate charge costs more than the wait', () => {
    // The most dangerous moment: the buyer has waited, sees nothing, and the buy buttons are right
    // there. If the first payment did land, a second is a real second charge.
    expect(packagePurchaseAllowed('slow')).toBe(false)
  })

  it('not once it has applied — the section shows the package instead', () => {
    expect(packagePurchaseAllowed('applied')).toBe(false)
  })

  it('yes on an ordinary visit, which is the only time a package is actually for sale', () => {
    expect(packagePurchaseAllowed(null)).toBe(true)
  })
})
