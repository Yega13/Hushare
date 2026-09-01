import { describe, it, expect } from 'vitest'
import { packageGrantForProduct, applyPackageGrant , orderAmountLooksPaid, revokeForRefund, PACKAGE_PRICE_TOLERANCE_CENTS } from '../src/lib/package-purchase'
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

  it('revokes the package the refunded order paid for', () => {
    expect(revokeForRefund(
      { tier: 'studio', expiresAt: '2028-09-01T00:00:00Z', lastOrderId: 'order-1' },
      'order-1',
    )).toEqual({ package_tier: null, package_expires_at: null })
  })

  it('REFUSES to revoke when a later order has since paid', () => {
    // The dangerous direction. If a refund of an old order could strip the album, we would be
    // destroying a paying customer's album because an unrelated refund arrived — and the album
    // carries package_last_order_id precisely so that cannot happen.
    expect(revokeForRefund(
      { tier: 'studio', expiresAt: '2028-09-01T00:00:00Z', lastOrderId: 'order-2' },
      'order-1',
    )).toBeNull()
  })

  it('does nothing when there is no package, and when the order is unknown', () => {
    expect(revokeForRefund({ tier: null, expiresAt: null, lastOrderId: null }, 'order-1')).toBeNull()
    expect(revokeForRefund({ tier: 'pro', expiresAt: '2028-01-01T00:00:00Z', lastOrderId: null }, 'order-1')).toBeNull()
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
