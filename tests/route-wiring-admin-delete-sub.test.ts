import { describe, it, expect, vi, beforeEach } from 'vitest'

// THE BUTTON THAT REMOVES A BILLING ROW.
//
// Every other admin action grants something. This one takes a row out of the ledger, on a table
// where a person can hold two: alinagnuni3 has a cancelled REAL subscription and a comped studio
// grant sitting side by side. "Delete this person's subscription" would have to guess which, and
// the wrong guess either restores access somebody lost or removes access somebody is paying for.
// So it deletes by the row's own primary key and nothing else.
//
// It also does NOT reach Polar. Removing the local row of a live subscription does not stop the
// billing and the next reconcile brings it straight back. That is the safe direction -- an admin
// page must not be able to silently cancel a paid plan -- but it has to be SAID, or the next person
// discovers it by watching a row reappear.

const state: {
  admin: boolean
  row: Record<string, unknown> | null
  deletes: string[]
  deleteError: string | null
  /** Whether the request looks cross-site. Stubbing this to "always fine" meant the guard could be
   *  deleted outright with every test still green -- the mutation run said so. */
  crossSite: boolean
} = { admin: true, row: null, deletes: [], deleteError: null, crossSite: false }

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.admin ? { email: 'owner@hushare.space' } : { email: 'nobody@example.com' } } }) },
  }),
}))

vi.mock('@/lib/auth', () => ({ isAccountAdmin: () => state.admin }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = (_col: string, val: string) => {
        // The delete branch resolves on .eq; the select branch resolves on .maybeSingle.
        chain._id = val
        return chain
      }
      chain.maybeSingle = async () => ({ data: state.row, error: null })
      chain.delete = () => {
        const del: Record<string, unknown> = {}
        del.eq = async (_col: string, val: string) => {
          state.deletes.push(val)
          return { error: state.deleteError ? { message: state.deleteError } : null }
        }
        return del
      }
      return chain
    },
  }),
}))

vi.mock('@/lib/request-security', () => ({
  forbidCrossSiteRequest: () => (state.crossSite
    ? new Response(JSON.stringify({ error: 'Cross-site request refused' }), { status: 403 })
    : null),
}))
vi.mock('@/lib/email', () => ({ sendOwnerLinkEmail: async () => undefined }))

const { POST } = await import('@/app/api/admin/action/route')

function post(body: unknown) {
  return POST(new Request('https://hushare.space/api/admin/action', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}

const REAL_PRODUCT = '1afab126-3496-48d4-af31-705405791c38'

beforeEach(() => {
  state.admin = true
  state.deletes = []
  state.deleteError = null
  state.crossSite = false
  state.row = {
    id: 'row-1', user_id: 'u-1', tier: 'pro', status: 'canceled',
    polar_subscription_id: '198b2f55-9f05', polar_product_id: REAL_PRODUCT,
  }
})

describe('who may remove a subscription row', () => {
  it('is invisible to anyone who is not an admin', async () => {
    state.admin = false
    const res = await post({ action: 'delete_sub', subscriptionId: 'row-1' })
    expect(res.status).toBe(404)
    expect(state.deletes, 'nothing may be deleted for a non-admin').toEqual([])
  })

  it('refuses a cross-site request before anything else runs', async () => {
    // This endpoint is a plain POST behind a cookie, so the CSRF guard is the only thing standing
    // between a page on another origin and an admin's browser deleting a billing row.
    state.crossSite = true
    const res = await post({ action: 'delete_sub', subscriptionId: 'row-1' })
    expect(res.status).toBe(403)
    expect(state.deletes).toEqual([])
  })

  it('refuses without a row id rather than deleting something it picked', async () => {
    const res = await post({ action: 'delete_sub' })
    expect(res.status).toBe(400)
    expect(state.deletes).toEqual([])
  })

  it('reports a row that is not there instead of reporting success', async () => {
    state.row = null
    const res = await post({ action: 'delete_sub', subscriptionId: 'gone' })
    expect(res.status).toBe(404)
    expect(state.deletes).toEqual([])
  })
})

describe('what it deletes', () => {
  it('deletes exactly the row it was given, by its own primary key', async () => {
    // NEVER by user_id. One person holds two rows and they are not interchangeable.
    const res = await post({ action: 'delete_sub', subscriptionId: 'row-1' })
    expect(res.status).toBe(200)
    expect(state.deletes).toEqual(['row-1'])
  })

  it('reports a failed delete as a failure, not as a success', async () => {
    state.deleteError = 'permission denied'
    const res = await post({ action: 'delete_sub', subscriptionId: 'row-1' })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('what it tells the admin afterwards', () => {
  it('WARNS that a live paid row is still billing and will come back', async () => {
    // The one case where removing the row does not mean what it looks like it means.
    state.row = {
      id: 'row-2', user_id: 'u-2', tier: 'pro', status: 'active',
      polar_subscription_id: 'e694448f-8edb', polar_product_id: REAL_PRODUCT,
    }
    const body = await (await post({ action: 'delete_sub', subscriptionId: 'row-2' })).json() as { message: string }
    expect(body.message).toMatch(/did NOT cancel/i)
    expect(body.message).toMatch(/reconcile/i)
  })

  it('does not warn about billing for a COMPED row, because there is none', async () => {
    // A gift made by the script: polar_product_id is the bare string "comp", which is exactly the
    // shape the dashboard used to read as revenue.
    state.row = {
      id: 'row-3', user_id: 'u-3', tier: 'pro', status: 'active',
      polar_subscription_id: 'comp-c414fa3d', polar_product_id: 'comp',
    }
    const body = await (await post({ action: 'delete_sub', subscriptionId: 'row-3' })).json() as { message: string }
    expect(body.message).not.toMatch(/did NOT cancel/i)
    expect(body.message).toMatch(/comped/i)
  })

  it('calls a cancelled real row cancelled, not comped', async () => {
    const body = await (await post({ action: 'delete_sub', subscriptionId: 'row-1' })).json() as { message: string }
    expect(body.message).toMatch(/cancelled/i)
    expect(body.message).not.toMatch(/comped/i)
  })
})
