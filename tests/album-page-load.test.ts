import { describe, it, expect, vi, beforeEach } from 'vitest'

// THE ALBUM PAGE, ONE ALBUM READ AND THEN EVERYTHING ELSE AT ONCE.
//
// The review of 2026-09-14 measured a guest waiting ~2.3 s (4.7 s worst) for the first photo address,
// because the page made five database calls in a row at 350 ms-1 s each: the album by slug, the owner's
// plan, the album AGAIN by id, 500 photos, then the count. Only the first has to come first.
//
// What must not change while it gets faster is WHO SEES WHAT: the reveal and password gates, the
// hidden-photo filter for guests, and the owner cookie that lifts both. So this file pins those, and
// pins the speed as a fact about ORDER and ROUND TRIPS -- the plan and the photos start before either
// finishes, and the total arrives inside the photo request -- because a timing assertion on a fake
// database would prove nothing.

type Rec = { table: string; select: string; head: boolean; count: string | null; filters: Array<[string, unknown]> }

const cfg: {
  rows: Array<Record<string, unknown>> | null
  ownerToken: string | null
  photos: Array<Record<string, unknown>>
  photoCount: number
  albumReadFailures: number
  photoReadError: string | null
  cookies: Record<string, string>
  queries: Rec[]
  started: string[]
  reports: Array<{ source: string; message: string }>
} = { rows: null, ownerToken: null, photos: [], photoCount: 0, albumReadFailures: 0, photoReadError: null, cookies: {}, queries: [], started: [], reports: [] }

// Each slow step waits on this gate, so the test can see which steps had STARTED before any finished.
let release: () => void = () => {}
let gate = Promise.resolve()
function closeGate() { gate = new Promise<void>((r) => { release = r }) }

function builder(table: string): Record<string, unknown> {
  const rec: Rec = { table, select: '', head: false, count: null, filters: [] }
  cfg.queries.push(rec)
  const b: Record<string, unknown> = {}
  const self = () => b
  Object.assign(b, {
    select: (cols: string, opts?: { head?: boolean; count?: string }) => { rec.select = cols; rec.head = opts?.head === true; rec.count = opts?.count ?? null; return b },
    eq: (c: string, v: unknown) => { rec.filters.push([c, v]); return b },
    or: (e: string) => { rec.filters.push(['or', e]); return b },
    is: (c: string, v: unknown) => { rec.filters.push([c, v]); return b },
    update: self, order: self, limit: self, range: self, lt: self, not: self, neq: self,
    maybeSingle: async () => ({ data: cfg.ownerToken === null ? null : { owner_token: cfg.ownerToken }, error: null }),
    then: (resolve: (v: unknown) => void) => {
      if (table === 'albums') {
        if (cfg.albumReadFailures > 0) { cfg.albumReadFailures--; return resolve({ data: null, error: { message: 'Gateway Timeout' } }) }
        return resolve({ data: cfg.rows, error: null })
      }
      // photos: the window (with the total only when asked for in the same request) or a head count -- both slow, both gated.
      const kind = rec.head ? 'count' : 'photos'
      cfg.started.push(kind)
      return gate.then(() => resolve(
        rec.head
          ? { count: cfg.photoCount, error: null }
          : cfg.photoReadError ? { data: null, error: { message: cfg.photoReadError } } : { data: cfg.photos, count: rec.count === 'exact' ? cfg.photoCount : null, error: null },
      ))
    },
  })
  return b
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (t: string) => builder(t) }) }))
vi.mock('@/lib/subscriptions', () => ({
  getUserTierById: async () => { cfg.started.push('tier'); await gate; return 'studio' },
  getUserTierResolved: async () => ({ tier: 'studio', authoritative: true }),
}))
vi.mock('@/lib/report-server-error', () => ({ reportServerError: (source: string, message: string) => { cfg.reports.push({ source, message }) } }))

process.env.ALBUM_PASSWORD_PEPPER ??= 'test-pepper-value-not-a-real-secret'

const { loadAlbumPage } = await import('@/lib/server/album-access')
const { hashPassword } = await import('@/lib/album-password')

const ALBUM_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const SLUG = 'abcd1234'
const OWNER_TOKEN = 'owner-token-256-bits-worth-of-secret'
const ALBUM = {
  id: ALBUM_ID, slug: SLUG, custom_slug: null, title: 'A wedding', user_id: 'owner-1',
  password_hash: null, reveal_at: null, retired_at: null, photo_order: null,
  created_at: '2026-09-01T00:00:00.000Z', last_activity_at: new Date().toISOString(),
  header_touched: true, cover_photo_id: null, header_image: null,
  package_tier: null, package_expires_at: null, hide_branding: false, branding_locked: false,
  logo_url: null, sponsor_logos: [], face_finder_enabled: false, bib_search_enabled: false,
}
const PHOTO = { id: 'p1', album_id: ALBUM_ID, media_type: 'image', storage_backend: 'r2', url: 'https://cdn.test/p1.jpg' }

const jar = () => ({ get: (n: string) => (n in cfg.cookies ? { value: cfg.cookies[n] } : undefined) })
const load = () => loadAlbumPage(SLUG, jar())
const photoQueries = () => cfg.queries.filter((q) => q.table === 'photos' && !q.head)

beforeEach(() => {
  cfg.rows = [{ ...ALBUM }]
  cfg.ownerToken = OWNER_TOKEN
  cfg.photos = [{ ...PHOTO }]
  cfg.photoCount = 1
  cfg.albumReadFailures = 0
  cfg.photoReadError = null
  cfg.cookies = {}
  cfg.queries = []
  cfg.started = []
  cfg.reports = []
  gate = Promise.resolve()
})

describe('loadAlbumPage -- the speed', () => {
  it('THE ALBUM IS READ ONCE, not once by slug and again by id', async () => {
    await load()
    expect(cfg.queries.filter((q) => q.table === 'albums')).toHaveLength(1)
  })

  it('THE PLAN AND THE PHOTOS START BEFORE EITHER FINISHES', async () => {
    closeGate()
    const pending = load()
    // Let the album read and the gate decision run; everything slow is now waiting on the gate.
    await new Promise((r) => setTimeout(r, 30))
    expect([...cfg.started].sort(), 'sequential reads would show only the first one started').toEqual(['photos', 'tier'])
    release()
    const res = await pending
    expect(res.kind).toBe('album')
  })

  it('THE TOTAL COMES BACK IN THE PHOTO REQUEST, not in a second round trip', async () => {
    await load()
    expect(cfg.queries.filter((q) => q.table === 'photos' && q.head), 'a separate count query').toHaveLength(0)
    expect(photoQueries()).toHaveLength(1)
    expect(photoQueries()[0].count).toBe('exact')
  })

  it('returns the album, its first window of photos and the true total', async () => {
    cfg.photoCount = 4566
    const res = await load()
    expect(res.kind).toBe('album')
    if (res.kind !== 'album') return
    expect(res.album.id).toBe(ALBUM_ID)
    expect(res.photos.map((p) => p.id)).toEqual(['p1'])
    expect(res.total).toBe(4566)
  })
})

describe('loadAlbumPage -- who sees what, unchanged', () => {
  it('a SEALED album gives its countdown and reads no photos', async () => {
    cfg.rows = [{ ...ALBUM, reveal_at: new Date(Date.now() + 86_400_000).toISOString() }]
    expect((await load()).kind).toBe('reveal')
    expect(photoQueries()).toHaveLength(0)
  })

  it('a PASSWORD album gives a stranger the prompt and reads no photos', async () => {
    cfg.rows = [{ ...ALBUM, password_hash: await hashPassword('secret-pass') }]
    expect((await load()).kind).toBe('password')
    expect(photoQueries()).toHaveLength(0)
  })

  it('A GUEST NEVER GETS HIDDEN PHOTOS: the window and the count both carry the filter', async () => {
    await load()
    for (const q of cfg.queries.filter((x) => x.table === 'photos')) {
      expect(q.filters, `${q.head ? 'count' : 'window'} without the hidden filter`).toContainEqual(['hidden', false])
    }
  })

  it('the OWNER COOKIE sees every photo on their own open album, after checking the token', async () => {
    cfg.cookies[`hushare_owner_${ALBUM_ID}`] = OWNER_TOKEN
    await load()
    const windowQuery = photoQueries()[0]
    expect(windowQuery.filters).not.toContainEqual(['hidden', false])
  })

  it('a WRONG owner cookie is a guest', async () => {
    cfg.cookies[`hushare_owner_${ALBUM_ID}`] = 'not-the-token'
    await load()
    expect(photoQueries()[0].filters).toContainEqual(['hidden', false])
  })

  it('THE OWNER TOKEN NEVER TRAVELS WITH THE ALBUM the page hands to the browser', async () => {
    const res = await load()
    if (res.kind !== 'album') throw new Error('expected an album')
    expect(res.album).not.toHaveProperty('owner_token')
    expect(res.album).not.toHaveProperty('password_hash')
    expect(res.album).not.toHaveProperty('user_id')
  })
})

describe('loadAlbumPage -- a database that blinks', () => {
  it('a failed album read is unavailable, never notfound', async () => {
    cfg.albumReadFailures = 2
    expect((await load()).kind).toBe('unavailable')
  })

  it('A FAILED PHOTO READ STILL RENDERS THE ALBUM, with no photos, and is reported -- the client refetches', async () => {
    cfg.photoReadError = 'Gateway Timeout'
    const res = await load()
    expect(res.kind).toBe('album')
    if (res.kind !== 'album') return
    expect(res.photos).toEqual([])
    expect(cfg.reports.some((r) => r.source === 'album-access')).toBe(true)
  })
})
