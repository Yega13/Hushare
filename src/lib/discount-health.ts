import type { DiscountHealth } from '@/lib/polar'

// WHICH NOTICE THE ADMIN PANEL OWES THE OWNER ABOUT THE INTRO DISCOUNTS.
//
// Three states, not two, and the third is the one that was missing. The red alarm deliberately
// ignores 'unknown' so a network blip does not send the owner into the Polar dashboard to fix
// nothing. But filtering 'unknown' out entirely meant a probe that could not see — Polar down, or
// our API key expired, which it has — rendered NOTHING, and an empty panel reads as "the intro
// pricing is fine". That is asserting a negative we cannot back up (rule 20), in money: the
// pricing page keeps promising an intro price while nobody can say whether it can be charged.
//
//   'alarm'      at least one discount is definitively unusable — customers ARE overpaying now
//   'unverified' nothing is known to be broken, but the check could not run
//   'none'       every configured discount answered OK
//
// 'alarm' outranks 'unverified': a known-dead discount is not made less urgent by a second one
// being unreachable.
export type DiscountBanner = 'alarm' | 'unverified' | 'none'

export function discountBanner(health: Pick<DiscountHealth, 'state'>[]): DiscountBanner {
  if (health.some((d) => d.state === 'missing' || d.state === 'unset')) return 'alarm'
  if (health.some((d) => d.state === 'unknown')) return 'unverified'
  return 'none'
}

/** The rows worth listing under a banner: never the healthy ones. */
export function discountRowsToShow<T extends Pick<DiscountHealth, 'state'>>(health: T[], banner: DiscountBanner): T[] {
  if (banner === 'alarm') return health.filter((d) => d.state !== 'ok')
  if (banner === 'unverified') return health.filter((d) => d.state === 'unknown')
  return []
}
