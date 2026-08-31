import type { Tier } from '@/types'

// THE ONE-OFF ALBUM PACKAGES — what they cost, what they grant, and how long for.
//
// A package is bought ONCE for ONE album. It is not a subscription and deliberately not modelled
// as one: a stored card that expires two years later, failing a $9 charge and quietly deleting
// somebody's wedding album, is the worst thing this product could do. Renewals are one-time
// payments made from a link in the warning email — nothing can fail in the background because
// nothing runs in the background.
//
// Closed 2026-09-01 after costing every line against the live library and against competitors.
// Do not re-derive these numbers; the reasoning is written down so it does not have to be redone:
//
//   * Held forever, a full 5,000-photo album costs about $1 a year. Retention is the cheapest
//     promise this product makes — the whole VFM album, kept for good, is $1.37/year.
//   * The market deletes at 12 months (GuestPix), 90 days (Snapeen) or hours (Kululu). Two years
//     included is double the norm and is a selling line, not fine print.
//   * $9 and $19 clear their own worst-case hold cost ($2.18 and $4.97) by roughly four times,
//     after Polar's ~4% + $0.40. Nothing that renews can run at a loss.
//
// The FEATURES a package grants come from `tier` below, run through the same plan-gates table the
// subscriptions use — so a package cannot drift into granting something a subscription does not.

export type PackageKey = 'package_pro' | 'package_max'
export type RenewalKey = 'renewal_pro' | 'renewal_max'

export type PackageSpec = {
  /** Which feature set it grants. Read through lib/plan-gates like any other tier. */
  tier: Exclude<Tier, 'free'>
  /** Photos + videos in the one album it covers. */
  items: number
  /** Years of keeping included in the purchase price. */
  years: number
  amountCents: number
  /** The env var naming this Polar product. */
  envVar: string
  /** Its renewal, sold separately as another one-time payment. */
  renewal: RenewalKey
  label: string
}

export type RenewalSpec = {
  /** Years added per purchase. */
  years: number
  amountCents: number
  envVar: string
  label: string
}

export const PACKAGE_CATALOGUE: Record<PackageKey, PackageSpec> = {
  package_pro: {
    tier: 'pro',
    items: 5_000,
    years: 2,
    amountCents: 4900,
    envVar: 'POLAR_PRODUCT_PACKAGE_PRO',
    renewal: 'renewal_pro',
    label: 'Pro Package ($49)',
  },
  package_max: {
    tier: 'studio',
    items: 10_000,
    years: 2,
    amountCents: 9900,
    envVar: 'POLAR_PRODUCT_PACKAGE_MAX',
    renewal: 'renewal_max',
    label: 'Max Package ($99)',
  },
}

export const RENEWAL_CATALOGUE: Record<RenewalKey, RenewalSpec> = {
  renewal_pro: {
    years: 1,
    amountCents: 900,
    envVar: 'POLAR_PRODUCT_RENEWAL_PRO',
    label: 'Pro Package renewal ($9/yr)',
  },
  renewal_max: {
    years: 1,
    amountCents: 1900,
    envVar: 'POLAR_PRODUCT_RENEWAL_MAX',
    label: 'Max Package renewal ($19/yr)',
  },
}

export function isPackageKey(v: unknown): v is PackageKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PACKAGE_CATALOGUE, v)
}

export function isRenewalKey(v: unknown): v is RenewalKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(RENEWAL_CATALOGUE, v)
}

/**
 * When does an album bought (or renewed) now stop being covered?
 *
 * Renewals extend from the CURRENT EXPIRY, not from today, so paying early never costs somebody
 * the time they already had. Paying late — after it lapsed — extends from today instead, because
 * the alternative is selling a year that is already partly gone.
 *
 * Wall-clock only moves forward here: both branches derive from a stored timestamp and a fixed
 * number of years, never from the difference of two clock readings (rule 22).
 */
export function extendExpiry(currentExpiry: Date | null, years: number, now: Date): Date {
  const from = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now
  const out = new Date(from.getTime())
  out.setUTCFullYear(out.getUTCFullYear() + years)
  return out
}
