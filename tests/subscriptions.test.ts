import { describe, it, expect, vi, beforeEach } from 'vitest'

// WHICH SUBSCRIPTION ROW DECIDES A CUSTOMER'S TIER -- the function every authenticated page calls.
//
// getActiveSubscription is the entitlement decision, and until now nothing observed it: a review's
// four mutations (drop every row, keep every row, stop reporting, lose the prefer-higher-tier
// rule) all left the whole suite green. The admin client is scripted here so each rule is a case.

type Row = {
  id: string; user_id: string; polar_subscription_id: string; polar_customer_id: string | null
  polar_product_id: string | null; tier: string; status: string; current_period_end: string | null
  cancel_at_period_end: boolean; created_at: string
}
const rows: Row[] = []
let queryFails = false
const reports: Array<{ source: string; message: string; opts: unknown }> = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = () => chain
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(queryFails ? { data: null, error: { message: 'connection reset' } } : { data: rows, error: null }).then(res, rej)
      return chain
    },
  }),
}))
vi.mock('@/lib/report-server-error', () => ({
  reportServerError: (source: string, message: string, opts: unknown) => { reports.push({ source, message, opts }) },
}))

import { getActiveSubscription, getUserTierById, getUserTierResolved } from '@/lib/subscriptions'

const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
const past = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
const row = (over: Partial<Row>): Row => ({
  id: 'sub-1', user_id: 'u1', polar_subscription_id: 'ps', polar_customer_id: 'pc', polar_product_id: 'pp',
  tier: 'pro', status: 'active', current_period_end: future, cancel_at_period_end: false, created_at: '2026-09-01T00:00:00Z',
  ...over,
})

beforeEach(() => { rows.length = 0; reports.length = 0; queryFails = false })

describe('getActiveSubscription -- the entitlement decision', () => {
  it('returns the one active row, with its nullable columns typed as they are', async () => {
    rows.push(row({ polar_customer_id: null }))
    const sub = await getActiveSubscription('u1')
    expect(sub?.id).toBe('sub-1')
    expect(sub?.polar_customer_id).toBeNull()
    expect(reports).toEqual([])
  })

  it('returns null when nothing is active, and reports nothing', async () => {
    rows.push(row({ status: 'canceled', current_period_end: past }))
    expect(await getActiveSubscription('u1')).toBeNull()
    expect(reports).toEqual([])
  })

  it('prefers studio over pro when both are active -- a stale newer pro row must not hide a studio', async () => {
    rows.push(row({ id: 'newer-pro', tier: 'pro' }), row({ id: 'older-studio', tier: 'studio' }))
    expect((await getActiveSubscription('u1'))?.id).toBe('older-studio')
  })

  it('a tier this code does not know grants NOTHING, and is reported with the row', async () => {
    // Reachable only if subscriptions_tier_check is widened without PACKAGE_TIERS following it --
    // the direction is still the safe one for an entitlement: nothing granted, somebody told.
    rows.push(row({ id: 'odd', tier: 'max' }))
    expect(await getActiveSubscription('u1')).toBeNull()
    expect(reports).toHaveLength(1)
    expect(reports[0].source).toBe('subscriptions')
    expect(reports[0].opts).toMatchObject({ account: 'u1', context: { id: 'odd', tier: 'max' } })
  })

  it('an unknown tier beside a known one: the known one wins, the unknown one is still reported', async () => {
    rows.push(row({ id: 'odd', tier: 'max' }), row({ id: 'fine', tier: 'pro' }))
    expect((await getActiveSubscription('u1'))?.id).toBe('fine')
    expect(reports).toHaveLength(1)
  })
})

describe("the tier, and whether we actually know it", () => {
  // A failed subscriptions query degrades to 'free'. That is right for display and wrong for a gate,
  // and the difference is the whole reason getUserTierResolved exists. ADMIN_EMAILS is unset in
  // tests, so computeUserTier returns before the auth round trip -- the failure below is the
  // subscriptions select alone.
  //
  // A different user id per case: the tier cache holds a good answer for 30 seconds, and a degraded
  // one is deliberately never cached.
  it('a query failure answers free, and says it is not authoritative', async () => {
    queryFails = true
    expect(await getUserTierById('user-degraded-a')).toBe('free')
    expect(await getUserTierResolved('user-degraded-b')).toEqual({ tier: 'free', authoritative: false })
  })

  it('a query that works is authoritative, for the tier it found', async () => {
    rows.push(row({ user_id: 'user-ok-a', tier: 'studio' }))
    expect(await getUserTierResolved('user-ok-a')).toEqual({ tier: 'studio', authoritative: true })
    expect(await getUserTierById('user-ok-b')).toBe('studio')
  })

  it('no user at all is answerable without asking anyone', async () => {
    expect(await getUserTierResolved(null)).toEqual({ tier: 'free', authoritative: true })
  })
})
