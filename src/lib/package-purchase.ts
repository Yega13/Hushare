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
 * Was the money for this order actually collected in full?
 *
 * THE GRANT IS DECIDED BY PRODUCT ID ALONE, and nothing ever looked at what was paid. Polar's
 * checkout shows a promo-code field on package sessions (we never asked it not to), and any
 * discount in the org that is not product-scoped can be typed in — so a heavily discounted, or
 * 100%-off, order wrote a full two-year Max grant. The catalogue price is already the pinned truth
 * and is already compared against Polar's product price by checkPackageProducts; it was simply
 * never compared against what the customer handed over.
 *
 * A SMALL SHORTFALL IS NOT FRAUD. Currency conversion, tax handling and Polar's own rounding all
 * move the collected amount by a few cents, and refusing a real customer's paid package over three
 * cents is a far worse failure than honouring a discount we chose to offer. So this asks whether
 * the payment is within a small tolerance of the advertised price, and anything below that is
 * reported rather than silently granted.
 *
 * `paidCents` null/absent = Polar did not tell us. That reads as "cannot verify", NOT as unpaid:
 * the alternative is refusing a genuine purchase because a webhook field moved, and the order
 * itself is signature-verified. It is surfaced to the admin panel by the caller instead.
 */
export const PACKAGE_PRICE_TOLERANCE_CENTS = 100

export function orderAmountLooksPaid(
  expectedCents: number,
  paidCents: number | null | undefined,
): { ok: true } | { ok: false; reason: 'short' | 'unknown'; paidCents: number | null } {
  if (typeof paidCents !== 'number' || !Number.isFinite(paidCents)) {
    return { ok: false, reason: 'unknown', paidCents: null }
  }
  if (paidCents + PACKAGE_PRICE_TOLERANCE_CENTS < expectedCents) {
    return { ok: false, reason: 'short', paidCents }
  }
  return { ok: true }
}

/**
 * The album's package after a REFUND or a chargeback: the grant is withdrawn.
 *
 * Nothing handled this at all. order.refunded was 200-ignored along with every other non-
 * subscription event, so the sequence "buy a $99 Max Package, ask Polar for a refund, keep the
 * album" worked, once per album, for anyone who tried it. Subscriptions were covered only by
 * accident — a refund usually cancels the subscription and isSubActive then expires it — while a
 * package is a tier and a date on one row, with no lifecycle behind it.
 *
 * ONLY the order that granted it may revoke it. The album carries package_last_order_id precisely
 * so a refund of order A cannot strip a package that order B has since paid for and extended —
 * that would be us destroying a real customer's paid album because an unrelated refund arrived.
 * When the ids do not match, this returns null and the caller leaves the album alone.
 */
export function revokeForRefund(
  current: { tier: 'pro' | 'studio' | null; expiresAt: string | null; lastOrderId: string | null },
  refundedOrderId: string,
): { package_tier: null; package_expires_at: null } | null {
  if (!current.tier && !current.expiresAt) return null       // nothing to take back
  if (!current.lastOrderId || current.lastOrderId !== refundedOrderId) return null
  return { package_tier: null, package_expires_at: null }
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
