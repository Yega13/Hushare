import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COMP_PREFIX, isCompedSubscription } from '@/lib/subscription-origin'
import { extendExpiry } from '@/lib/package-catalogue'

// THE SCRIPT THAT GIVES SOMEBODY A PAID PLAN FOR NOTHING.
//
// scripts/comp-user-plan.mjs writes into `subscriptions`, the table computeUserTier reads to decide
// whether an account has paid features. It is plain JavaScript, so nothing type-checks it and no
// test can import it — which is exactly why the two facts it duplicates are held here instead.
//
// This is the arrangement tests/comp-script-cap.test.ts already uses for MAX_MEDIA_CAP_OVERRIDE:
// rule 13's escape hatch, where a copy that genuinely cannot be imported is pinned by a test that
// reads the real source rather than a second copy of it.

const script = readFileSync(join(process.cwd(), 'scripts', 'comp-user-plan.mjs'), 'utf8')
const reconcile = readFileSync(join(process.cwd(), 'src', 'lib', 'server', 'polar-reconcile.ts'), 'utf8')

describe('the comp prefix keeps the nightly job away from the gift', () => {
  // If polar-reconcile ever starts deleting by a pattern that matches 'comp-', somebody's comped
  // year vanishes overnight with no error anywhere. The whole safety argument in the script's header
  // rests on these two filters, so they are asserted rather than trusted.
  it('reconcile only deletes manual-recovery rows, never comped ones', () => {
    const deletes = [...reconcile.matchAll(/\.like\(\s*'polar_subscription_id'\s*,\s*'([^']+)'/g)].map((m) => m[1])
    expect(deletes, 'polar-reconcile changed which rows it deletes').toEqual(['manual-recovery-%'])
    for (const pattern of deletes) {
      expect(`comp-${'x'.repeat(8)}`.startsWith(pattern.replace('%', '')), `a ${pattern} delete would match a comp- row`).toBe(false)
    }
  })

  it('the script marks its rows with the prefix the reconcile ignores', () => {
    expect(script).toContain("const COMP_SUBSCRIPTION_PREFIX = 'comp-'")
  })

  it('BOTH markers this script writes are ones lib/subscription-origin recognises', () => {
    // The bug that cost two gifts their place in the dashboard: this script wrote
    // polar_product_id = 'comp' while the page asked startsWith('comp-'), so every account comped
    // here was counted as revenue. The predicate is shared and bare now, and this is what stops the
    // two drifting again -- a .mjs cannot import a .ts, which is exactly the case rule 13 allows a
    // source-reading test for.
    const subPrefix = /const COMP_SUBSCRIPTION_PREFIX = '([^']+)'/.exec(script)?.[1]
    const productId = /const COMP_PRODUCT_ID = '([^']+)'/.exec(script)?.[1]
    expect(subPrefix, 'the subscription-id marker must be a named constant').toBeDefined()
    expect(productId, 'the product-id marker must be a named constant').toBeDefined()
    for (const marker of [subPrefix, productId]) {
      expect(marker?.startsWith(COMP_PREFIX), `"${marker}" is not recognised as a comp`).toBe(true)
      expect(isCompedSubscription({ polar_subscription_id: `${marker}whatever` }),
        `a row marked "${marker}" must read as a gift, not as revenue`).toBe(true)
    }
  })

  it('and the product id is not typed into the SQL by hand', () => {
    // It was a bare 'comp' literal inside the INSERT, which is how it got out of step with every
    // reader in the first place.
    const insert = script.slice(script.indexOf('insert into subscriptions'), script.indexOf('Granted'))
    expect(insert, 'the product id must be bound, not inlined').not.toMatch(/'comp'/)
    expect(insert).toContain('COMP_PRODUCT_ID')
  })

  // Reconcile UPDATES by matching a polar_subscription_id it found in Polar's ledger. A comp- id is
  // never in that ledger, so it is never matched. This asserts the update is keyed that way and not,
  // say, by user_id, which WOULD overwrite a comp the moment the person bought anything.
  it('reconcile updates by subscription id, not by user', () => {
    expect(reconcile).toContain(".update(fields).eq('polar_subscription_id', sub.id)")
  })
})

describe('the script computes expiry the same way the product does', () => {
  // extendExpiry is the tested original in src/lib/package-catalogue.ts. The script re-implements it
  // in three lines because a .mjs file cannot import TypeScript. Re-implementing it BETTER, or
  // worse, is rule 17's failure — so the copy is run here against the real function.
  const copy = (currentExpiry: Date | null, years: number, now: Date): Date => {
    const from = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now
    const out = new Date(from.getTime())
    out.setUTCFullYear(out.getUTCFullYear() + years)
    return out
  }

  it('is character for character the same logic', () => {
    // Not a paraphrase check. The three lines above are lifted from the script, so if the script is
    // edited and this is not, the cases below stop describing what actually runs.
    const body = script.slice(script.indexOf('function extendExpiry'))
    expect(body).toContain('const from = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now')
    expect(body).toContain('out.setUTCFullYear(out.getUTCFullYear() + yearsToAdd)')
  })

  it('agrees with the real one on a fresh grant', () => {
    const now = new Date('2026-09-10T00:00:00Z')
    expect(copy(null, 1, now).toISOString()).toBe(extendExpiry(null, 1, now).toISOString())
  })

  // Comping twice must not cost somebody the time they already had.
  it('agrees when extending a grant that is still running', () => {
    const now = new Date('2026-09-10T00:00:00Z')
    const running = new Date('2027-03-01T00:00:00Z')
    expect(copy(running, 1, now).toISOString()).toBe(extendExpiry(running, 1, now).toISOString())
    expect(copy(running, 1, now).getUTCFullYear(), 'extends from the expiry, not from today').toBe(2028)
  })

  // Re-comping after a lapse must not sell a year that is already partly gone.
  it('agrees when the previous grant has lapsed', () => {
    const now = new Date('2026-09-10T00:00:00Z')
    const lapsed = new Date('2025-01-01T00:00:00Z')
    expect(copy(lapsed, 1, now).toISOString()).toBe(extendExpiry(lapsed, 1, now).toISOString())
    expect(copy(lapsed, 1, now).getUTCFullYear(), 'restarts from today').toBe(2027)
  })

  it('agrees across a leap day', () => {
    const now = new Date('2028-02-29T12:00:00Z')
    expect(copy(null, 1, now).toISOString()).toBe(extendExpiry(null, 1, now).toISOString())
  })
})

// A MONTH-LONG TRIAL OF THE TIER ABOVE, given to somebody who is already paying. Their Polar
// subscription is untouched and keeps billing; computeUserTier takes the highest ACTIVE tier across
// all their rows, so the comped one wins while it lasts.
describe('adding months, with the rollover clamped', () => {
  // Lifted from the script, so editing one without the other makes these cases describe nothing.
  const addMonths = (currentExpiry: Date | null, months: number, now: Date): Date => {
    const from = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now
    const day = from.getUTCDate()
    const out = new Date(from.getTime())
    out.setUTCDate(1)
    out.setUTCMonth(out.getUTCMonth() + months)
    const lastDayOfTarget = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate()
    out.setUTCDate(Math.min(day, lastDayOfTarget))
    return out
  }

  it('is the same logic the script runs', () => {
    const body = script.slice(script.indexOf('function extendExpiryMonths'))
    expect(body).toContain('out.setUTCMonth(out.getUTCMonth() + monthsToAdd)')
    expect(body).toContain('out.setUTCDate(Math.min(day, lastDayOfTarget))')
  })

  it('adds an ordinary month', () => {
    expect(addMonths(null, 1, new Date('2026-09-10T00:00:00Z')).toISOString().slice(0, 10)).toBe('2026-10-10')
  })

  // THE TRAP. setUTCMonth on the 31st of January rolls to the 3rd of March, so a grant made on the
  // 31st would outlast one made on the 30th by three days. Same shape as the date bug the outreach
  // engine hit, which is why it is clamped rather than trusted.
  it('clamps the 31st into a month that has no 31st', () => {
    expect(addMonths(null, 1, new Date('2026-01-31T00:00:00Z')).toISOString().slice(0, 10)).toBe('2026-02-28')
    expect(addMonths(null, 1, new Date('2026-03-31T00:00:00Z')).toISOString().slice(0, 10)).toBe('2026-04-30')
  })

  it('lands on the 29th in a leap February', () => {
    expect(addMonths(null, 1, new Date('2028-01-31T00:00:00Z')).toISOString().slice(0, 10)).toBe('2028-02-29')
  })

  it('crosses the year boundary', () => {
    expect(addMonths(null, 3, new Date('2026-11-15T00:00:00Z')).toISOString().slice(0, 10)).toBe('2027-02-15')
  })

  it('extends from a running grant rather than from today', () => {
    const now = new Date('2026-09-10T00:00:00Z')
    const running = new Date('2026-12-01T00:00:00Z')
    expect(addMonths(running, 1, now).toISOString().slice(0, 10)).toBe('2027-01-01')
  })
})

describe('--on-top only ever goes upward', () => {
  // Comping at or below what somebody already buys changes nothing, because the highest active tier
  // wins — but it leaves a row that reads like a gift, so a later reader believes they got one.
  it('refuses to comp a tier that is not above what they pay for', () => {
    expect(script).toContain('RANK[tier] <= highestPaid')
    expect(script).toContain('--on-top is for giving somebody the tier ABOVE the one they are buying.')
  })

  it('still refuses a paying account without the flag', () => {
    expect(script).toContain("if (paying.length && !flags.has('--on-top'))")
  })

  it('says out loud that billing is untouched', () => {
    expect(script).toContain('their billing is untouched and the higher tier wins')
  })
})

describe('the grant actually ends', () => {
  // isSubActive treats a NULL current_period_end as valid forever, and that is how the one hand-made
  // comp already in this database was recorded. A "one year" gift written that way would never
  // expire, and nobody would find out until it mattered.
  it('never writes a null period end', () => {
    expect(script).toContain('current_period_end')
    expect(script, 'a null period end is a permanent grant, not a one year one')
      .not.toMatch(/current_period_end\s*[,)]\s*null/)
    expect(script).toContain('endsAt.toISOString()')
  })

  it('refuses an amount that is not a small whole number', () => {
    expect(script).toContain('!Number.isInteger(amount) || amount < 1 || amount > limit')
  })

  // Granting on top of somebody who is already paying is the mistake worth refusing outright.
  it('refuses to comp an account with a real active subscription', () => {
    expect(script).toContain('Refusing, so a paying customer is not quietly given something they are buying.')
  })
})
