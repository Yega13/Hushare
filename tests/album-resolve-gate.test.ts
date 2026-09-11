import { describe, it, expect, vi, beforeEach } from 'vitest'

// WHO GETS TO SEE THE ALBUM PAGE, and what it hands them when they do.
//
// resolveAlbum is the third and last of the three copies of one gate in lib/server/album-access
// (see ARCHITECTURE.md section 6). gateAllowsContribution decides who may ADD, fetchAuthorizedPhotos
// decides who may LIST photos, and this one decides whether the page renders at all -- and, once it
// does, which of the album's paid marks are published with it.
//
// It had only source-reading assertions: tests/gate-direction reads this file's text to check that
// certain masks are written down. Nothing ran it. So nothing had ever established that a stranger
// is refused, that the password hash does not travel to the browser, or that a lapsed plan stops
// publishing the marks it paid for -- which is the leak those masks exist for, and which survived a
// cancelled subscription forever the first time.

type Rec = { table: string; select: string; filters: Array<[string, unknown]>; limit?: number; updated?: Record<string, unknown> }

const cfg: {
  rows: Array<Record<string, unknown>> | null
  ownerRow: Record<string, unknown> | null
  tier: 'free' | 'pro' | 'studio'
  cookies: Record<string, string>
  queries: Rec[]
} = { rows: null, ownerRow: null, tier: 'free', cookies: {}, queries: [] }

function builder(table: string): Record<string, unknown> {
  const rec: Rec = { table, select: '', filters: [] }
  cfg.queries.push(rec)
  const b: Record<string, unknown> = {}
  const self = () => b
  Object.assign(b, {
    select: (cols: string) => { rec.select = cols; return b },
    update: (patch: Record<string, unknown>) => { rec.updated = patch; return b },
    eq: (c: string, v: unknown) => { rec.filters.push([c, v]); return b },
    or: (expr: string) => { rec.filters.push(['or', expr]); return b },
    is: (c: string, v: unknown) => { rec.filters.push([c, v]); return b },
    order: self,
    // HONOURS THE LIMIT. A mock that ignores it cannot see `.limit(1)`, and one row is exactly what
    // makes a slug collision unresolvable -- the resolver then has nothing to choose from.
    limit: (n: number) => { rec.limit = n; return b },
    // The owner-token lookup is the only maybeSingle here.
    maybeSingle: async () => ({ data: cfg.ownerRow, error: null }),
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: rec.limit === undefined ? cfg.rows : (cfg.rows ?? []).slice(0, rec.limit), error: null }),
  })
  return b
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (t: string) => builder(t) }) }))
vi.mock('@/lib/subscriptions', () => ({ getUserTierById: async () => cfg.tier }))
vi.mock('@/lib/report-server-error', () => ({ reportServerError: () => {} }))

process.env.ALBUM_PASSWORD_PEPPER ??= 'test-pepper-value-not-a-real-secret'

import { resolveAlbum } from '@/lib/server/album-access'
import { hashPassword, deriveAccessToken } from '@/lib/album-password'

const ALBUM_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const OTHER_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const SLUG = 'abcd1234'
const OWNER_TOKEN = 'owner-token-256-bits-worth-of-secret'

// last_activity_at is recent and header_touched is true, so the two fire-and-forget writes at the
// end of resolveAlbum return early. This file is about the gate, not about those.
const ALBUM = {
  id: ALBUM_ID, slug: SLUG, custom_slug: null, title: 'A wedding', user_id: 'owner-1',
  owner_token: OWNER_TOKEN, password_hash: null, reveal_at: null, retired_at: null,
  created_at: '2026-09-01T00:00:00.000Z', last_activity_at: new Date().toISOString(),
  header_touched: true, cover_photo_id: null, header_image: null,
  package_tier: null, package_expires_at: null,
  hide_branding: true, branding_locked: false, logo_url: 'https://cdn.test/logo.png',
  sponsor_logos: [{ url: 'https://cdn.test/s.png', name: 'Sponsor' }],
  face_finder_enabled: true, bib_search_enabled: true,
}

const jar = () => ({ get: (n: string) => (n in cfg.cookies ? { value: cfg.cookies[n] } : undefined) })
const resolve = (slug = SLUG, wantsOwner = false) => resolveAlbum(slug, wantsOwner, jar())

beforeEach(() => {
  cfg.rows = [{ ...ALBUM }]
  cfg.ownerRow = { owner_token: OWNER_TOKEN }
  cfg.tier = 'studio'
  cfg.cookies = {}
  cfg.queries = []
})

describe('which album, if any', () => {
  it('refuses a slug that cannot be one, without touching the database', async () => {
    // The slug is interpolated into a PostgREST `.or()` filter expression. Anything outside the
    // charset is refused before a query exists, never escaped on the way past.
    for (const bad of ['', 'abc', 'a'.repeat(81), 'has space', 'quote"mark', 'comma,here', 'paren)']) {
      expect((await resolve(bad)).kind, JSON.stringify(bad)).toBe('invalid')
    }
    expect(cfg.queries.length, 'a bad slug must cost no query').toBe(0)
  })

  it('trims and lowercases, so a pasted link still opens', async () => {
    expect((await resolve(`  ${SLUG.toUpperCase()}  `)).kind).toBe('album')
  })

  it('a missing album is not found', async () => {
    cfg.rows = []
    expect((await resolve()).kind).toBe('notfound')
  })

  it('RETIRED albums are excluded in the query itself', async () => {
    // An album past its retention window is queued for deletion and must not render while it
    // waits. Asserted on the filter, because the row the mock returns looks the same either way.
    await resolve()
    const lookup = cfg.queries[0]
    expect(lookup.filters).toContainEqual(['retired_at', null])
  })

  it('BOTH candidate rows are fetched, or a collision cannot be resolved at all', async () => {
    // slug and custom_slug are separately unique, so at most two albums can match one string.
    // Ask for one and PostgREST picks; the resolver below then has nothing to choose from and the
    // owner of whichever album lost sees a stranger's album under their own URL.
    await resolve()
    expect(cfg.queries[0]?.limit, 'both candidates must be fetched').toBeGreaterThanOrEqual(2)
  })

  it('a slug COLLISION resolves to the album whose random slug matches', async () => {
    // slug and custom_slug are separately unique, so one string can match two albums. Picking the
    // wrong one renders a stranger's album under this URL.
    const other = { ...ALBUM, id: OTHER_ID, slug: 'zzzz9999', custom_slug: SLUG }
    cfg.rows = [other, { ...ALBUM }]
    const res = await resolve()
    expect(res.kind).toBe('album')
    if (res.kind === 'album') expect(res.album.id).toBe(ALBUM_ID)
  })
})

describe('the gate, on the page itself', () => {
  it('a SEALED album renders its countdown, not its contents', async () => {
    cfg.rows = [{ ...ALBUM, reveal_at: new Date(Date.now() + 86_400_000).toISOString() }]
    const res = await resolve()
    expect(res.kind).toBe('reveal')
  })

  it('a PASSWORD-PROTECTED album shows a stranger the prompt and nothing else', async () => {
    cfg.rows = [{ ...ALBUM, password_hash: await hashPassword('secret-pass') }]
    const res = await resolve()
    expect(res.kind).toBe('password')
    // The prompt needs the title to say which album is being unlocked -- and nothing else.
    if (res.kind === 'password') {
      expect(res.title).toBe('A wedding')
      expect(Object.keys(res).sort()).toEqual(['kind', 'slug', 'title'])
    }
  })

  it('renders for a guest who actually unlocked it', async () => {
    const hash = await hashPassword('secret-pass')
    cfg.rows = [{ ...ALBUM, password_hash: hash }]
    cfg.cookies[`hushare_pw_${ALBUM_ID}`] = await deriveAccessToken(hash, ALBUM_ID)
    expect((await resolve()).kind).toBe('album')
  })

  it("REFUSES a token minted for a DIFFERENT album", async () => {
    const hash = await hashPassword('secret-pass')
    cfg.rows = [{ ...ALBUM, password_hash: hash }]
    cfg.cookies[`hushare_pw_${ALBUM_ID}`] = await deriveAccessToken(hash, OTHER_ID)
    expect((await resolve()).kind).toBe('password')
  })

  it('THE OWNER COOKIE LIFTS BOTH GATES on the server render', async () => {
    // The #owner= token lives in the URL fragment, which no server receives -- but the owner COOKIE
    // is sent on the page request. Before this, the resolve said "password gate" while the photo
    // read in the same file said "here are the photos", and an owner watched their own album tell
    // them it was protected.
    cfg.rows = [{ ...ALBUM, password_hash: await hashPassword('secret-pass'), reveal_at: new Date(Date.now() + 86_400_000).toISOString() }]
    cfg.cookies[`hushare_owner_${ALBUM_ID}`] = OWNER_TOKEN
    expect((await resolve()).kind).toBe('album')
  })

  it('a WRONG owner token does not, and neither does a PREFIX', async () => {
    cfg.rows = [{ ...ALBUM, password_hash: await hashPassword('secret-pass') }]
    for (const guess of ['nope', OWNER_TOKEN.slice(0, 1), OWNER_TOKEN.slice(0, -1), `${OWNER_TOKEN}x`]) {
      cfg.cookies[`hushare_owner_${ALBUM_ID}`] = guess
      expect((await resolve()).kind, `"${guess}"`).toBe('password')
    }
  })

  it('the owner cookie is read under a name carrying THIS album id', async () => {
    cfg.rows = [{ ...ALBUM, password_hash: await hashPassword('secret-pass') }]
    cfg.cookies[`hushare_owner_${OTHER_ID}`] = OWNER_TOKEN
    expect((await resolve()).kind, "another album's cookie must not open this one").toBe('password')
  })

  it('the ownership lookup is skipped entirely on an open album in guest view', async () => {
    // It is a second database round trip per page load, and on an ungated album the answer cannot
    // change what renders. Only an owner-MODE request or a gate that ownership would lift pays it.
    cfg.cookies[`hushare_owner_${ALBUM_ID}`] = OWNER_TOKEN
    await resolve(SLUG, false)
    expect(cfg.queries.filter((q) => q.select === 'owner_token').length, 'no owner lookup on an open album').toBe(0)
    cfg.queries = []
    await resolve(SLUG, true)
    const lookups = cfg.queries.filter((q) => q.select === 'owner_token')
    expect(lookups.length, 'owner mode pays for it').toBe(1)
    // ...and it asks about THIS album. Unfiltered, it compares the visitor's cookie against
    // whichever album PostgREST returns first, which is somebody else's token.
    expect(lookups[0].filters, 'the owner lookup must be scoped to this album').toContainEqual(['id', ALBUM_ID])
  })
})

describe('what the browser is handed', () => {
  const album = async () => {
    const res = await resolve()
    expect(res.kind).toBe('album')
    if (res.kind !== 'album') throw new Error('not an album')
    return res.album as unknown as Record<string, unknown>
  }

  it('THE PASSWORD HASH NEVER LEAVES THE SERVER', async () => {
    // This object is serialised into the page. A hash in it is an offline attack on the album's
    // password, handed to everyone who opens the URL.
    cfg.rows = [{ ...ALBUM, password_hash: await hashPassword('secret-pass') }]
    cfg.cookies[`hushare_owner_${ALBUM_ID}`] = OWNER_TOKEN
    const a = await album()
    expect(a).not.toHaveProperty('password_hash')
    expect(JSON.stringify(a), 'not under any other name either').not.toContain('pbkdf2')
    expect(a.password_protected, 'the page still needs to know there IS one').toBe(true)
  })

  it('and says so truthfully when there is none', async () => {
    expect((await album()).password_protected).toBe(false)
  })
})

describe('a paid mark stops being published when the plan lapses', () => {
  // hide_branding was gated only at write time and never looked at again: subscribe for one month
  // at the intro price, remove the Hushare mark from every album, cancel, and it stayed gone
  // forever. Same for the album logo and the sponsor marks. These re-checks are the fix, and they
  // are what tests/gate-direction could only assert by reading the source.
  const guestSees = async () => {
    const res = await resolve()
    if (res.kind !== 'album') throw new Error(`expected an album, got ${res.kind}`)
    return res.album as unknown as Record<string, unknown>
  }

  it('a FREE album publishes none of them', async () => {
    cfg.tier = 'free'
    const a = await guestSees()
    expect(a.hide_branding, 'the Hushare mark comes back').toBe(false)
    expect(a.logo_url, "the owner's logo is not published").toBeNull()
    expect(a.sponsor_logos).toEqual([])
    expect(a.face_finder_enabled, 'a button that always fails is worse than none').toBe(false)
    expect(a.bib_search_enabled).toBe(false)
  })

  it('a PRO album gets the Pro ones and not the Max ones', async () => {
    cfg.tier = 'pro'
    const a = await guestSees()
    expect(a.hide_branding).toBe(true)
    expect(a.logo_url).toBe('https://cdn.test/logo.png')
    expect(a.sponsor_logos, 'sponsor marks are Max').toEqual([])
    expect(a.face_finder_enabled).toBe(false)
    expect(a.bib_search_enabled).toBe(false)
  })

  it('a MAX album gets all of them', async () => {
    cfg.tier = 'studio'
    const a = await guestSees()
    expect(a.hide_branding).toBe(true)
    expect(a.face_finder_enabled).toBe(true)
    expect(a.bib_search_enabled).toBe(true)
    expect(Array.isArray(a.sponsor_logos) && (a.sponsor_logos as unknown[]).length).toBe(1)
  })

  it('A PACKAGE unmasks them on a FREE account, because the ALBUM is what is entitled', async () => {
    // The package's core buyer is a free account. Keying these on the owner's subscription showed
    // a paid Max Package album no Face Finder button while the search itself worked.
    cfg.tier = 'free'
    cfg.rows = [{ ...ALBUM, package_tier: 'studio', package_expires_at: new Date(Date.now() + 86_400_000).toISOString() }]
    const a = await guestSees()
    expect(a.plan).toBe('studio')
    expect(a.face_finder_enabled).toBe(true)
    expect(a.bib_search_enabled).toBe(true)
    expect(a.hide_branding).toBe(true)
  })

  it('an EXPIRED package does not', async () => {
    cfg.tier = 'free'
    cfg.rows = [{ ...ALBUM, package_tier: 'studio', package_expires_at: new Date(Date.now() - 86_400_000).toISOString() }]
    const a = await guestSees()
    expect(a.plan).toBe('free')
    expect(a.face_finder_enabled).toBe(false)
  })

  it('a COLLABORATION album cannot hide the mark, whatever its plan says', async () => {
    // branding_locked is the deal: free Max in exchange for carrying our name. A stored true from
    // before the lock must not go on taking effect.
    cfg.tier = 'studio'
    cfg.rows = [{ ...ALBUM, branding_locked: true }]
    expect((await guestSees()).hide_branding).toBe(false)
  })

  it('a PROMO-ERA album keeps the marks it was invited to set', async () => {
    // Before 2026-08-25 every one of these was free -- an actual promotion. Masking those is not
    // enforcing a price, it is withdrawing something somebody already has.
    cfg.tier = 'free'
    cfg.rows = [{ ...ALBUM, created_at: '2026-08-01T00:00:00.000Z' }]
    const a = await guestSees()
    expect(a.logo_url).toBe('https://cdn.test/logo.png')
    expect(Array.isArray(a.sponsor_logos) && (a.sponsor_logos as unknown[]).length).toBe(1)
  })

  it('but the OWNER always sees their own marks, even on a lapsed plan', async () => {
    // The mark must stop being PUBLISHED -- that is the leak. Masking it for the owner too would
    // show an empty slot in the Designer on a file we still hold, which reads as "Hushare deleted
    // my logo". Nothing here un-hides anything from guests.
    cfg.tier = 'free'
    cfg.cookies[`hushare_owner_${ALBUM_ID}`] = OWNER_TOKEN
    const res = await resolve(SLUG, true)
    if (res.kind !== 'album') throw new Error('expected an album')
    const a = res.album as unknown as Record<string, unknown>
    expect(a.logo_url).toBe('https://cdn.test/logo.png')
    expect(Array.isArray(a.sponsor_logos) && (a.sponsor_logos as unknown[]).length).toBe(1)
  })

  it('the UPLOAD CAPS follow the album too, so a packaged album can upload what it was sold', async () => {
    // media_caps is what the uploader shows and what the presign path enforces. Sized from the
    // owner's account, a Max Package album on a free account is told it may upload free-tier files
    // -- on the one feature the package exists to sell.
    cfg.tier = 'free'
    cfg.rows = [{ ...ALBUM, package_tier: 'studio', package_expires_at: new Date(Date.now() + 86_400_000).toISOString() }]
    const packaged = (await guestSees()).media_caps as { image: number; video: number }
    cfg.rows = [{ ...ALBUM }]
    const plain = (await guestSees()).media_caps as { image: number; video: number }
    expect(packaged.video, 'the package raises the video cap').toBeGreaterThan(plain.video)
  })

  it('collections stay ACCOUNT-scoped, so a package does not unlock them', async () => {
    // A collection groups albums across an account, so a single-album package must not open it --
    // `plan` above would say it does, and the collections API would then refuse the control.
    cfg.tier = 'free'
    cfg.rows = [{ ...ALBUM, package_tier: 'studio', package_expires_at: new Date(Date.now() + 86_400_000).toISOString() }]
    const a = await guestSees()
    expect(a.plan, 'the album is Max').toBe('studio')
    expect(a.collections_enabled, 'the account is not').toBe(false)
  })
})
