import { describe, it, expect, vi, beforeEach } from 'vitest'

// THE AUTHORIZATION CHAIN FOR 98.5% OF ALL MEDIA, which had no test at all.
//
// Every photo any guest uploads passes through here, by both routes: /api/upload/presign (the
// normal direct-to-R2 path) and /api/upload/image-relay (the fallback for networks that block R2).
// It carries the same password/reveal gate, the same per-tier size cap and the same per-album
// ceiling as the video path — and while the video path was extracted and tested this week, this one
// sat uncovered through two full rounds of adversarial review.
//
// The reason nobody noticed is worth recording: tests/architecture.test.ts walked `src/lib` with
// `readdirSync(...).filter(f => f.endsWith('.ts'))`, and directories do not end in .ts — so
// everything under src/lib/server was exempt from "a new module arrives with its tests" without
// anyone deciding that. The rule that would have flagged this module could not see the folder it
// lives in. The walk was fixed first; this is the debt it exposed being paid.
//
// The database, cookies, rate limiter and tier lookup are mocked at the module boundary. The
// ordering of the checks, the caps, the status codes and the returned image cap are real.

const cfg: {
  album: Record<string, unknown> | null
  albumError: boolean
  photoCount: number
  countError: boolean
  gateOk: boolean
  ipRlOk: boolean
  albumRlOk: boolean
  tier: string
  tierThrows: boolean
  /** What getUserTierResolved answers about its own confidence. False = the subscriptions query failed. */
  tierAuthoritative: boolean
  reports: Array<{ message: string }>
  rateLimitCalls: unknown[][]
  /** What the album lookup was actually filtered on, as `eq:col` / `is:col`. */
  albumFilters: Record<string, unknown>
  /** The album row signedInUserForGate was asked about, once per call. */
  signedInLookups: unknown[]
  /** What the signed-in lookup answers. A real id, so dropping it is visible. */
  signedInUserId: string | null
  gateCalls: Array<{ albumId: string | undefined; signedInUserId: string | null | undefined }>
} = {
  album: null, albumError: false, photoCount: 0, countError: false,
  gateOk: true, ipRlOk: true, albumRlOk: true, tier: 'free', tierThrows: false, tierAuthoritative: true, reports: [],
  rateLimitCalls: [],
  albumFilters: {}, signedInLookups: [], signedInUserId: 'signed-in-account-id', gateCalls: [],
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'albums') {
        // RECORDS ITS FILTERS. Ignoring them meant `.is('retired_at', null)` could become
        // `.is('deleted_at', null)` — a column that does not exist on this table — and every test
        // still passed, while a retired album (retention expired, data queued for deletion) went on
        // accepting uploads into storage nobody is paying for any more.
        return {
          select: () => ({
            eq: (col: string, val: unknown) => {
              cfg.albumFilters[`eq:${col}`] = val
              return {
                is: (col2: string, val2: unknown) => {
                  cfg.albumFilters[`is:${col2}`] = val2
                  return {
                    maybeSingle: async () =>
                      (cfg.albumError ? { data: null, error: { message: 'boom' } } : { data: cfg.album, error: null }),
                  }
                },
              }
            },
          }),
        }
      }
      // photos — the count that sizes the per-album presign budget.
      return {
        select: () => ({
          eq: async () => (cfg.countError
            ? { count: null, error: { message: 'boom' } }
            : { count: cfg.photoCount, error: null }),
        }),
      }
    },
  }),
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/rate-limit', () => ({
  // Records its arguments. The video module's equivalent mock ignored them, and a mutation moving
  // the key, window, ceiling and fail direction all at once survived every test.
  checkRateLimit: async (key: string, ...rest: unknown[]) => {
    cfg.rateLimitCalls.push([key, ...rest])
    const ok = key.startsWith('presign_album') ? cfg.albumRlOk : cfg.ipRlOk
    return ok ? { ok: true } : { ok: false, retryAfterSeconds: 60 }
  },
  clientIpKey: (_req: unknown, prefix: string) => `${prefix}:test`,
}))
vi.mock('@/lib/subscriptions', () => ({
  getUserTierById: async () => {
    if (cfg.tierThrows) throw new Error('tier lookup down')
    return cfg.tier
  },
  // The authorizer asks for the tier AND whether it is known. What the real function answers when a
  // query fails is proven in tests/subscriptions.test.ts; this only scripts the two answers.
  getUserTierResolved: async () => {
    if (cfg.tierThrows) throw new Error('tier lookup down')
    return { tier: cfg.tier, authoritative: cfg.tierAuthoritative }
  },
}))
vi.mock('@/lib/server/album-access', async (orig) => {
  const actual = await orig() as Record<string, unknown>
  return {
    ...actual,
    // BOTH RECORD. signedInUserForGate used to answer `null` here, which is the value the gate
    // assumes anyway — so deleting the lookup, or dropping the third argument to the gate, changed
    // nothing any test could see. That argument is the fix for the customer who set a password from
    // another tab and had her next 163 uploads refused on her own album (rule 25). Answering a
    // distinctive id makes its absence visible.
    gateAllowsContribution: async (album: { id: string }, _cookies: unknown, signedInUserId?: string | null) => {
      cfg.gateCalls.push({ albumId: album?.id, signedInUserId })
      return cfg.gateOk ? { ok: true } : { ok: false, error: 'Enter the album password before adding photos' }
    },
    signedInUserForGate: async (album: unknown) => {
      cfg.signedInLookups.push(album)
      return cfg.signedInUserId
    },
  }
})
vi.mock('@/lib/report-server-error', () => ({
  reportServerError: (_source: string, message: string) => { cfg.reports.push({ message }) },
}))

import { authorizeImageUpload, deriveImageKey } from '@/lib/server/image-upload-authorization'
import { uploadCapsForTier } from '@/lib/media'
import { albumCap, albumFullRefusal } from '@/lib/album-entitlements'

const ALBUM_ID = '11111111-2222-3333-4444-555555555555'
const OK_ALBUM = {
  id: ALBUM_ID, user_id: null, guest_uploads_enabled: true,
  media_cap_override: null, created_at: '2026-09-01T00:00:00.000Z',
  package_tier: null, package_expires_at: null,
  owner_token: 'tok', password_hash: null, reveal_at: null,
}

const req = new Request('https://hushare.space/api/upload/presign', { method: 'POST' })
const params = (over: Partial<{ contentType: string; fileSize: number | null }> = {}) => ({
  albumId: ALBUM_ID,
  contentType: 'image/jpeg',
  fileSize: 2 * 1024 * 1024,
  ...over,
})

beforeEach(() => {
  cfg.album = { ...OK_ALBUM }
  cfg.albumError = false
  cfg.photoCount = 0
  cfg.countError = false
  cfg.gateOk = true
  cfg.ipRlOk = true
  cfg.albumRlOk = true
  cfg.tier = 'free'
  cfg.tierThrows = false
  cfg.tierAuthoritative = true
  cfg.reports = []
  cfg.rateLimitCalls = []
  cfg.albumFilters = {}
  cfg.signedInLookups = []
  cfg.signedInUserId = 'signed-in-account-id'
  cfg.gateCalls = []
})

describe('an ordinary guest photo is allowed', () => {
  it('approves it and reports the cap it was judged against', async () => {
    const res = await authorizeImageUpload(req, params())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // The relay needs this number: with no Content-Length it cannot check the size before reading,
    // so it clamps the buffered body to exactly this. Re-deriving it there would be a second copy
    // of the album's cap (rule 13).
    expect(res.imageCap).toBe(uploadCapsForTier('free').image)
  })
})

describe('the gate applies to contributing, not just viewing', () => {
  it('refuses when the album password or reveal gate says no', async () => {
    // Knowing the album id must never be enough. This is the check whose absence on photos/create
    // once made the gate advisory.
    cfg.gateOk = false
    const res = await authorizeImageUpload(req, params())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(403)
  })

  it('refuses when guest uploads are switched off', async () => {
    cfg.album = { ...OK_ALBUM, guest_uploads_enabled: false }
    const res = await authorizeImageUpload(req, params())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(403)
  })

  it('404s a missing or retired album', async () => {
    cfg.album = null
    const res = await authorizeImageUpload(req, params())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(404)
  })
})

describe('what may be uploaded', () => {
  it('refuses a type that is not an allowed image', async () => {
    // The stored-XSS boundary: svg and html must never reach R2 with an executable type.
    for (const bad of ['image/svg+xml', 'text/html', 'application/xhtml+xml', 'video/mp4']) {
      const res = await authorizeImageUpload(req, params({ contentType: bad }))
      expect(res.ok, bad).toBe(false)
      if (!res.ok) expect(res.response.status, bad).toBe(415)
    }
  })

  it('accepts the formats a phone actually produces', async () => {
    for (const good of ['image/jpeg', 'image/png', 'image/webp', 'image/heic']) {
      expect((await authorizeImageUpload(req, params({ contentType: good }))).ok, good).toBe(true)
    }
  })

  it('refuses a file above the absolute ceiling, whatever the tier', async () => {
    // Studio has the highest image cap, so this is the only tier where the absolute ceiling can be
    // the binding check rather than the per-tier one.
    cfg.album = { ...OK_ALBUM, user_id: 'user-1' }
    cfg.tier = 'studio'
    const res = await authorizeImageUpload(req, params({ fileSize: uploadCapsForTier('studio').image + 1 }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(413)
  })

  it('the absolute ceiling is DERIVED from the highest tier, not typed again', async () => {
    // It was `200 * 1024 * 1024` with a comment calling it an independent safety net, while the
    // highest tier cap is also exactly 200 MB — so it could never bind, and deleting the whole
    // check changed no behaviour, which is how this was found (rule 13: one fact, two places,
    // agreeing by coincidence). Raise the tier cap and a typed ceiling silently starts refusing
    // uploads a paying customer was sold.
    //
    // Asserted through behaviour rather than by importing the constant: a studio album must accept
    // exactly its own cap, and refuse one byte more.
    cfg.album = { ...OK_ALBUM, user_id: 'user-1' }
    cfg.tier = 'studio'
    const atCap = await authorizeImageUpload(req, params({ fileSize: uploadCapsForTier('studio').image }))
    expect(atCap.ok, 'the highest tier must be able to upload exactly its own cap').toBe(true)
  })

  it('refuses an absurd size BEFORE it costs a database lookup', async () => {
    // The ceiling now equals the highest tier cap, so it can never refuse anything the per-tier
    // check would allow — deleting it changes no verdict. What it still does is refuse EARLY, which
    // the per-tier check cannot: that one runs after the album lookup and the subscription lookup.
    // A hostile multi-gigabyte declaration must not buy two queries per request.
    //
    // Asserted by making the album lookup fatal: if the size check ran first we get 413, and if the
    // album were consulted first we would get 404 instead.
    cfg.album = null
    const res = await authorizeImageUpload(req, params({ fileSize: 5 * 1024 * 1024 * 1024 }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status, 'size must be refused before the album is looked up').toBe(413)
  })

  it('refuses a file above THIS album tier cap', async () => {
    const res = await authorizeImageUpload(req, params({ fileSize: uploadCapsForTier('free').image + 1 }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(413)
  })

  it('lets an UNKNOWN size through — the caller clamps the real bytes', async () => {
    // fileSize null means Chrome on iOS sent no Content-Length. Refusing here would lose a
    // wedding's photos over a missing header; the relay bounds the actual body instead, using the
    // imageCap this returns.
    const res = await authorizeImageUpload(req, params({ fileSize: null }))
    expect(res.ok).toBe(true)
  })
})

describe('a package raises the album cap, not just the owner plan', () => {
  it('gives an anonymous album with a Max package the studio image cap', async () => {
    cfg.album = {
      ...OK_ALBUM,
      package_tier: 'studio',
      package_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    }
    const res = await authorizeImageUpload(req, params({ fileSize: uploadCapsForTier('free').image + 1 }))
    expect(res.ok, 'a Max Package album must accept what it was sold').toBe(true)
    if (!res.ok) return
    expect(res.imageCap).toBe(uploadCapsForTier('studio').image)
  })

  it('an EXPIRED package does not', async () => {
    cfg.album = {
      ...OK_ALBUM,
      package_tier: 'studio',
      package_expires_at: new Date(Date.now() - 86_400_000).toISOString(),
    }
    const res = await authorizeImageUpload(req, params({ fileSize: uploadCapsForTier('free').image + 1 }))
    expect(res.ok).toBe(false)
  })
})

describe('the limits that stop one album writing bytes nobody can find', () => {
  it('limits per IP and per ALBUM, both failing closed', async () => {
    // failOpen:false is deliberate on both. A limiter we cannot consult must REFUSE here: the
    // per-album budget is what bounds orphaned R2 writes, and an abuser never creates a photo row
    // — they take the slot, PUT the bytes and walk away, so no deletion path can ever find them.
    await authorizeImageUpload(req, params())
    const keys = cfg.rateLimitCalls.map(c => String(c[0]))
    expect(keys).toContain('presign_ip:test')
    // THE ALBUM ID IS THE LOAD-BEARING PART, and the first version of this asserted only the
    // PREFIX — so changing the key to a constant like 'presign_album:shared' passed. In production
    // that is one global hourly bucket for every album on the platform: one busy event, or one
    // abuser, starves image uploads for everybody. Exactly the pass-by-coincidence shape that has
    // already caught me twice.
    expect(keys).toContain(`presign_album:${ALBUM_ID}`)
    for (const call of cfg.rateLimitCalls) {
      expect(call[3], `${call[0]} must fail closed`).toEqual({ failOpen: false })
    }
  })

  it('sizes the per-album budget from THIS album, not from a constant', async () => {
    await authorizeImageUpload(req, params())
    // presignBudget's arguments were recorded by the mock and never read, so replacing them with a
    // flat 40000 survived — the module's own comment calls that "roughly a terabyte an hour of
    // permanent storage for anyone who knows one album id". The budget must move with the album's
    // remaining room, so an album that is nearly full cannot presign thousands more slots.
    //
    // Asserted as a RANGE rather than an exact number: the point is that it is derived, and pinning
    // the arithmetic here would re-implement presign-budget instead of testing it (rule 17).
    const albumCall = cfg.rateLimitCalls.find(c => String(c[0]).startsWith('presign_album:'))
    expect(albumCall, 'the per-album limiter must be consulted at all').toBeDefined()
    expect(albumCall?.[1], 'window is one hour').toBe(3600)
    expect(typeof albumCall?.[2]).toBe('number')
    expect(albumCall?.[2] as number).toBeGreaterThan(0)
    expect(albumCall?.[2] as number, 'a flat 40000 is the defect this exists to stop').toBeLessThan(40000)
  })

  it('429s a hammered IP, with a Retry-After', async () => {
    cfg.ipRlOk = false
    const res = await authorizeImageUpload(req, params())
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.response.status).toBe(429)
    expect(res.response.headers.get('Retry-After')).toBe('60')
  })

  it('429s a hammered ALBUM, WITH a Retry-After', async () => {
    // The IP refusal was checked for its Retry-After and this one was not, so dropping the header
    // here survived. A 429 with nothing to wait for is a client hammering the same refusal.
    cfg.albumRlOk = false
    const res = await authorizeImageUpload(req, params())
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.response.status).toBe(429)
    expect(res.response.headers.get('Retry-After'), 'a 429 must say how long to wait').toBe('60')
  })

  it('checks the IP limit BEFORE looking anything up', async () => {
    // Ordering matters: a hammered IP must be rejected without paying for an album lookup or a
    // subscription lookup on every request.
    cfg.ipRlOk = false
    cfg.album = null                       // would 404 if the album were consulted first
    const res = await authorizeImageUpload(req, params())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(429)
  })
})

describe('when something cannot be determined', () => {
  it('503s rather than guessing when the tier lookup is down', async () => {
    // Guessing 'free' would refuse a paying album's legitimate upload during an outage.
    cfg.album = { ...OK_ALBUM, user_id: 'user-1' }
    cfg.tierThrows = true
    const res = await authorizeImageUpload(req, params())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(503)
  })

  it('still authorizes when the photo COUNT cannot be read', async () => {
    // The count only sizes a rate-limit budget. Refusing every guest at a live event because one
    // count query failed is the worse error, and presign-budget errs open by design (rule 19).
    cfg.countError = true
    expect((await authorizeImageUpload(req, params())).ok).toBe(true)
  })
})

describe('the album it authorizes is the album it looked up', () => {
  it('filters on this album id AND on the album not being retired', async () => {
    // Both filters were invisible: the mock ignored its arguments, so `.is('retired_at', null)`
    // could name any column at all and every test still passed. A retired album is one whose
    // retention has run out and whose media is queued for deletion — it must not take new uploads,
    // and it must not be found here.
    await authorizeImageUpload(req, params())
    expect(cfg.albumFilters['eq:id']).toBe(ALBUM_ID)
    expect(cfg.albumFilters).toHaveProperty('is:retired_at')
    expect(cfg.albumFilters['is:retired_at']).toBeNull()
  })
})

describe('the signed-in owner is recognized on a device with no owner cookie', () => {
  it('asks who is signed in, about THIS album, and hands the answer to the gate', async () => {
    // The customer who lost 163 uploads: she set a password from another tab, so the tab she was
    // uploading from had no owner cookie, and the gate had no second way to recognise her. The
    // account is the stronger proof and it is passed as the gate's third argument.
    //
    // Until now this mock answered null — the same value the gate assumes when nobody asks — so
    // deleting the lookup, or dropping the argument, was invisible to all forty tests here.
    await authorizeImageUpload(req, params())
    expect(cfg.signedInLookups, 'the signed-in account must be looked up').toHaveLength(1)
    expect(cfg.signedInLookups[0]).toMatchObject({ id: ALBUM_ID })
    expect(cfg.gateCalls).toHaveLength(1)
    expect(cfg.gateCalls[0].signedInUserId, 'the gate must receive the account id').toBe('signed-in-account-id')
  })

  it('passes null through unchanged when nobody is signed in', async () => {
    // The null must reach the gate as null and not, say, as undefined-because-the-call-was-dropped.
    cfg.signedInUserId = null
    await authorizeImageUpload(req, params())
    expect(cfg.gateCalls[0].signedInUserId).toBeNull()
  })

  it('gates the album it was asked about', async () => {
    await authorizeImageUpload(req, params())
    expect(cfg.gateCalls[0].albumId).toBe(ALBUM_ID)
  })
})


// ── WHAT THE BUDGET IS SIZED FROM ────────────────────────────────────────────────────────────────
//
// Added 2026-09-10 after a mutation run. The test above proves the per-album budget is DERIVED
// rather than flat; it could not see what it is derived from. Four mutations survived it, and each
// one is a different way for an album to be handed a bigger hourly ceiling than it can ever fill --
// which is bytes in R2 that no database row will ever reference, no deletion path can find, and no
// audit can reconcile. The bill is permanent.

const albumBudget = async (album: Record<string, unknown>): Promise<number> => {
  cfg.album = { ...OK_ALBUM, ...album }
  cfg.rateLimitCalls = []
  await authorizeImageUpload(req, params())
  const call = cfg.rateLimitCalls.find((c) => String(c[0]).startsWith('presign_album:'))
  expect(call, 'the per-album limiter must be consulted').toBeDefined()
  return call?.[2] as number
}

describe('the per-album presign budget follows what THIS album could still legitimately hold', () => {
  it('an ANONYMOUS album is not sized as a free ACCOUNT', async () => {
    // The module's own comment records this as a shipped bug: getUserTierById(null) answers 'free'
    // rather than throwing, so passing the tier straight through told albumCap that an anonymous
    // album was a free-account album -- 500 items instead of 250, or 1,000 once the free
    // grandfathering applied. Every anonymous album alive predates that date, so it doubled the
    // hourly presign budget for all of them.
    cfg.tier = 'free'
    const anon = await albumBudget({ user_id: null })
    const registered = await albumBudget({ user_id: 'user-1' })
    expect(anon, 'a guest album holds fewer items, so it may presign fewer').toBeLessThan(registered)
  })

  it('a hand-set override raises it', async () => {
    const ordinary = await albumBudget({ user_id: 'user-1', media_cap_override: null })
    const lifted = await albumBudget({ user_id: 'user-1', media_cap_override: 9000 })
    expect(lifted, 'an album deliberately given more room may presign more').toBeGreaterThan(ordinary)
  })

  it('a GRANDFATHERED album is sized by the ceiling it was promised', async () => {
    // The budget and the hard block in photos/create must agree about the cap. They used to
    // disagree: this path read `override ?? tierCap` with no grandfathering at all, so an old
    // album's budget was computed from a smaller cap than the one enforced a moment later.
    cfg.tier = 'free'
    const today = await albumBudget({ user_id: 'user-1', created_at: '2026-09-01T00:00:00.000Z' })
    const old = await albumBudget({ user_id: 'user-1', created_at: '2026-07-01T00:00:00.000Z' })
    expect(old, 'an album promised 1,000 items may presign for 1,000').toBeGreaterThan(today)
  })

  it('a LIVE package raises it, and an expired one does not', async () => {
    const soon = new Date(Date.now() + 86_400_000).toISOString()
    const past = new Date(Date.now() - 86_400_000).toISOString()
    cfg.tier = 'free'
    const none = await albumBudget({ user_id: 'user-1' })
    const bought = await albumBudget({ user_id: 'user-1', package_tier: 'studio', package_expires_at: soon })
    const lapsed = await albumBudget({ user_id: 'user-1', package_tier: 'studio', package_expires_at: past })
    expect(bought, 'a Max Package album holds 10,000 items and must be able to fill them').toBeGreaterThan(none)
    expect(lapsed, 'an expired package buys nothing').toBe(none)
  })
})

describe('the content type is normalised before it is judged', () => {
  it('accepts what a phone actually sends, whatever its case', async () => {
    // A camera roll upload can arrive as image/JPEG or image/HEIC. Judging the raw string refuses
    // it as "File type not allowed" -- a guest at an event, with an ordinary photo, told no.
    for (const contentType of ['image/JPEG', 'IMAGE/PNG', 'Image/Heic']) {
      const res = await authorizeImageUpload(req, params({ contentType }))
      expect(res.ok, `${contentType} must be accepted`).toBe(true)
    }
  })
})

// ── THE STORAGE KEY ──────────────────────────────────────────────────────────────────────────────
//
// deriveImageKey had no test of any kind, and four mutations of it survived the whole suite. It is
// the entire cross-album-injection defence on this path: the key is server-generated, so there is
// nothing to allowlist because there is nothing client-controlled to allow. Take that away and a
// filename decides where in R2 the bytes land.

describe('deriveImageKey never lets the client choose where bytes go', () => {
  const ALBUM_B = '99999999-8888-7777-6666-555555555555'

  it('ignores the filename entirely, hostile or not', () => {
    // Distinctive stems, so "does the key contain any of this" is a real question rather than a
    // letter that happens to appear in the word "albums".
    const hostile = ['../../qzqz/wrecker.jpg', 'nested/deeper/marker.jpg', 'trailer.jpg?x=1', '.envfile']
    for (const fileName of hostile) {
      const { key } = deriveImageKey(ALBUM_ID, 'image/jpeg', fileName, false)
      expect(key.startsWith(`albums/${ALBUM_ID}/`), `${fileName} escaped its album`).toBe(true)
      for (const stem of ['qzqz', 'wrecker', 'nested', 'deeper', 'marker', 'trailer', 'envfile', '..']) {
        expect(key, `${stem} from the client name reached the key`).not.toContain(stem)
      }
      expect(key.split('/').length, 'exactly albums/<id>/<name>').toBe(3)
    }
  })

  it('scopes every key to the album it was called for', () => {
    const a = deriveImageKey(ALBUM_ID, 'image/jpeg', 'p.jpg', false).key
    const b = deriveImageKey(ALBUM_B, 'image/jpeg', 'p.jpg', false).key
    expect(a).toContain(ALBUM_ID)
    expect(b).toContain(ALBUM_B)
    expect(a, 'two albums must never share a prefix').not.toBe(b)
  })

  it('never repeats a key, so one upload cannot overwrite another', () => {
    const keys = new Set(Array.from({ length: 200 }, () => deriveImageKey(ALBUM_ID, 'image/jpeg', 'same.jpg', false).key))
    expect(keys.size, 'the same filename twice must not collide').toBe(200)
  })

  it('takes the extension from the MIME type, not from the name', () => {
    // The name is attacker-controlled and the type has already been checked against the allowed
    // list. Trusting the name puts .html or .svg into a bucket served over HTTP.
    expect(deriveImageKey(ALBUM_ID, 'image/jpeg', 'evil.svg', false).key.endsWith('.jpg')).toBe(true)
    expect(deriveImageKey(ALBUM_ID, 'image/png', 'evil.html', false).key.endsWith('.png')).toBe(true)
  })

  it('a thumbnail is always a JPEG, in its own prefix, whatever came in', () => {
    const { key, finalContentType } = deriveImageKey(ALBUM_ID, 'image/png', 'x.png', true)
    expect(key.startsWith(`thumbs/${ALBUM_ID}/`)).toBe(true)
    expect(key.endsWith('.jpg')).toBe(true)
    expect(finalContentType, 'the thumbnail pipeline writes JPEG; the stored type must say so').toBe('image/jpeg')
  })

  it('a full-size upload keeps its own type, normalised', () => {
    expect(deriveImageKey(ALBUM_ID, 'image/PNG', 'x.png', false).finalContentType).toBe('image/png')
  })
})

describe('a FULL album is refused as full, before it is handed a slot', () => {
  // 2026-09-07 and 2026-09-08: two owners filled their albums and kept uploading. Every photo after
  // that still got a slot here, put its bytes in R2, and was refused at photos/create -- an object no
  // row will ever reference. Once 300 of those had gone through, the budget refused the rest as
  // "Album upload rate limit reached", filed as an error, and the owner never saw the upgrade.
  type AlbumShape = { user_id: string | null; created_at: string; media_cap_override: number | null }
  const capInputOf = (a: AlbumShape) => ({
    ownerTier: a.user_id ? ('free' as const) : null,
    createdAt: a.created_at,
    override: a.media_cap_override,
    pkg: { tier: null, expiresAt: null },
  })
  const capOf = (a: AlbumShape) => albumCap(capInputOf(a)).cap
  const OWNED = { ...OK_ALBUM, user_id: 'owner-1' as string | null }

  it("at the cap: photos/create's own refusal, word for word, and the hourly budget is not touched", async () => {
    cfg.photoCount = capOf(OK_ALBUM)
    const res = await authorizeImageUpload(req, params())
    expect(res.ok).toBe(false)
    if (res.ok) return
    // 403, not 429: lib/upload-policy retries a 429, so a full album would cost four presigns, four
    // shared-IP limiter slots and four count(*) scans per photo. The video door made this call first.
    expect(res.response.status).toBe(403)
    expect(await res.response.json()).toEqual(albumFullRefusal(capInputOf(OK_ALBUM)))
    // Refused BEFORE the budget: a full album spending its allowance on refusals is how the
    // rate-limit error appeared in the first place.
    expect(cfg.rateLimitCalls.map((c) => c[0]), 'the per-album budget was consulted for a full album').not.toContain(`presign_album:${ALBUM_ID}`)
  })

  it('one below the cap is still allowed', async () => {
    cfg.photoCount = capOf(OK_ALBUM) - 1
    expect((await authorizeImageUpload(req, params())).ok).toBe(true)
  })

  it("an OWNED album is judged against its owner's cap, not the anonymous one", async () => {
    cfg.album = { ...OWNED }
    cfg.tier = 'free'
    expect(capOf(OWNED), 'the test needs the two caps to differ').not.toBe(capOf(OK_ALBUM))
    cfg.photoCount = capOf(OWNED) - 1
    expect((await authorizeImageUpload(req, params())).ok).toBe(true)
    cfg.photoCount = capOf(OWNED)
    const res = await authorizeImageUpload(req, params())
    expect(res.ok).toBe(false)
    if (!res.ok) expect((await res.response.json()).code).toBe('album_full')
  })

  it('a FAILED count refuses nothing as full (rule 19)', async () => {
    cfg.countError = true
    expect((await authorizeImageUpload(req, params())).ok).toBe(true)
  })

  it('a DEGRADED tier lookup does not enforce the cap: it allows, and says the cap stopped being enforced', async () => {
    // The real case (tests/subscriptions.test.ts): a failed subscriptions query answers 'free'
    // without saying so. Enforcing that guess told a Max owner their album was full at a twentieth
    // of what they bought. Allowing costs a bounded overshoot on an album that may be full; the
    // presign budget still bounds the bytes and photos/create still enforces a known cap.
    cfg.album = { ...OWNED }
    cfg.tier = 'free'
    cfg.tierAuthoritative = false
    cfg.photoCount = capOf(OWNED)
    expect((await authorizeImageUpload(req, params())).ok).toBe(true)
    expect(cfg.reports.map((r) => r.message)).toContain('Media cap NOT enforced — the tier lookup degraded')
  })

  it('and when the tier IS known, the same count is refused', async () => {
    cfg.album = { ...OWNED }
    cfg.tier = 'free'
    cfg.photoCount = capOf(OWNED)
    const res = await authorizeImageUpload(req, params())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(403)
    expect(cfg.reports, 'a refusal is not a cap that stopped being enforced').toEqual([])
  })

  it('an UNKNOWN tier is never called full at the free allowance: the 503, not album_full', async () => {
    cfg.album = { ...OWNED }
    cfg.tierThrows = true
    cfg.photoCount = capOf(OWNED)
    const res = await authorizeImageUpload(req, params())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(503)
  })
})
