import { describe, it, expect, vi, beforeEach } from 'vitest'

// THE ROUTE THAT CAN HIDE A RUNNER'S OWN PHOTOGRAPHS FROM THEM.
//
// The signage list is applied at SEARCH time, in both matchers, so a number on it stops answering
// everywhere the moment it is saved. That is the feature: an owner clears the year printed on their
// finish arch and 1,145 wrong results disappear with no re-index. It is also the risk, because the
// same mechanism aimed at a real bib removes a runner from their own search — and unlike every other
// mistake in this product, that one generates no complaint. The runner looks, finds nothing, and
// concludes they were not photographed.
//
// So the decisions live in lib/bib-exclusions behind 25 tests and 14 mutations. What THIS covers is
// the wiring between them, which no module test can see: that the gate runs in one direction only,
// that what reaches the column is normalised, and that a guest with the album open is told.

const ALBUM_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

const state: {
  album: { id: string; owner_token: string; user_id: string | null; bib_excluded_numbers: string[] } | null
  tallies: Array<{ number: string; photos: number }>
  rpcError: string | null
  updateError: string | null
  updates: Array<Record<string, unknown>>
  broadcasts: Array<{ albumId: string; patch: Record<string, unknown> }>
  refuseTier: boolean
} = {
  album: null, tallies: [], rpcError: null, updateError: null,
  updates: [], broadcasts: [], refuseTier: false,
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: async () => ({
      data: state.rpcError ? null : state.tallies.map((t) => ({ number: t.number, photos: t.photos })),
      error: state.rpcError ? { message: state.rpcError } : null,
    }),
    from: () => {
      const chain: Record<string, unknown> = {}
      chain.update = (row: Record<string, unknown>) => { state.updates.push(row); return chain }
      chain.eq = async () => ({ error: state.updateError ? { message: state.updateError } : null })
      return chain
    },
  }),
}))

vi.mock('@/lib/album-owner-access', () => ({
  verifyOwnerViaCookieWithRateLimit: async () => (state.album
    ? { ok: true, album: state.album }
    : { ok: false, error: 'Album not found', status: 404, reason: 'not_found' }),
}))

// The tier gate is the subject of half this file, so it is a switch rather than a real lookup:
// what matters is WHETHER it was consulted, on which direction of change.
vi.mock('@/lib/require-tier', () => ({
  refuseBelowTier: async () => (state.refuseTier
    ? new Response(JSON.stringify({ error: 'Bib number search requires Max' }), { status: 403 })
    : null),
}))

vi.mock('@/lib/broadcast', () => ({
  queueAlbumSettingsBroadcast: (albumId: string, patch: Record<string, unknown>) => {
    state.broadcasts.push({ albumId, patch })
  },
}))

vi.mock('@/lib/request-security', () => ({ forbidCrossSiteRequest: () => null }))

vi.mock('@/lib/server/respond', () => ({
  refuseAccess: (f: { status: number; error: string }) =>
    new Response(JSON.stringify({ error: f.error }), { status: f.status }),
  serverError: (_s: string, _m: string, o: { publicMessage: string }) =>
    new Response(JSON.stringify({ error: o.publicMessage }), { status: 500 }),
}))

const { GET, POST } = await import('@/app/api/album/bib-exclusions/route')

const get = () => GET(new Request('https://hushare.space/api/album/bib-exclusions?slug=race'))
const post = (body: unknown) => POST(new Request('https://hushare.space/api/album/bib-exclusions', {
  method: 'POST', body: JSON.stringify(body),
}))

beforeEach(() => {
  state.album = { id: ALBUM_ID, owner_token: 'tok', user_id: 'user-1', bib_excluded_numbers: [] }
  state.tallies = []
  state.rpcError = null
  state.updateError = null
  state.updates = []
  state.broadcasts = []
  state.refuseTier = false
})

describe('GET — what the owner is offered', () => {
  it('refuses anyone who is not the owner', async () => {
    state.album = null
    expect((await get()).status).toBe(404)
  })

  it('refuses without a slug, before touching the database', async () => {
    const res = await GET(new Request('https://hushare.space/api/album/bib-exclusions'))
    expect(res.status).toBe(400)
  })

  it('returns the album numbers most-seen first, with their counts', async () => {
    state.tallies = [
      { number: '2188', photos: 61 }, { number: '2026', photos: 1145 }, { number: '700', photos: 508 },
    ]
    const body = await (await get()).json() as { candidates: Array<{ number: string; photos: number }> }
    expect(body.candidates.map((c) => c.number)).toEqual(['2026', '700', '2188'])
    expect(body.candidates[0].photos).toBe(1145)
  })

  it('OFFERS A REAL BIB TOO, because only a person can tell it from a banner', async () => {
    // 2188 is a runner on the measured album. A route that pre-filtered it would be the automatic
    // rule this whole feature exists to avoid — and on the 69-photo album the banner year and the
    // real bib 00663 appeared on exactly 4 photographs each.
    state.tallies = [{ number: '2026', photos: 1145 }, { number: '2188', photos: 61 }]
    const body = await (await get()).json() as { candidates: Array<{ number: string }> }
    expect(body.candidates.map((c) => c.number)).toContain('2188')
  })

  it('does not re-offer what is already excluded, and says what IS excluded', async () => {
    state.album = { ...state.album!, bib_excluded_numbers: ['2026'] }
    state.tallies = [{ number: '2026', photos: 1145 }, { number: '700', photos: 508 }]
    const body = await (await get()).json() as { candidates: Array<{ number: string }>; excluded: string[] }
    expect(body.candidates.map((c) => c.number)).toEqual(['700'])
    expect(body.excluded).toEqual(['2026'])
  })

  it('reports a failed tally rather than presenting an empty list as the answer', async () => {
    // An empty candidate list reads as "this album has no signage", which is a claim. A failure is
    // not that claim (rule 20).
    state.rpcError = 'connection reset'
    expect((await get()).status).toBe(500)
  })
})

describe('POST — the gate runs in one direction only', () => {
  it('REFUSES to add a number below the plan', async () => {
    state.refuseTier = true
    const res = await post({ slug: 'race', excluded: ['2026'] })
    expect(res.status).toBe(403)
    expect(state.updates, 'nothing may be written on a refusal').toEqual([])
  })

  it('ALLOWS removing a number below the plan — the whole point of the asymmetry', async () => {
    // An owner off the plan who excluded a real bib by mistake must still be able to undo it. A
    // gate that ran both ways would freeze that runner out of their own photographs permanently.
    state.album = { ...state.album!, bib_excluded_numbers: ['2026', '700'] }
    state.refuseTier = true
    const res = await post({ slug: 'race', excluded: ['2026'] })
    expect(res.status).toBe(200)
    expect(state.updates[0].bib_excluded_numbers).toEqual(['2026'])
  })

  it('ALLOWS clearing the list entirely below the plan', async () => {
    state.album = { ...state.album!, bib_excluded_numbers: ['2026'] }
    state.refuseTier = true
    expect((await post({ slug: 'race', excluded: [] })).status).toBe(200)
    expect(state.updates[0].bib_excluded_numbers).toEqual([])
  })

  it('checks the plan when the list changes membership, not merely its length', async () => {
    // Swapping one number for another is an ADDITION, and a length comparison would wave it past.
    state.album = { ...state.album!, bib_excluded_numbers: ['2026'] }
    state.refuseTier = true
    expect((await post({ slug: 'race', excluded: ['700'] })).status).toBe(403)
  })
})

describe('POST — what actually reaches the column', () => {
  it('stores the canonical numeric form, so a padded stored bib cannot escape the list', async () => {
    await post({ slug: 'race', excluded: ['02026'] })
    expect(state.updates[0].bib_excluded_numbers).toEqual(['2026'])
  })

  it('collapses the same number written several ways', async () => {
    await post({ slug: 'race', excluded: ['2026', '02026', '#2026'] })
    expect(state.updates[0].bib_excluded_numbers).toEqual(['2026'])
  })

  it('drops anything that is not a number rather than storing it', async () => {
    await post({ slug: 'race', excluded: ['2026', 'MARATHON', '', null, 7] })
    expect(state.updates[0].bib_excluded_numbers).toEqual(['2026'])
  })

  it('refuses a body that is not an array at all', async () => {
    expect((await post({ slug: 'race', excluded: '2026' })).status).toBe(400)
    expect(state.updates).toEqual([])
  })

  it('refuses without a slug', async () => {
    expect((await post({ excluded: ['2026'] })).status).toBe(400)
  })

  it('scopes the write to this album', async () => {
    await post({ slug: 'race', excluded: ['2026'] })
    expect(state.updates).toHaveLength(1)
  })

  it('reports a failed write instead of claiming it saved', async () => {
    state.updateError = 'permission denied'
    expect((await post({ slug: 'race', excluded: ['2026'] })).status).toBe(500)
    expect(state.broadcasts, 'a failed save must not tell guests it happened').toEqual([])
  })
})

describe('POST — the guests already looking', () => {
  it('broadcasts the new list so an open album stops showing the banner', async () => {
    // The list is applied on the phone as well as in the database. Without this a runner keeps
    // getting the banner's photographs until they reload — which is why the range is broadcast too.
    await post({ slug: 'race', excluded: ['2026'] })
    expect(state.broadcasts).toHaveLength(1)
    expect(state.broadcasts[0].albumId).toBe(ALBUM_ID)
    expect(state.broadcasts[0].patch.bib_excluded_numbers).toEqual(['2026'])
  })

  it('broadcasts the NORMALISED list, not what was posted', async () => {
    // A guest applying '02026' locally would filter nothing: bibMatches compares by value and the
    // stored spellings vary. The two halves have to receive the same thing.
    await post({ slug: 'race', excluded: ['02026'] })
    expect(state.broadcasts[0].patch.bib_excluded_numbers).toEqual(['2026'])
  })
})
