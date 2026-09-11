import { describe, it, expect, vi, beforeEach } from 'vitest'
// The real ceiling, imported rather than typed again: the column carries the same bound as a CHECK
// and a copy here would drift from both (rule 13/17).
import { MAX_EXCLUSIONS } from '@/lib/bib-exclusions'

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
  // sample_thumb IS the RPC's column name, and the fake carried only two columns -- so nothing
  // covered the route mapping it to sampleThumb, and the photograph the panel is built around
  // could have been dropped in transit without a test noticing.
  tallies: Array<{ number: string; photos: number; sample_thumb?: string | null }>
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
      data: state.rpcError ? null : state.tallies.map((t) => ({
        number: t.number, photos: t.photos, sample_thumb: t.sample_thumb ?? null,
      })),
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
    const body = await (await get()).json() as { rows: Array<{ number: string; photos: number }> }
    expect(body.rows.map((c) => c.number)).toEqual(['2026', '700', '2188'])
    expect(body.rows[0].photos).toBe(1145)
  })

  it('OFFERS A REAL BIB TOO, because only a person can tell it from a banner', async () => {
    // 2188 is a runner on the measured album. A route that pre-filtered it would be the automatic
    // rule this whole feature exists to avoid — and on the 69-photo album the banner year and the
    // real bib 00663 appeared on exactly 4 photographs each.
    state.tallies = [{ number: '2026', photos: 1145 }, { number: '2188', photos: 61 }]
    const body = await (await get()).json() as { rows: Array<{ number: string }> }
    expect(body.rows.map((c) => c.number)).toContain('2188')
  })

  it('KEEPS an excluded number, with its count and its photograph, and says it is excluded', async () => {
    // An owner reopening the panel found the number they had switched off reduced to a struck-out
    // digit string -- no photograph, no count, last in the list -- because the row list was built
    // from candidates and an excluded number is correctly not a candidate. Undoing an exclusion is
    // this panel's load-bearing property, and it cannot be done from evidence that was taken away.
    state.album = { ...state.album!, bib_excluded_numbers: ['2026'] }
    state.tallies = [
      { number: '2026', photos: 1145, sample_thumb: 'https://cdn/arch.jpg' },
      { number: '700', photos: 508 },
    ]
    const body = await (await get()).json() as {
      rows: Array<{ number: string; photos: number; sampleThumb?: string | null }>
      excluded: string[]
    }
    expect(body.rows.map((c) => c.number)).toEqual(['2026', '700'])
    expect(body.rows[0].photos).toBe(1145)
    expect(body.rows[0].sampleThumb).toBe('https://cdn/arch.jpg')
    expect(body.excluded).toEqual(['2026'])
  })

  it('rows an exclusion that has fallen below the top-20 cut, so it can still be undone', async () => {
    // The cap is a floor on the QUESTION -- how many numbers a person is asked about at once --
    // and must never be a floor on the answer. An album with a long tail of signage pushes an
    // early exclusion out of the top 20, and if the route rowed only what it is offering, that
    // exclusion would be invisible and therefore permanent. It is a real bib often enough to
    // matter: the panel offers real bibs by design, because only a person can tell them apart.
    state.album = { ...state.album!, bib_excluded_numbers: ['9001'] }
    state.tallies = Array.from({ length: 25 }, (_, i) => ({ number: String(100 + i), photos: 500 - i }))
    state.tallies.push({ number: '9001', photos: 3 })
    const body = await (await get()).json() as { rows: Array<{ number: string }> }
    expect(body.rows.map((r) => r.number)).toContain('9001')
  })

  it('shows one row for a number the tallies spell two ways, with the counts added', async () => {
    // The RPC groups by the literal OCR string, so one number arrives as two tallies. Two rows for
    // one number splits the count the decision rests on, and is the symptom the redesign removed.
    state.tallies = [{ number: '2026', photos: 1105 }, { number: '02026', photos: 40 }]
    const body = await (await get()).json() as { rows: Array<{ number: string; photos: number }> }
    expect(body.rows).toHaveLength(1)
    expect(body.rows[0].photos).toBe(1145)
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

  it('ALLOWS a removal when the column holds a non-canonical spelling', async () => {
    // The gate compared TEXT. `next` is canonical and the column is whatever is in it, so with
    // '02026' stored, removing 700 leaves a survivor that normalises to '2026' -- a string the
    // stored list does not contain. The gate read that as an ADDITION and refused the removal,
    // which is precisely what the asymmetry above exists to prevent: an owner off the plan frozen
    // out of undoing an exclusion, and the runner behind it hidden from their own search forever.
    state.album = { ...state.album!, bib_excluded_numbers: ['02026', '700'] }
    state.refuseTier = true
    const res = await post({ slug: 'race', excluded: ['02026'] })
    expect(res.status).toBe(200)
    expect(state.updates[0].bib_excluded_numbers).toEqual(['2026'])
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

describe('POST — the ceiling is said out loud, not swallowed', () => {
  // normalizeExclusions keeps the FIRST 200 and the panel appends a new number at the END, so at
  // the ceiling the number just tapped is the one dropped. The column is then rewritten identical,
  // the response carries the unchanged list, and the row springs back on with nothing said -- a
  // screen showing a state the album does not hold (rule 20).

  it('refuses a list that would be truncated, rather than storing it short', async () => {
    const many = Array.from({ length: MAX_EXCLUSIONS + 1 }, (_, i) => String(i + 1))
    const res = await post({ slug: 'race', excluded: many })
    expect(res.status).toBe(400)
    expect(state.updates, 'nothing may be written on a refusal').toEqual([])
  })

  it('says what the limit is, so the message is actionable', async () => {
    const many = Array.from({ length: MAX_EXCLUSIONS + 1 }, (_, i) => String(i + 1))
    const body = await (await post({ slug: 'race', excluded: many })).json() as { error: string }
    expect(body.error).toContain(String(MAX_EXCLUSIONS))
  })

  it('accepts a list exactly AT the ceiling', async () => {
    const exact = Array.from({ length: MAX_EXCLUSIONS }, (_, i) => String(i + 1))
    expect((await post({ slug: 'race', excluded: exact })).status).toBe(200)
    expect(state.updates[0].bib_excluded_numbers).toHaveLength(MAX_EXCLUSIONS)
  })

  it('counts DISTINCT numbers, not raw entries, so duplicates do not trip the ceiling', async () => {
    // A panel resend, a double tap, or a list carrying two spellings of the same number can push
    // the raw count past 200 while the album is nowhere near the limit. Refusing that would block a
    // save the owner is entitled to make, and the message would name a limit they have not reached.
    // PADDED, not repeated. A plain repeat collapses in any Set, so it would prove nothing about
    // whether the ceiling counts spellings or numbers. "7" and "007" are one number and two strings.
    const distinct = Array.from({ length: 150 }, (_, i) => String(i + 1))
    const withDupes = [...distinct, ...distinct.slice(0, 100).map((n) => `00${n}`)]
    expect(withDupes.length).toBeGreaterThan(MAX_EXCLUSIONS)
    const res = await post({ slug: 'race', excluded: withDupes })
    expect(res.status).toBe(200)
    expect(state.updates[0].bib_excluded_numbers).toHaveLength(150)
  })

  it('still cleans junk silently — only the CAP is worth refusing over', async () => {
    // Nothing the owner asked for is lost by dropping a duplicate or an unparseable entry.
    const res = await post({ slug: 'race', excluded: ['2026', '02026', 'abc', '', '700'] })
    expect(res.status).toBe(200)
    expect(state.updates[0].bib_excluded_numbers).toEqual(['2026', '700'])
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
