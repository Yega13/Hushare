import { describe, it, expect } from 'vitest'
import { orderIsApplicable, collectedCents } from '@/lib/server/package-reconcile'

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

  it('NEVER re-applies a refunded order', () => {
    // The dangerous direction: money returned and the album keeps its features, re-granted nightly.
    expect(orderIsApplicable({ ...paid, refunded: true })).toBe(false)
    expect(orderIsApplicable({ ...paid, refunded_amount: 4900 })).toBe(false)
  })

  it('a zero refunded_amount is not a refund', () => {
    // Polar sends this field on ordinary orders too. Treating 0 as "refunded" would quietly
    // disable the whole repair job — it would skip everything and look like a quiet night.
    expect(orderIsApplicable({ ...paid, refunded_amount: 0 })).toBe(true)
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
