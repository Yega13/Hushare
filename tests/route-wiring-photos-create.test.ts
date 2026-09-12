import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UPLOADS_DISABLED } from '@/lib/album-entitlements'

// THE ROUTE THAT WRITES EVERY PHOTO ROW, EXECUTED BY A TEST FOR THE FIRST TIME.
//
// WHY IT EXISTS. /api/album/photos/create is 592 lines and nothing ran a single one of them. Grep
// found eight test files that mention it and every one reads it as TEXT: stream-token.test.ts does
// `read('app/api/album/photos/create/route.ts')` and matches regexes against the source (its own
// comment says "weaker than a behavioural one and it is deliberate"), album-entitlements.test.ts
// asserts the file CONTAINS `albumFullRefusal(`, gate-direction.test.ts lists the path, and
// architecture.test.ts only gives it a size budget. No test imports it. No test calls POST.
//
// So the refusal ladder on the only route that turns uploaded bytes into rows -- the 404, the
// uploads-disabled 403, the contribution gate, both rate limits and the album-full 403 -- was held
// by nothing but the reading of it. A regex proves a call is WRITTEN somewhere in the file. It
// cannot prove the call is reached, that its answer is used, or that nothing is written when it
// refuses. That gap is MISTAKES entry 10, five times over, and it is why this file exists.
//
// SCOPE, ENFORCED BY REVIEW -- do not grow this file.
//
// Deliberately the IMAGE (r2) path only. The Stream path claims tokens out of pending_stream_uploads
// through three more query shapes, and mocking those would make the fixture bigger than the thing it
// tests. This file asserts only:
//   1. each guard REFUSES with the status the product promises,
//   2. a refusal's own words are handed back unchanged (the gate's, the cap's),
//   3. NOTHING IS WRITTEN on any refusal -- the assertion a regex can never make,
//   4. the guards run in the order that makes the cheap ones protect the expensive ones.
// It asserts nothing that tests/album-entitlements.test.ts or tests/photo-input.test.ts already own.

const HOST = 'cdn.hushare.space'
const ALBUM_ID = '11111111-2222-3333-4444-555555555555'

/** Every upsert that reached the database. Empty is the assertion that matters on a refusal. */
const upserts: Array<{ rows: unknown[]; opts: unknown }> = []
/** Every gateAllowsContribution call, so "was it asked, and with what" is observable. */
const gateCalls: unknown[][] = []
/** Every rate-limit key asked for, in order. */
const rateLimitKeys: string[] = []
/** Did the albums row get looked up at all? Proves the cheap guards run first. */
let albumLookups = 0

type Refusal = { ok: false; error: string; reason: string }
const cfg: {
  album: Record<string, unknown> | null
  albumError: { message: string } | null
  count: number
  countError: { message: string } | null
  ipRlOk: boolean
  albumRlOk: boolean
  gate: { ok: true } | Refusal
} = {
  album: null, albumError: null, count: 0, countError: null,
  ipRlOk: true, albumRlOk: true, gate: { ok: true },
}

// The I/O boundary, and only the I/O boundary. vitest.config.mts warns that mocking a database
// "would assert that the mocks behave, not that the system does" -- here the mocks ARE the boundary
// and the thing executing is the route's own decision chain, which is what had no test.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'albums') {
        albumLookups++
        const b: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'is', 'not', 'in', 'order', 'limit']) b[m] = () => b
        b.maybeSingle = async () => ({ data: cfg.album, error: cfg.albumError })
        return b
      }
      // `photos` serves two different queries: the head count, and the upsert. Which one it is
      // depends on how it was built, exactly as it does in the route.
      let mode: 'count' | 'upsert' | 'plain' = 'plain'
      const b: Record<string, unknown> = {}
      for (const m of ['eq', 'is', 'not', 'in', 'order', 'limit', 'update']) b[m] = () => b
      b.select = (_cols?: unknown, opts?: { head?: boolean }) => {
        if (opts?.head) mode = 'count'
        return b
      }
      b.upsert = (rows: unknown[], opts: unknown) => {
        mode = 'upsert'
        upserts.push({ rows, opts })
        return b
      }
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        const rows = upserts.at(-1)?.rows ?? []
        const result = mode === 'count'
          ? { data: null, count: cfg.count, error: cfg.countError }
          : mode === 'upsert'
            ? { data: rows.map((_, i) => ({ id: `row-${i}` })), error: null }
            : { data: [], error: null }
        return Promise.resolve(result).then(res, rej)
      }
      return b
    },
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (key: string) => {
    rateLimitKeys.push(key)
    const ok = key.startsWith('photos_create_album') ? cfg.albumRlOk : cfg.ipRlOk
    return ok ? { ok: true } : { ok: false, retryAfterSeconds: 60 }
  },
  clientIpKey: (_req: unknown, prefix: string) => `${prefix}:test`,
}))

vi.mock('@/lib/server/album-access', () => ({
  gateAllowsContribution: async (...args: unknown[]) => {
    gateCalls.push(args)
    return cfg.gate
  },
}))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/report-server-error', () => ({ reportServerError: () => {} }))
vi.mock('@/lib/analytics', () => ({ track: () => {} }))
vi.mock('@/lib/email', () => ({ sendPhotoNotificationEmail: async () => {} }))
vi.mock('@/lib/server/bib-index', () => ({ queueBibIndex: () => {} }))
vi.mock('@/lib/cloudflare/stream', () => ({ streamVideoUrls: () => ({}) }))
vi.mock('@/lib/broadcast', () => ({
  queueAlbumChangedBroadcast: () => {},
  runAfterResponse: () => {},
}))

const { POST } = await import('@/app/api/album/photos/create/route')

/** A photo the validator accepts, so a refusal in a test can only have come from the rung under test. */
const photo = (n = 1) => ({
  storage_backend: 'r2',
  media_type: 'image',
  storage_path: `albums/${ALBUM_ID}/photo-${n}.jpg`,
  url: `https://${HOST}/albums/${ALBUM_ID}/photo-${n}.jpg`,
  thumb_url: `https://${HOST}/thumbs/${ALBUM_ID}/photo-${n}.jpg`,
  width: 1200,
  height: 800,
})

const albumRow = (over: Record<string, unknown> = {}) => ({
  id: ALBUM_ID,
  user_id: null,
  guest_uploads_enabled: true,
  require_approval: false,
  title: 'An album',
  slug: 'an-album',
  owner_token: 'owner-token-value',
  password_hash: null,
  reveal_at: null,
  created_at: '2026-09-01T00:00:00.000Z',
  media_cap_override: null,
  package_tier: null,
  package_expires_at: null,
  ...over,
})

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://hushare.space/api/album/photos/create', {
    method: 'POST',
    // The real forbidCrossSiteRequest runs, so an Origin is required: this also proves the CSRF
    // guard is still in front of everything below it.
    headers: { 'Content-Type': 'application/json', Origin: 'https://hushare.space', ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  process.env.R2_PUBLIC_HOST = HOST
  upserts.length = 0
  gateCalls.length = 0
  rateLimitKeys.length = 0
  albumLookups = 0
  cfg.album = albumRow()
  cfg.albumError = null
  cfg.count = 0
  cfg.countError = null
  cfg.ipRlOk = true
  cfg.albumRlOk = true
  cfg.gate = { ok: true }
})

describe('photos/create -- the refusal ladder, executed', () => {
  it('writes the rows when every guard passes (the control: a green path exists)', async () => {
    const res = await POST(post({ albumId: ALBUM_ID, photos: [photo(1)] }))
    expect(res.status).toBe(200)
    expect(upserts, 'one upsert of one row').toHaveLength(1)
    expect((upserts[0].rows as unknown[]).length).toBe(1)
    expect(await res.json()).toMatchObject({ inserted: 1 })
  })

  it('a cross-site POST is refused before anything is looked up or written', async () => {
    // No Origin header at all. The status belongs to forbidCrossSiteRequest, so it is not asserted
    // here -- what this pins is that the guard is IN FRONT: no album lookup, no rows.
    const res = await POST(new Request('https://hushare.space/api/album/photos/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ albumId: ALBUM_ID, photos: [photo()] }),
    }))
    expect(res.ok, 'a request with no Origin was accepted').toBe(false)
    expect(albumLookups, 'the album was looked up before the CSRF check').toBe(0)
    expect(upserts).toHaveLength(0)
  })

  it('the per-IP limit refuses with 429 and Retry-After, and never reaches the album', async () => {
    cfg.ipRlOk = false
    const res = await POST(post({ albumId: ALBUM_ID, photos: [photo()] }))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(albumLookups, 'a throttled request still cost an album lookup').toBe(0)
    expect(upserts).toHaveLength(0)
  })

  it('refuses a malformed body before touching the database', async () => {
    for (const body of [
      { albumId: 'not-a-uuid', photos: [photo()] },
      { albumId: ALBUM_ID, photos: [] },
      { albumId: ALBUM_ID, photos: 'nope' },
      { albumId: ALBUM_ID, photos: Array.from({ length: 201 }, () => photo()) },
    ]) {
      const res = await POST(post(body))
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400)
    }
    expect(albumLookups).toBe(0)
    expect(upserts).toHaveLength(0)
  })

  it('a photo that fails validation refuses the WHOLE call -- no partial write', async () => {
    // The second row points its thumb_url at another album's file: the attack photo-input.ts
    // documents. One bad row must take the batch down, not be skipped while the rest are written.
    const bad = { ...photo(2), thumb_url: `https://${HOST}/albums/${ALBUM_ID}/victim.jpg` }
    const res = await POST(post({ albumId: ALBUM_ID, photos: [photo(1), bad] }))
    expect(res.status).toBe(400)
    expect(upserts, 'the valid row in the same batch was written anyway').toHaveLength(0)
  })

  it('an album that does not exist (or was retired) is a 404, and writes nothing', async () => {
    cfg.album = null
    const res = await POST(post({ albumId: ALBUM_ID, photos: [photo()] }))
    expect(res.status).toBe(404)
    expect(upserts).toHaveLength(0)
  })

  it('an album with guest uploads switched off is a 403 carrying the shared refusal, and writes nothing', async () => {
    cfg.album = albumRow({ guest_uploads_enabled: false })
    const res = await POST(post({ albumId: ALBUM_ID, photos: [photo()] }))
    expect(res.status).toBe(403)
    // THE BODY, not just the status. A source scan proves the constant appears somewhere in the
    // door; it cannot prove THIS branch sends it. Swapping this refusal with the adjacent 404 left
    // every status assertion green while a switched-off album answered "Album not found" -- the
    // fault row the constant exists to prevent, restored with the suite passing.
    expect(await res.json()).toEqual({ error: UPLOADS_DISABLED })
    expect(upserts).toHaveLength(0)
  })

  it('THE CONTRIBUTION GATE IS ASKED, AND ITS REFUSAL IS USED WORD FOR WORD', async () => {
    // The gate being advisory here is the defect the route's own comment describes: knowing an
    // album's internal id was enough to POST fabricated rows past a password that was set
    // specifically to revoke someone. This asserts it is asked, asked about THIS album, and that
    // its answer is what the guest reads.
    cfg.gate = { ok: false, error: 'Enter the album password before adding photos', reason: 'password-cookie-absent' }
    const res = await POST(post({ albumId: ALBUM_ID, photos: [photo()] }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Enter the album password before adding photos' })
    expect(gateCalls, 'the gate was never asked').toHaveLength(1)
    expect((gateCalls[0][0] as { id: string }).id, 'the gate was asked about a different album').toBe(ALBUM_ID)
    expect(upserts).toHaveLength(0)
  })

  it('the per-album limit refuses with 429 AFTER the gate, so a locked album cannot be probed by it', async () => {
    cfg.albumRlOk = false
    const res = await POST(post({ albumId: ALBUM_ID, photos: [photo()] }))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(rateLimitKeys, 'both limits ran, IP first').toEqual([
      'photos_create_ip:test',
      `photos_create_album:${ALBUM_ID}`,
    ])
    expect(gateCalls, 'the album limit was checked before the gate').toHaveLength(1)
    expect(upserts).toHaveLength(0)
  })

  it('a FULL album is refused with 403 and the shared words, and writes nothing', async () => {
    // An override cap, so this exercises the refusal without a subscriptions lookup: albumCap
    // returns before reading the tier on an override, which is what capDependsOnTier encodes.
    cfg.album = albumRow({ media_cap_override: 5 })
    cfg.count = 5
    const res = await POST(post({ albumId: ALBUM_ID, photos: [photo()] }))
    expect(res.status).toBe(403)
    // The words themselves belong to tests/album-entitlements.test.ts. What this pins is that the
    // route hands back albumFullRefusal's shape rather than a message of its own.
    expect(await res.json()).toMatchObject({ code: 'album_full' })
    expect(upserts).toHaveLength(0)
  })

  it('one photo below the cap still goes in -- the cap refuses AT the ceiling, not before it', async () => {
    cfg.album = albumRow({ media_cap_override: 5 })
    cfg.count = 4
    const res = await POST(post({ albumId: ALBUM_ID, photos: [photo()] }))
    expect(res.status).toBe(200)
    expect(upserts).toHaveLength(1)
  })

  it('A FAILED COUNT ALLOWS THE UPLOAD, deliberately -- a database blip must not block an event', async () => {
    // Rule 19, stated in the route: this cap bounds cost, and refusing every guest at a live event
    // is the far larger harm. The uncertain branch allows, and the test says so out loud.
    cfg.album = albumRow({ media_cap_override: 1 })
    cfg.count = 0
    cfg.countError = { message: 'connection reset' }
    const res = await POST(post({ albumId: ALBUM_ID, photos: [photo()] }))
    expect(res.status).toBe(200)
    expect(upserts, 'the upload was refused on a count the route could not read').toHaveLength(1)
  })
})
