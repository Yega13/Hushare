import { describe, it, expect, vi, beforeEach } from 'vitest'

// WHO GETS TO SEE THE PHOTOS.
//
// gateAllowsContribution decides who may ADD to an album, and tests/contribution-gate covers it.
// This is the other half and the one nobody had tested at all: fetchAuthorizedPhotos is what every
// album page, the live wall, the delta refresh and the bib search read through, and it is the only
// thing between a stranger who knows an album id and the photo URLs inside it.
//
// The gate itself is albumGateVerdict, shared since 2026-09-11 with resolveAlbum (viewing the
// album) and gateAllowsContribution (adding to it) -- one decision, held from three directions by
// scripts/mutations/album-gate-verdict.mjs, which runs each break against all three callers' tests
// at once. What stays this caller's own is who it counts as the owner, and the moderation filter.
//
// THE MODERATION FILTER IS HERE TOO, and it is the same class of secret: a photo awaiting approval,
// or one the owner has hidden, must not reach a guest. One missing `.eq('hidden', false)` publishes
// every photo the owner took down.

type Rec = { table: string; select: string; head: boolean; filters: Array<[string, unknown]> }

const cfg: {
  album: Record<string, unknown> | null
  photos: Array<Record<string, unknown>>
  photoCount: number
  newest: Record<string, unknown> | null
  cookies: Record<string, string>
  queries: Rec[]
} = { album: null, photos: [], photoCount: 0, newest: null, cookies: {}, queries: [] }

// A builder that records what was asked and answers plausibly. It records FILTERS because that is
// where the secret lives: `.eq('hidden', false)` is the difference between a guest seeing an
// album's approved photos and seeing everything in it, and the returned rows look identical.
function builder(table: string): Record<string, unknown> {
  const rec: Rec = { table, select: '', head: false, filters: [] }
  cfg.queries.push(rec)
  const b: Record<string, unknown> = {}
  const self = () => b
  Object.assign(b, {
    select: (cols: string, opts?: { count?: string; head?: boolean }) => { rec.select = cols; rec.head = opts?.head === true; return b },
    eq: (c: string, v: unknown) => { rec.filters.push([c, v]); return b },
    gt: (c: string, v: unknown) => { rec.filters.push([c, v]); return b },
    overlaps: (c: string, v: unknown) => { rec.filters.push([c, v]); return b },
    order: self, limit: self, range: self, is: self,
    maybeSingle: async () => ({ data: table === 'albums' ? cfg.album : cfg.newest, error: null }),
    then: (resolve: (v: unknown) => void) =>
      resolve(rec.head ? { count: cfg.photoCount, error: null } : { data: cfg.photos, count: cfg.photoCount, error: null }),
  })
  return b
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (t: string) => builder(t) }) }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (n: string) => (n in cfg.cookies ? { value: cfg.cookies[n] } : undefined) }) }))
vi.mock('@/lib/report-server-error', () => ({ reportServerError: () => {} }))

process.env.ALBUM_PASSWORD_PEPPER ??= 'test-pepper-value-not-a-real-secret'

import { fetchAuthorizedPhotos } from '@/lib/server/album-access'
import { hashPassword, deriveAccessToken } from '@/lib/album-password'

const ALBUM_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const OTHER_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const OWNER_TOKEN = 'owner-token-256-bits-worth-of-secret'
const OPEN_ALBUM = {
  id: ALBUM_ID, user_id: null, owner_token: OWNER_TOKEN, password_hash: null, reveal_at: null,
  retired_at: null, bib_search_enabled: false, bib_min: null, bib_max: null,
  bib_excluded_numbers: null, photo_order: null, package_tier: null, package_expires_at: null,
}

const jar = () => ({ get: (n: string) => (n in cfg.cookies ? { value: cfg.cookies[n] } : undefined) })
const list = (opts = {}) => fetchAuthorizedPhotos(ALBUM_ID, jar(), opts)

beforeEach(() => {
  cfg.album = { ...OPEN_ALBUM }
  cfg.photos = [{ id: 'p1' }]
  cfg.photoCount = 1
  cfg.newest = null
  cfg.cookies = {}
  cfg.queries = []
})

describe('an album that cannot be listed at all', () => {
  it('refuses an id that is not a UUID, without touching the database', async () => {
    // The id is interpolated into PostgREST filters downstream. Anything that is not a UUID is
    // refused before a query is built, not sanitised on the way past.
    for (const bad of ['not-a-uuid', '', "' or 1=1--", `${ALBUM_ID} `]) {
      expect((await fetchAuthorizedPhotos(bad, jar())).kind, bad).toBe('invalid')
    }
    expect(cfg.queries.length, 'a bad id must cost no query at all').toBe(0)
  })

  it('a missing album is not found', async () => {
    cfg.album = null
    expect((await list()).kind).toBe('notfound')
  })

  it('a RETIRED album is not found, even for its owner', async () => {
    // Retired means the retention window has expired and the data is queued for deletion. It must
    // not be readable while it waits, by anyone.
    cfg.album = { ...OPEN_ALBUM, retired_at: '2026-01-01T00:00:00.000Z' }
    cfg.cookies[`hushare_owner_${ALBUM_ID}`] = OWNER_TOKEN
    expect((await list()).kind).toBe('notfound')
  })
})

describe('the password and reveal gate, on the READING side', () => {
  it('an open album lists for anyone', async () => {
    expect((await list()).kind).toBe('ok')
  })

  it('a SEALED album tells nobody what is inside before its date', async () => {
    cfg.album = { ...OPEN_ALBUM, reveal_at: new Date(Date.now() + 86_400_000).toISOString() }
    expect((await list()).kind).toBe('reveal')
  })

  it('and lists once the date has passed', async () => {
    cfg.album = { ...OPEN_ALBUM, reveal_at: new Date(Date.now() - 86_400_000).toISOString() }
    expect((await list()).kind).toBe('ok')
  })

  it('A PASSWORD-PROTECTED ALBUM SHOWS A STRANGER NOTHING', async () => {
    // Knowing the album id was once enough. This is the check that makes it not enough.
    cfg.album = { ...OPEN_ALBUM, password_hash: await hashPassword('secret-pass') }
    expect((await list()).kind).toBe('password')
  })

  it('lists for a guest who actually unlocked it', async () => {
    const hash = await hashPassword('secret-pass')
    cfg.album = { ...OPEN_ALBUM, password_hash: hash }
    cfg.cookies[`hushare_pw_${ALBUM_ID}`] = await deriveAccessToken(hash, ALBUM_ID)
    expect((await list()).kind).toBe('ok')
  })

  it("REFUSES a token minted for a DIFFERENT album", async () => {
    const hash = await hashPassword('secret-pass')
    cfg.album = { ...OPEN_ALBUM, password_hash: hash }
    cfg.cookies[`hushare_pw_${ALBUM_ID}`] = await deriveAccessToken(hash, OTHER_ID)
    expect((await list()).kind).toBe('password')
  })

  it('refuses an empty password cookie rather than treating it as unlocked', async () => {
    cfg.album = { ...OPEN_ALBUM, password_hash: await hashPassword('secret-pass') }
    cfg.cookies[`hushare_pw_${ALBUM_ID}`] = ''
    expect((await list()).kind).toBe('password')
  })
})

describe('reveal comes before password when an album carries both', () => {
  it('a correct password does not list a SEALED album early', async () => {
    // One line in albumGateVerdict decides this for the page, the photo listing and the upload at
    // once. Nothing pinned it until a review mutated the order and the whole suite stayed green.
    const hash = await hashPassword('secret-pass')
    cfg.album = { ...OPEN_ALBUM, password_hash: hash, reveal_at: new Date(Date.now() + 86_400_000).toISOString() }
    cfg.cookies[`hushare_pw_${ALBUM_ID}`] = await deriveAccessToken(hash, ALBUM_ID)
    expect((await list()).kind).toBe('reveal')
  })
})

describe('the owner gets past both gates, and only the real owner', () => {
  const locked = async () => ({
    ...OPEN_ALBUM,
    password_hash: await hashPassword('secret-pass'),
    reveal_at: new Date(Date.now() + 86_400_000).toISOString(),
  })

  it('the owner cookie opens a sealed, password-protected album', async () => {
    cfg.album = await locked()
    cfg.cookies[`hushare_owner_${ALBUM_ID}`] = OWNER_TOKEN
    expect((await list()).kind).toBe('ok')
  })

  it('a WRONG owner token does not, and neither does a PREFIX of the real one', async () => {
    // `startsWith` reads as a match and turns a 256-bit secret into a character-at-a-time walk.
    cfg.album = await locked()
    for (const guess of ['not-the-token', OWNER_TOKEN.slice(0, 1), OWNER_TOKEN.slice(0, -1), `${OWNER_TOKEN}x`]) {
      cfg.cookies[`hushare_owner_${ALBUM_ID}`] = guess
      expect((await list()).kind, `"${guess}"`).not.toBe('ok')
    }
  })

  it('an EMPTY owner cookie is not a match, even against an empty token', async () => {
    // timingSafeEqual('', '') is true, so the length guard at the call site is load-bearing.
    cfg.album = { ...(await locked()), owner_token: '' }
    cfg.cookies[`hushare_owner_${ALBUM_ID}`] = ''
    expect((await list()).kind).not.toBe('ok')
  })

  it('both cookies key on the ROW id, not on the id the caller happened to type', async () => {
    // UUID_RE carries /i, so an uppercase id in the request validates; Postgres answers with the
    // canonical lowercase one; and the access token HMACs the id's exact bytes. Keying on the
    // caller's string looked for a cookie never set under that name and verified against a value
    // no token was minted for -- it failed CLOSED, which is why nobody saw it, and it disagreed
    // with the two places that set and read these cookies.
    cfg.album = await locked()
    cfg.cookies[`hushare_owner_${ALBUM_ID}`] = OWNER_TOKEN
    const res = await fetchAuthorizedPhotos(ALBUM_ID.toUpperCase(), jar())
    expect(res.kind, 'the owner is still the owner when the URL shouts').toBe('ok')
  })

  it('the cookie is read under a name carrying THIS album id', async () => {
    // A fixed cookie name would make one album's owner cookie open every album the visitor touches.
    cfg.album = await locked()
    cfg.cookies[`hushare_owner_${OTHER_ID}`] = OWNER_TOKEN
    expect((await list()).kind, "another album's owner cookie must not open this one").not.toBe('ok')
  })
})

describe('a guest never sees a photo the owner took down', () => {
  // Moderation and manual hiding are the same secret as the password: a photo pending approval, or
  // one an owner removed from view, must not reach a guest. The rows look identical either way --
  // only the FILTER on the query is different, so that is what is asserted.
  const photoFilters = () => cfg.queries.filter((q) => q.table === 'photos')

  it('every photo query a guest causes is filtered to hidden = false', async () => {
    await list()
    const qs = photoFilters()
    expect(qs.length, 'the listing must query photos at all').toBeGreaterThan(0)
    for (const q of qs) {
      expect(q.filters, `a guest query without the hidden filter: ${q.select}`)
        .toContainEqual(['hidden', false])
    }
  })

  it('...on the delta read too, which is a different query', async () => {
    await list({ since: '2026-09-01T00:00:00.000Z' })
    for (const q of photoFilters()) expect(q.filters).toContainEqual(['hidden', false])
  })

  it('...and on the cheap probe, which is the one a live album calls every few seconds', async () => {
    await list({ probe: true })
    const qs = photoFilters()
    expect(qs.length, 'probe asks two questions').toBeGreaterThan(1)
    for (const q of qs) expect(q.filters).toContainEqual(['hidden', false])
  })

  it('but the OWNER sees everything, or they cannot review what is waiting', async () => {
    cfg.cookies[`hushare_owner_${ALBUM_ID}`] = OWNER_TOKEN
    await list()
    for (const q of photoFilters()) {
      expect(q.filters.map(([c]) => c), 'the owner must not be filtered by hidden').not.toContain('hidden')
    }
  })

  it('every photo query is scoped to THIS album', async () => {
    await list()
    for (const q of photoFilters()) {
      expect(q.filters, `an unscoped photo query: ${q.select}`).toContainEqual(['album_id', ALBUM_ID])
    }
  })
})

describe('the bib bounds come from the ALBUM, never from the caller', () => {
  it('the album row is asked for the columns the search decides with', async () => {
    // bib_min/bib_max/bib_excluded_numbers decide which OCR readings count. Accepting them from the
    // request would let anyone widen the race's numbering and pull back photos the owner's bounds
    // were set to exclude.
    await list()
    const albumQuery = cfg.queries.find((q) => q.table === 'albums')
    expect(albumQuery, 'the album must be looked up').toBeDefined()
    for (const col of ['bib_min', 'bib_max', 'bib_excluded_numbers', 'bib_search_enabled', 'password_hash', 'reveal_at', 'owner_token', 'retired_at']) {
      expect(albumQuery?.select, `${col} must be selected`).toContain(col)
    }
    // ...and the row it gates on is THIS album's. An unfiltered lookup answers with whichever
    // album PostgREST returns first, so every gate above would then be applied to a stranger's
    // settings -- and the rows it hands back look exactly the same.
    expect(albumQuery?.filters, 'the album lookup must be filtered by id').toContainEqual(['id', ALBUM_ID])
  })
})
