import type { Tier } from '@/types'
import {
  PACKAGE_CATALOGUE, RENEWAL_CATALOGUE, extendExpiry,
  type PackageKey, type RenewalKey,
} from '@/lib/package-catalogue'
import type { AlbumPackage } from '@/lib/album-entitlements'
import { packageExpired } from '@/lib/album-entitlements'

// WHAT A PAID POLAR ORDER DOES TO AN ALBUM — decided here, applied by the webhook.
//
// The webhook is the one place money becomes entitlement, and it runs with retries: Polar
// redelivers an event until it gets a 200, and redelivers again on its own schedule when unsure.
// So everything here is written to be applied TWICE safely, and the route pairs it with an
// order-id check so a redelivered event is a no-op rather than a second year.

export type PackageGrant = {
  kind: 'package' | 'renewal'
  key: PackageKey | RenewalKey
  /** The feature set this purchase grants. Renewals resolve to their package's tier. */
  tier: Exclude<Tier, 'free'>
  years: number
  label: string
}

/** Which renewal belongs to which tier — derived from the catalogue, never retyped. */
const RENEWAL_TIER: Record<RenewalKey, Exclude<Tier, 'free'>> = (() => {
  const out = {} as Record<RenewalKey, Exclude<Tier, 'free'>>
  for (const spec of Object.values(PACKAGE_CATALOGUE)) out[spec.renewal] = spec.tier
  return out
})()

/**
 * Match a Polar product id against the four package products. Null means "not a package product"
 * — which includes every subscription order, since subscriptions emit order events too. The
 * PRODUCT ID decides what was bought; checkout metadata only ever says which album it was for,
 * because metadata is attached by our own request and the product id by Polar's ledger.
 */
export function packageGrantForProduct(
  productId: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): PackageGrant | null {
  if (!productId) return null
  for (const [key, spec] of Object.entries(PACKAGE_CATALOGUE) as [PackageKey, typeof PACKAGE_CATALOGUE[PackageKey]][]) {
    if (env[spec.envVar] === productId) {
      return { kind: 'package', key, tier: spec.tier, years: spec.years, label: spec.label }
    }
  }
  for (const [key, spec] of Object.entries(RENEWAL_CATALOGUE) as [RenewalKey, typeof RENEWAL_CATALOGUE[RenewalKey]][]) {
    if (env[spec.envVar] === productId) {
      return { kind: 'renewal', key, tier: RENEWAL_TIER[key], years: spec.years, label: spec.label }
    }
  }
  return null
}

/**
 * The album's package after this purchase.
 *
 * Two rules, both directions of rule 19:
 *
 *   THE TIER NEVER GOES DOWN. Buying a Pro Package for an album whose Max Package is still live
 *   keeps Max — the odd purchase still extends the time, because the money was real, but it must
 *   not downgrade what an earlier payment already bought.
 *
 *   TIME ALWAYS EXTENDS FROM WHAT IS LEFT. extendExpiry adds to the current expiry while it is
 *   in the future, so paying early never costs the time already paid for; only a lapsed album
 *   extends from now.
 *
 * A RENEWAL on an album with no live package grants its own tier for its year rather than being
 * refused: the only way that happens is a stale renewal link used after expiry, and the person
 * paid — a year of the thing they paid for beats an error and a refund thread.
 */
export function applyPackageGrant(
  current: AlbumPackage | null,
  grant: PackageGrant,
  now: Date,
): { package_tier: Exclude<Tier, 'free'>; package_expires_at: string } {
  const RANK: Record<Tier, number> = { free: 0, pro: 1, studio: 2 }
  const liveTier = current && !packageExpired(current, now) ? current.tier : null
  const tier = liveTier && RANK[liveTier] > RANK[grant.tier] ? liveTier : grant.tier

  const currentExpiry = current?.expiresAt ? new Date(current.expiresAt) : null
  const validExpiry = currentExpiry && Number.isFinite(currentExpiry.getTime()) ? currentExpiry : null
  const expires = extendExpiry(validExpiry, grant.years, now)

  return { package_tier: tier, package_expires_at: expires.toISOString() }
}
