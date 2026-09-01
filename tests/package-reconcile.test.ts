import { describe, it, expect } from 'vitest'
import { orderIsApplicable, collectedCents } from '@/lib/server/package-reconcile'
import { refundOutcome } from '@/lib/package-purchase'

// THE REPAIR JOB'S TWO JUDGEMENTS, and why they are the careful ones.
//
// This runs unattended, every night, against real money. The subscription reconcile beside it
// exists because a webhook can simply never arrive; one-time orders had no such repair, so a
// collected $49 could leave an album with nothing and the customer finds out at their event.
//
// But a repair job that runs by itself has a failure the webhook does not: applying something it
// should not. Re-granting a REFUNDED order would hand back exactly what the refund took away, on a
// schedule, forever — the money is gone AND the album keeps its features. So "should this order be
// applied at all" is a question worth testing on its own, apart from the grant logic it shares with
// the webhook (which is tested in package-purchase.test.ts and deliberately not re-implemented).

describe('which orders the nightly repair may act on', () => {
  const paid = { id: 'ord_1', product_id: 'prod_1', status: 'paid' as const }

  it('applies an ordinary paid order', () => {
    expect(orderIsApplicable(paid)).toBe(true)
  })

  it('NEVER re-applies a WHOLLY refunded order', () => {
    // The dangerous direction: money returned and the album keeps its features, re-granted nightly.
    expect(orderIsApplicable({ ...paid, refunded: true })).toBe(false)
    expect(orderIsApplicable({ ...paid, total_amount: 4900, refunded_amount: 4900 })).toBe(false)
  })

  it('STILL repairs a partly refunded order, because the customer kept most of what they paid for', () => {
    // The earlier version skipped anything with refunded_amount > 0, which meant a $99 purchase
    // with a $1 goodwill credit could never be repaired if its webhook was also lost — the one job
    // that exists to notice a missing package refused to look. What the order actually bought is
    // decided by collectedCents against the catalogue price, not here.
    expect(orderIsApplicable({ ...paid, total_amount: 9900, refunded_amount: 100 })).toBe(true)
  })

  it('a zero refunded_amount is not a refund', () => {
    // Polar sends this field on ordinary orders too. Treating 0 as "refunded" would quietly
    // disable the whole repair job — it would skip everything and look like a quiet night.
    expect(orderIsApplicable({ ...paid, refunded_amount: 0 })).toBe(true)
  })

  it('accepts a partially_refunded status, which is a real Polar state with real money behind it', () => {
    expect(orderIsApplicable({ ...paid, status: 'partially_refunded', total_amount: 9900, refunded_amount: 100 })).toBe(true)
  })

  it('reads the product from EITHER shape Polar sends', () => {
    // The list API nests product as an object; webhooks send a flat product_id. Reading only the
    // flat one would make every listed order unrecognisable, so the job would skip all of them and
    // report a quiet night — a repair job silently repairing nothing.
    expect(orderIsApplicable({ id: 'ord_1', product: { id: 'prod_1' }, status: 'paid' })).toBe(true)
    expect(orderIsApplicable({ id: 'ord_1', product: { id: null }, status: 'paid' })).toBe(false)
  })

  it('ignores orders with no money behind them', () => {
    expect(orderIsApplicable({ ...paid, status: 'pending' })).toBe(false)
    expect(orderIsApplicable({ ...paid, status: 'failed' })).toBe(false)
  })

  it('an absent status is treated as applicable, because Polar may not send one', () => {
    // Erring the other way would make the repair job silently do nothing on a payload shape
    // change — and doing nothing is exactly what it is supposed to detect.
    expect(orderIsApplicable({ id: 'ord_1', product_id: 'prod_1' })).toBe(true)
  })

  it('needs both an id and a product to mean anything', () => {
    expect(orderIsApplicable({ product_id: 'prod_1', status: 'paid' })).toBe(false)
    expect(orderIsApplicable({ id: 'ord_1', status: 'paid' })).toBe(false)
  })
})

describe('what a refund does to a package', () => {
  const live = { tier: 'studio' as const, expiresAt: '2028-01-01T00:00:00.000Z', lastOrderId: 'ord_1' }

  it('a $1 refund against a $99 package takes NOTHING', () => {
    // The bug this replaced: any refund of any size revoked the whole package, and the nightly
    // repair then refused to restore it, so a customer refunded $1 lost two years of paid
    // retention, Face Finder, bib search, sponsor logos and their item cap, recoverable only by
    // editing the database by hand.
    const out = refundOutcome(live, 'ord_1', { totalCents: 9900, refundedCents: 100 })
    expect(out).toEqual({ action: 'keep', reason: 'partial' })
  })

  it('a full refund DOES revoke it', () => {
    const out = refundOutcome(live, 'ord_1', { totalCents: 9900, refundedCents: 9900 })
    expect(out).toEqual({ action: 'revoke', update: { package_tier: null, package_expires_at: null } })
  })

  it('a refund a few cents short of the total still revokes — rounding is not a partial refund', () => {
    expect(refundOutcome(live, 'ord_1', { totalCents: 9900, refundedCents: 9897 }).action).toBe('revoke')
  })

  it('cannot be told what to do by an unrelated order', () => {
    // A refund of order A must never strip a package order B has since paid for and extended.
    expect(refundOutcome(live, 'ord_OTHER', { totalCents: 9900, refundedCents: 9900 }))
      .toEqual({ action: 'keep', reason: 'other-order' })
  })

  it('keeps the package when the amounts cannot be read at all', () => {
    // Which way this errs, stated: revoking on a missing field would take a paying customer's
    // album away because a payload shape moved. The caller reports it instead.
    expect(refundOutcome(live, 'ord_1', { totalCents: undefined, refundedCents: undefined }))
      .toEqual({ action: 'keep', reason: 'unknown' })
    expect(refundOutcome(live, 'ord_1', { totalCents: 9900, refundedCents: undefined }))
      .toEqual({ action: 'keep', reason: 'unknown' })
  })

  it('has nothing to do on an album with no package', () => {
    expect(refundOutcome({ tier: null, expiresAt: null, lastOrderId: null }, 'ord_1',
      { totalCents: 9900, refundedCents: 9900 })).toEqual({ action: 'keep', reason: 'nothing-to-revoke' })
  })
})

describe('collectedCents is net of refunds', () => {
  it('subtracts what went back, so a half-refunded order reads as half paid', () => {
    // This is what makes a partly refunded order repair CORRECTLY rather than being skipped: the
    // grant is then judged against the catalogue price, so a real shortfall is refused and a
    // trivial goodwill credit still passes.
    expect(collectedCents({ total_amount: 9900, refunded_amount: 5000 })).toBe(4900)
    expect(collectedCents({ net_amount: 9900, refunded_amount: 100 })).toBe(9800)
  })

  it('an order with no refund field is unaffected', () => {
    expect(collectedCents({ total_amount: 9900 })).toBe(9900)
  })
})

describe('what the repair job believes was collected', () => {
  it('prefers the smallest figure Polar offers', () => {
    // net_amount is post-discount; total_amount is gross. The question is "did the money arrive",
    // so the smaller number is the honest one — taking the gross would let a discounted order
    // reconcile itself into a full grant, which is the hole the webhook check just closed.
    expect(collectedCents({ net_amount: 4400, total_amount: 4900 })).toBe(4400)
    expect(collectedCents({ total_amount: 4900 })).toBe(4900)
    expect(collectedCents({ amount: 4900 })).toBe(4900)
  })

  it('says null rather than zero when Polar sent nothing', () => {
    // Zero would read as "paid nothing" and refuse a real purchase; null means "cannot verify",
    // which the caller handles separately.
    expect(collectedCents({})).toBeNull()
    expect(collectedCents({ net_amount: Number.NaN })).toBeNull()
  })
})
