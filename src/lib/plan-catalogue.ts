// What each paid plan COSTS and HOW OFTEN it charges — the canonical answer.
//
// This exists because the price is really stored in someone else's dashboard, and ours drifted
// from it without a sound: Hushare Studio (Yearly) was configured at Polar as $100 every MONTH
// while /pricing advertised "$100 / year". Nobody had bought it yet, so the first annual Max
// customer would have paid $1,200 for something sold at $100 — and the only way it was ever
// going to be found was somebody noticing "/mo" in a screenshot.
//
// A price cannot be imported from Polar at render time (the pricing page must be static and
// fast), so this is the local copy — and lib/polar.ts checks the copy against Polar itself,
// which is rule 13's prescription when a fact genuinely cannot be single-sourced: keep one
// copy, and TEST it against the original.

export type PlanKey = 'pro_monthly' | 'pro_yearly' | 'studio_monthly' | 'studio_yearly'

export type PlanPrice = {
  /** Amount in cents, as Polar stores it — never a float, never a formatted string. */
  amountCents: number
  interval: 'month' | 'year'
  /** The env var naming this plan's Polar product. */
  envVar: string
  /** How it is described to a customer, for the mismatch message. */
  label: string
}

export const PLAN_CATALOGUE: Record<PlanKey, PlanPrice> = {
  pro_monthly:    { amountCents:   400, interval: 'month', envVar: 'POLAR_PRODUCT_PRO_MONTHLY',    label: 'Pro monthly ($4/mo)' },
  pro_yearly:     { amountCents:  4000, interval: 'year',  envVar: 'POLAR_PRODUCT_PRO_YEARLY',     label: 'Pro yearly ($40/yr)' },
  studio_monthly: { amountCents:  1000, interval: 'month', envVar: 'POLAR_PRODUCT_STUDIO_MONTHLY', label: 'Max monthly ($10/mo)' },
  studio_yearly:  { amountCents: 10000, interval: 'year',  envVar: 'POLAR_PRODUCT_STUDIO_YEARLY',  label: 'Max yearly ($100/yr)' },
}

/** Cents to the string a customer reads. Trailing ".00" is dropped because every current price
 *  is whole dollars and "$4" is what the pricing page says; a future $4.50 renders in full. */
export function formatPrice(amountCents: number): string {
  const dollars = amountCents / 100
  return '$' + (Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2))
}

/** The yearly saving, expressed the way the pricing page expresses it ("save 2 months").
 *  Derived, so a price change cannot leave the claim behind — which is exactly how a wrong
 *  number survives a redesign. */
export function monthsSaved(monthlyCents: number, yearlyCents: number): number {
  if (monthlyCents <= 0) return 0
  return Math.round((monthlyCents * 12 - yearlyCents) / monthlyCents)
}
