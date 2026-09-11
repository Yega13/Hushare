import { describe, it, expect } from 'vitest'
import { packageGrantForProduct, applyPackageGrant , orderAmountLooksPaid, refundOutcome, refundIsWhole, PACKAGE_PRICE_TOLERANCE_CENTS } from '../src/lib/package-purchase'
import { PACKAGE_CATALOGUE, RENEWAL_CATALOGUE } from '../src/lib/package-catalogue'

const NOW = new Date('2026-09-01T12:00:00Z')

// The four env vars the products live in, injected so the test never depends on real secrets.
const ENV = {
  POLAR_PRODUCT_PACKAGE_PRO: 'prod-pkg-pro',
  POLAR_PRODUCT_PACKAGE_MAX: 'prod-pkg-max',
  POLAR_PRODUCT_RENEWAL_PRO: 'prod-ren-pro',
  POLAR_PRODUCT_RENEWAL_MAX: 'prod-ren-max',
}

describe('packageGrantForProduct — the product id decides what was bought', () => {
  it('resolves all four products to the right grant', () => {
    expect(packageGrantForProduct('prod-pkg-pro', ENV)).toMatchObject({ kind: 'package', tier: 'pro', years: 2 })
    expect(packageGrantForProduct('prod-pkg-max', ENV)).toMatchObject({ kind: 'package', tier: 'studio', years: 2 })
    expect(packageGrantForProduct('prod-ren-pro', ENV)).toMatchObject({ kind: 'renewal', tier: 'pro', years: 1 })
    expect(packageGrantForProduct('prod-ren-max', ENV)).toMatchObject({ kind: 'renewal', tier: 'studio', years: 1 })
  })

  it('returns null for anything else — especially subscription products', () => {
    // Subscriptions emit order.paid too. A subscription order reaching the package branch and
    // stamping a package onto some album would be money applied twice to two different things.
    expect(packageGrantForProduct('prod-sub-pro-monthly', ENV)).toBeNull()
    expect(packageGrantForProduct('', ENV)).toBeNull()
    expect(packageGrantForProduct(null, ENV)).toBeNull()
    expect(packageGrantForProduct(undefined, ENV)).toBeNull()
  })

  it('does not match when the env var is unset', () => {
    // With no env value, nothing may match — otherwise `undefined === undefined` would turn an
    // unconfigured Worker into one that grants packages for unknown products.
    expect(packageGrantForProduct(undefined, {})).toBeNull()
    expect(packageGrantForProduct('prod-pkg-pro', {})).toBeNull()
  })

  it('renewal tiers are DERIVED from the package catalogue, so they cannot drift', () => {
    for (const spec of Object.values(PACKAGE_CATALOGUE)) {
      const renewalEnv = RENEWAL_CATALOGUE[spec.renewal].envVar
      const productId = ENV[renewalEnv as keyof typeof ENV]
      expect(packageGrantForProduct(productId, ENV)?.tier).toBe(spec.tier)
    }
  })
})

describe('applyPackageGrant — money in, entitlement out, twice-safe', () => {
  const buyMax = packageGrantForProduct('prod-pkg-max', ENV)!
  const buyPro = packageGrantForProduct('prod-pkg-pro', ENV)!
  const renewPro = packageGrantForProduct('prod-ren-pro', ENV)!

  it('a fresh purchase grants the tier for two years from now', () => {
    const out = applyPackageGrant(null, buyMax, NOW)
    expect(out.package_tier).toBe('studio')
    expect(out.package_expires_at).toBe('2028-09-01T12:00:00.000Z')
  })

  it('a renewal on a live package extends from the EXPIRY, not from today', () => {
    // Renewing early must never confiscate the time already paid for.
    const out = applyPackageGrant({ tier: 'pro', expiresAt: '2027-03-01T00:00:00Z' }, renewPro, NOW)
    expect(out.package_tier).toBe('pro')
    expect(out.package_expires_at).toBe('2028-03-01T00:00:00.000Z')
  })

  it('a renewal on a LAPSED package extends from today — a year already gone is not for sale', () => {
    const out = applyPackageGrant({ tier: 'pro', expiresAt: '2026-01-01T00:00:00Z' }, renewPro, NOW)
    expect(out.package_expires_at).toBe('2027-09-01T12:00:00.000Z')
  })

  it('NEVER downgrades a live tier — a Pro purchase on a live Max album keeps Max', () => {
    // The odd purchase still adds its time (the money was real), but it must not lower what an
    // earlier payment already bought.
    const out = applyPackageGrant({ tier: 'studio', expiresAt: '2027-09-01T00:00:00Z' }, buyPro, NOW)
    expect(out.package_tier).toBe('studio')
    expect(out.package_expires_at).toBe('2029-09-01T00:00:00.000Z')
  })

  it('a LAPSED higher tier does not outrank the tier being bought now', () => {
    // A Max package that expired last year is history, not a live claim. The new Pro purchase
    // sets Pro — reviving the old Max for free would be granting something nobody paid to keep.
    const out = applyPackageGrant({ tier: 'studio', expiresAt: '2025-01-01T00:00:00Z' }, buyPro, NOW)
    expect(out.package_tier).toBe('pro')
  })

  it('a renewal on an album with NO package grants its own tier for its year', () => {
    // Only reachable through a stale renewal link used after expiry-and-clear. The person paid;
    // a year of what they paid for beats an error and a refund thread.
    const out = applyPackageGrant(null, renewPro, NOW)
    expect(out.package_tier).toBe('pro')
    expect(out.package_expires_at).toBe('2027-09-01T12:00:00.000Z')
  })

  it('a corrupt stored expiry is treated as no time left, never as forever', () => {
    const out = applyPackageGrant({ tier: 'pro', expiresAt: 'garbage' }, renewPro, NOW)
    expect(out.package_expires_at).toBe('2027-09-01T12:00:00.000Z')
  })

  it('applying the same grant twice doubles the time — which is WHY the webhook dedupes by order id', () => {
    // This documents the hazard rather than hiding it: the function is additive by design (two
    // real orders are two real years), so redelivery protection has to live at the order id.
    const once = applyPackageGrant(null, renewPro, NOW)
    const twice = applyPackageGrant({ tier: 'pro', expiresAt: once.package_expires_at }, renewPro, NOW)
    expect(twice.package_expires_at).toBe('2028-09-01T12:00:00.000Z')
  })
})


describe('a refunded package is not a package', () => {
  // "Buy a $99 Max Package, ask Polar for a refund, keep the album" worked — once per album, for
  // anyone who tried it. order.refunded was acknowledged and dropped along with every other
  // non-subscription event. Subscriptions were covered only by accident; a package is a tier and a
  // date on one row, with no lifecycle behind it to expire.

  // Every call now carries the AMOUNTS, because a refund's size decides whether it cancels the
  // purchase at all. A $1 goodwill credit against a $99 package used to revoke the whole thing.
  const FULL = { totalCents: 9900, refundedCents: 9900 }

  it('revokes the package the refunded order paid for', () => {
    expect(refundOutcome(
      { tier: 'studio', expiresAt: '2028-09-01T00:00:00Z', lastOrderId: 'order-1' },
      'order-1',
      FULL,
    )).toEqual({ action: 'revoke', update: { package_tier: null, package_expires_at: null } })
  })

  it('REFUSES to revoke when a later order has since paid', () => {
    // The dangerous direction. If a refund of an old order could strip the album, we would be
    // destroying a paying customer's album because an unrelated refund arrived — and the album
    // carries package_last_order_id precisely so that cannot happen.
    expect(refundOutcome(
      { tier: 'studio', expiresAt: '2028-09-01T00:00:00Z', lastOrderId: 'order-2' },
      'order-1',
      FULL,
    )).toEqual({ action: 'keep', reason: 'other-order' })
  })

  it('does nothing when there is no package, and when the order is unknown', () => {
    expect(refundOutcome({ tier: null, expiresAt: null, lastOrderId: null }, 'order-1', FULL).action).toBe('keep')
    expect(refundOutcome({ tier: 'pro', expiresAt: '2028-01-01T00:00:00Z', lastOrderId: null }, 'order-1', FULL).action).toBe('keep')
  })
})

describe('what was actually paid decides whether a package is granted', () => {
  // The grant was decided by product id alone. Polar's checkout shows a promo-code field we never
  // switched off, so a discounted — or 100%-off — order wrote a full two-year Max grant.

  it('accepts the advertised price', () => {
    expect(orderAmountLooksPaid(9900, 9900).ok).toBe(true)
  })

  it('accepts a few cents short, because conversion and rounding are not fraud', () => {
    // Refusing a real customer over three cents is a worse failure than honouring a small gap.
    expect(orderAmountLooksPaid(9900, 9900 - PACKAGE_PRICE_TOLERANCE_CENTS).ok).toBe(true)
    expect(orderAmountLooksPaid(9900, 9897).ok).toBe(true)
  })

  it('refuses a real discount', () => {
    const free = orderAmountLooksPaid(9900, 0)
    expect(free.ok).toBe(false)
    if (!free.ok) expect(free.reason).toBe('short')
    const half = orderAmountLooksPaid(9900, 4950)
    expect(half.ok).toBe(false)
    if (!half.ok) expect(half.reason).toBe('short')
  })

  it('an amount Polar did not send is "unknown", not "unpaid"', () => {
    // These are two different answers and must not collapse: refusing a signature-verified
    // purchase because a webhook field moved would break paying customers to stop a hypothetical
    // one. The caller grants and reports it instead.
    for (const missing of [undefined, null, NaN]) {
      const r = orderAmountLooksPaid(9900, missing as number | null | undefined)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('unknown')
    }
  })
})


// ── A FIELD WE CANNOT READ IS NOT A REFUND ───────────────────────────────────────────────────────
//
// Added 2026-09-11 after a mutation run. refundIsWhole opens with two guards on the amounts, and
// deleting either left the whole suite green -- because every test passes two real numbers. What
// they stop is the arithmetic being done on a value that is not a number at all: `null + 100 >= x`
// is 100 >= x, which is TRUE for any order under a dollar and, with the total missing, true for
// everything. A missing field in a Polar payload would then revoke a live package that nobody
// refunded, on an album somebody paid $99 for.
//
// Erring the other way costs a support thread; erring this way destroys what a customer bought.

describe('refundIsWhole refuses to decide on a number it does not have', () => {
  it('an unreadable ORDER TOTAL is not a whole refund', () => {
    for (const total of [null, undefined, NaN, 'lots' as unknown as number]) {
      expect(refundIsWhole(total, 9900).whole, `total ${String(total)}`).toBe(false)
    }
  })

  it('a zero or negative order total is not a whole refund either', () => {
    // Nothing was collected, so there is nothing for a refund to cancel -- and dividing the
    // question by an amount that cannot be right is how a bad row revokes a good album.
    expect(refundIsWhole(0, 0).whole).toBe(false)
    expect(refundIsWhole(-9900, 9900).whole).toBe(false)
  })

  it('an unreadable REFUNDED amount is not a whole refund', () => {
    for (const refunded of [null, undefined, NaN, 'some' as unknown as number]) {
      expect(refundIsWhole(9900, refunded).whole, `refunded ${String(refunded)}`).toBe(false)
    }
  })

  it('...including on a SMALL order, which is the only place the arithmetic lies', () => {
    // Against a $99 package, dropping the guard changes nothing: `null + 100 >= 9900` is still
    // false, so the four cases above pass either way. The guard earns its place on an order at or
    // below the tolerance -- a $1 test purchase in the same Polar account, which the nightly
    // reconcile job scans alongside the real ones. There, `null + 100 >= 50` is TRUE, and an order
    // nobody refunded reads as wholly refunded.
    expect(refundIsWhole(50, null).whole, 'a 50c order with no refunded amount').toBe(false)
    expect(refundIsWhole(100, null).whole).toBe(false)
    expect(refundIsWhole(50, 50).whole, 'and a real full refund of it still reads as whole').toBe(true)
  })

  it('and it still says yes to a real full refund, so the guards did not break it', () => {
    expect(refundIsWhole(9900, 9900).whole).toBe(true)
    expect(refundIsWhole(9900, 9900 - PACKAGE_PRICE_TOLERANCE_CENTS).whole, 'within tolerance').toBe(true)
    expect(refundIsWhole(9900, 5000).whole, 'half is not whole').toBe(false)
  })

  it('a refund with unreadable amounts KEEPS the package, and says it could not tell', () => {
    // End to end through the decision the webhook actually makes.
    const live = { tier: 'studio' as const, expiresAt: '2028-09-01T00:00:00Z', lastOrderId: 'order-1' }
    expect(refundOutcome(live, 'order-1', { totalCents: null, refundedCents: 9900 }))
      .toEqual({ action: 'keep', reason: 'unknown' })
    expect(refundOutcome(live, 'order-1', { totalCents: 9900, refundedCents: undefined }))
      .toEqual({ action: 'keep', reason: 'unknown' })
  })
})

describe('a corrupt stored expiry does not 500 the purchase', () => {
  it('extends from NOW rather than from a date that will not parse', () => {
    // package_expires_at is a text column, so an unparseable value is reachable -- from an old
    // import, a hand edit, or a restore. Feeding it to extendExpiry produces an Invalid Date, and
    // .toISOString() on that THROWS: the webhook 500s, Polar retries, and a customer who has paid
    // sits without their package while the same error repeats.
    const grant = { kind: 'package' as const, key: 'package_max' as const, tier: 'studio' as const, years: 2, label: 'Max' }
    for (const bad of ['not-a-date', '', '0000-00-00']) {
      const out = applyPackageGrant({ tier: 'studio', expiresAt: bad }, grant, NOW)
      expect(Number.isFinite(new Date(out.package_expires_at).getTime()), `expiry from "${bad}"`).toBe(true)
      expect(new Date(out.package_expires_at).getTime(), 'and it must be in the future').toBeGreaterThan(NOW.getTime())
    }
  })

  it('a live, readable expiry is still extended from, not discarded', () => {
    const grant = { kind: 'package' as const, key: 'package_pro' as const, tier: 'pro' as const, years: 2, label: 'Pro' }
    const out = applyPackageGrant({ tier: 'pro', expiresAt: '2027-09-01T12:00:00.000Z' }, grant, NOW)
    expect(new Date(out.package_expires_at).getUTCFullYear(), 'two years on top of the year remaining').toBe(2029)
  })
})
