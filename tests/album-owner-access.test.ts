import { describe, it, expect, vi, beforeEach } from 'vitest'

// THE OWNER-TOKEN CHECK EVERY MUTATION ROUTE TRUSTS.
//
// Deleting an album, changing its password, flipping its gates — every one of those starts by
// asking this module "is the caller the owner?". A wrong yes hands a stranger the album; a wrong
// no locks the owner out of their own. Both are silent, and none of it was tested.
//
// The database, cookies and session are mocked at the module boundary; the token comparison, the
// slug rules and the claim logic are real.

type Row = { id: string; owner_token: string; user_id: string | null; slug: string; custom_slug: string | null }

const cfg: {
  rows: Row[]
  lookups: number
  claims: number
  user: { id: string } | null
  ownedCount: number
  cookieValue: string | null
  rlOk: boolean
  /** Rows the UPDATE...select() reports back. [] = the race guard matched nothing. */
  claimedRows: { id: string }[]
  updateError: boolean
  countError: boolean
} = {
  rows: [], lookups: 0, claims: 0, user: null, ownedCount: 0, cookieValue: null, rlOk: true,
  claimedRows: [{ id: 'alb-1' }], updateError: false, countError: false,
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: (_cols: string, opts?: { count?: string }) => {
        if (opts?.count) {
          // The claim-cap count: select('id', {count}).eq('user_id', ...).is('retired_at', null)
          // The cap count chains .is() twice now (retired_at, then package_tier — packaged
          // albums do not occupy a subscription slot). A thenable that also returns itself from
          // .is() tracks the real chain instead of hardcoding its length.
          const result = () => (cfg.countError ? { count: null, error: { message: 'boom' } } : { count: cfg.ownedCount, error: null })
          const chain: Record<string, unknown> = {}
          chain.is = () => chain
          chain.then = (resolve: (v: unknown) => void) => resolve(result())
          return { eq: () => chain }
        }
        // The album lookup: select(cols).or(...).is(...).limit(2).returns()
        return {
          or: () => ({
            is: () => ({
              limit: () => ({
                returns: async () => {
                  cfg.lookups++
                  return { data: cfg.rows, error: null }
                },
              }),
            }),
          }),
        }
      },
      update: () => ({
        eq: () => ({
          is: () => ({
            // .select('id') reads the update back. `claimedRows` is how a test says "somebody
            // else won the race": the guard matched nothing, so no row comes back.
            select: async () => {
              cfg.claims++
              if (cfg.updateError) return { data: null, error: { message: 'boom' } }
              return { data: cfg.claimedRows, error: null }
            },
          }),
        }),
      }),
    }),
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: cfg.user } }) } }),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (cfg.cookieValue === null ? undefined : { value: cfg.cookieValue }) }),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => (cfg.rlOk ? { ok: true } : { ok: false, retryAfterSeconds: 60 }),
  clientIpKey: () => 'test-key',
}))
vi.mock('@/lib/subscriptions', () => ({
  getUserTier: async () => 'free',
}))

import { verifyAlbumOwnerAccess, verifyOwnerViaCookie, verifyOwnerWithRateLimit } from '@/lib/album-owner-access'

const ALBUM: Row = { id: 'alb-1', owner_token: 'real-secret-token', user_id: 'owner-1', slug: 'abcd1234', custom_slug: null }

beforeEach(() => {
  cfg.rows = [ALBUM]
  cfg.lookups = 0
  cfg.claims = 0
  cfg.user = null
  cfg.ownedCount = 0
  cfg.cookieValue = null
  cfg.rlOk = true
  cfg.claimedRows = [{ id: 'alb-1' }]
  cfg.updateError = false
  cfg.countError = false
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

describe('the bearer-token path', () => {
  it('admits the real token and refuses everything else', async () => {
    expect((await verifyAlbumOwnerAccess('abcd1234', 'real-secret-token')).ok).toBe(true)
    const bad = await verifyAlbumOwnerAccess('abcd1234', 'guessed-token')
    expect(bad).toMatchObject({ ok: false, status: 403, reason: 'bad_token' })
  })

  it('refuses a token that merely shares a prefix', async () => {
    expect((await verifyAlbumOwnerAccess('abcd1234', 'real-secret-tok')).ok).toBe(false)
    expect((await verifyAlbumOwnerAccess('abcd1234', 'real-secret-token-plus')).ok).toBe(false)
  })

  it('400s on missing pieces without touching the database', async () => {
    expect((await verifyAlbumOwnerAccess('', 'tok')).ok).toBe(false)
    expect((await verifyAlbumOwnerAccess('abcd1234', '   ')).ok).toBe(false)
    expect(cfg.lookups).toBe(0)
  })
})

describe('the slug is sanitised before it reaches PostgREST', () => {
  it('never queries for a slug carrying filter-syntax characters', async () => {
    // The .or() lookup interpolates the slug into PostgREST filter syntax, where , ( ) . are
    // operators. The charset gate is the injection defence: a hostile slug must be answered
    // "not found" WITHOUT a database round trip, not passed into the filter string.
    // NOT in this list: an uppercase slug. It is lowercased BEFORE the charset check, so it is a
    // legitimate lookup — the first draft of this test listed it as hostile and failed against
    // correct code.
    for (const evil of ['a,custom_slug.eq.b', 'x)(y', 'a.b.c', 'sp ace', 'a*b']) {
      const r = await verifyAlbumOwnerAccess(evil, 'real-secret-token')
      expect(r).toMatchObject({ ok: false, status: 404 })
    }
    expect(cfg.lookups, 'no hostile slug may reach the query').toBe(0)
  })

  it('trims and lowercases before matching, so pasted links work', async () => {
    expect((await verifyAlbumOwnerAccess('  ABCD1234  ', 'real-secret-token')).ok).toBe(true)
  })
})

describe('a slug collision resolves to the RIGHT album', () => {
  it('prefers the row whose random slug matches, wherever it sits in the result', async () => {
    // One album's custom_slug can equal another album's random slug; both rows come back. Picking
    // rows[0] blind — which this code once did through an undefined property — 403s every owner
    // mutation on the second album. The owner of the RIGHT album must win regardless of order.
    const other: Row = { id: 'alb-2', owner_token: 'other-token', user_id: null, slug: 'zzzz9999', custom_slug: 'abcd1234' }
    cfg.rows = [other, ALBUM]
    const r = await verifyAlbumOwnerAccess('abcd1234', 'real-secret-token')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.album.id).toBe('alb-1')
  })
})

describe('the cookie path', () => {
  it('admits the owner cookie and refuses a wrong one', async () => {
    cfg.cookieValue = 'real-secret-token'
    expect((await verifyOwnerViaCookie('abcd1234')).ok).toBe(true)
    cfg.cookieValue = 'stale-or-forged'
    expect((await verifyOwnerViaCookie('abcd1234')).ok).toBe(false)
  })

  it('refuses an absent or empty cookie BEFORE any comparison', async () => {
    // The timing-oracle guard, and more: if a bug ever left owner_token empty, an empty cookie
    // compared against an empty token would be equal — a no-cookie visitor becoming the owner.
    cfg.cookieValue = null
    expect((await verifyOwnerViaCookie('abcd1234')).ok).toBe(false)
    cfg.rows = [{ ...ALBUM, owner_token: '' }]
    cfg.cookieValue = ''
    expect((await verifyOwnerViaCookie('abcd1234')).ok, 'empty must never equal empty here').toBe(false)
  })
})

describe('claiming an anonymous album', () => {
  const anon: Row = { ...ALBUM, user_id: null }

  it('claims for the signed-in owner when under the cap', async () => {
    cfg.rows = [anon]
    cfg.user = { id: 'user-9' }
    cfg.ownedCount = 1
    const r = await verifyAlbumOwnerAccess('abcd1234', 'real-secret-token')
    expect(r.ok).toBe(true)
    expect(cfg.claims).toBe(1)
    if (r.ok) expect(r.album.user_id).toBe('user-9')
  })

  it('at the cap, leaves the album anonymous but still grants access', async () => {
    // Creating signed-out and signing in later was a way around the album cap: claimed albums were
    // never counted. Over the limit the claim is quietly declined — the album keeps working, the
    // owner link keeps working, nothing is refused. Losing OWNER ACCESS over a cap would be
    // punishing someone for signing in.
    cfg.rows = [anon]
    cfg.user = { id: 'user-9' }
    cfg.ownedCount = 3   // free cap
    const r = await verifyAlbumOwnerAccess('abcd1234', 'real-secret-token')
    expect(r.ok, 'access must survive the declined claim').toBe(true)
    expect(cfg.claims).toBe(0)
    if (r.ok) expect(r.album.user_id).toBeNull()
  })

  it('LOSING THE RACE must not fabricate ownership in the returned album', async () => {
    // `.is('user_id', null)` exists precisely so a second claimer matches zero rows. The result
    // was never read back, so the loser still got an album object stamped with THEIR id and a log
    // line saying "claimed". That is not cosmetic: api/album/branding and api/album/custom-url
    // gate paid features on album.user_id, so the loser's request would have evaluated the
    // winner's album against the loser's plan. Owner links are shareable by design, so two
    // signed-in people holding one is an ordinary situation, not an exotic one.
    cfg.rows = [anon]
    cfg.user = { id: 'user-9' }
    cfg.ownedCount = 1
    cfg.claimedRows = []          // somebody else got there first
    const r = await verifyAlbumOwnerAccess('abcd1234', 'real-secret-token')
    expect(r.ok, 'access itself must survive').toBe(true)
    if (r.ok) {
      expect(r.album.user_id, 'must not claim an album we did not get').toBeNull()
      expect(r.claim).toBe('owned_by_other')
    }
  })

  it('a failed UPDATE is reported, not swallowed', async () => {
    cfg.rows = [anon]
    cfg.user = { id: 'user-9' }
    cfg.ownedCount = 1
    cfg.updateError = true
    const r = await verifyAlbumOwnerAccess('abcd1234', 'real-secret-token')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.album.user_id).toBeNull()
      expect(r.claim).toBe('owned_by_other')
    }
  })

  it('a count that FAILED is not a count of zero', async () => {
    // `count ?? 0` turned an errored query into "they own nothing", which waves the album straight
    // through the plan cap. Erring the other way leaves it anonymous, which the owner cannot even
    // see and which never over-grants (rule 19).
    cfg.rows = [anon]
    cfg.user = { id: 'user-9' }
    cfg.countError = true
    const r = await verifyAlbumOwnerAccess('abcd1234', 'real-secret-token')
    expect(r.ok, 'access must survive a count we could not take').toBe(true)
    expect(cfg.claims, 'must not write without knowing the cap').toBe(0)
    if (r.ok) {
      expect(r.album.user_id).toBeNull()
      expect(r.claim).toBe('not_counted')
    }
  })

  it('reports the outcome the route reports to the user', async () => {
    // POST /api/album/claim renders access.claim directly rather than re-deciding. If these
    // outcomes were ever wrong, the button would lie in the user's own words.
    cfg.rows = [anon]
    cfg.user = { id: 'user-9' }
    cfg.ownedCount = 1
    const claimed = await verifyAlbumOwnerAccess('abcd1234', 'real-secret-token')
    if (claimed.ok) expect(claimed.claim).toBe('claim')

    cfg.ownedCount = 3
    const full = await verifyAlbumOwnerAccess('abcd1234', 'real-secret-token')
    if (full.ok) { expect(full.claim).toBe('at_cap'); expect(full.claimCap).toBe(3) }

    cfg.rows = [ALBUM]   // already owned by owner-1
    cfg.user = { id: 'user-9' }
    const theirs = await verifyAlbumOwnerAccess('abcd1234', 'real-secret-token')
    if (theirs.ok) expect(theirs.claim).toBe('owned_by_other')
  })

  it('never claims an album that already has an owner', async () => {
    cfg.user = { id: 'someone-else' }
    const r = await verifyAlbumOwnerAccess('abcd1234', 'real-secret-token')
    expect(r.ok).toBe(true)
    expect(cfg.claims, 'a claimed album must not be re-claimed by whoever presents the token').toBe(0)
  })
})

describe('the rate-limited wrapper', () => {
  it('429s before it ever looks the album up', async () => {
    cfg.rlOk = false
    const req = new Request('https://hushare.space/x')
    const r = await verifyOwnerWithRateLimit(req, 'abcd1234', 'real-secret-token')
    expect(r).toMatchObject({ ok: false, status: 429, reason: 'rate_limited' })
    expect(cfg.lookups, 'a limited caller must cost nothing further').toBe(0)
  })
})
