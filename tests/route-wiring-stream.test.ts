import { describe, it, expect, vi, beforeEach } from 'vitest'

// THE WIRING BETWEEN A ROUTE AND ITS AUTHORIZATION MODULE — the repo's first route test, and
// deliberately the narrowest thing that could have caught what went wrong.
//
// WHY IT EXISTS. Extracting the video guard chain into lib/server/video-upload-authorization made
// the DECISION testable and left the two lines that call it covered by nothing. Both of these
// passed the entire 937-test suite:
//
//     const auth = { ok: true as const, maxDurationSeconds: 900 }   // authorization skipped
//     await createStreamUpload(fileSize, safeName, 60)             // reservation hardcoded again
//
// The first removes the password gate, the rate limit, the size cap and the video budget from the
// only path that bounds Cloudflare Stream cost. The second is the defect that makes every video
// over a minute upload fully over venue wifi and then die at 100% during processing — the exact
// one the extraction had just fixed inside the module, recreated one line further down in the same
// commit. That is the fourth time in this repo a decision was tested and its enforcement was not
// (MISTAKES.md entry 10).
//
// SCOPE, ENFORCED BY REVIEW — do not grow this file.
//
// A route-wiring test may assert ONLY that:
//   1. the authorization module was called with the request's own fields,
//   2. its result was used unchanged,
//   3. the effectful call was skipped when it refused.
//
// It asserts nothing that tests/video-upload-authorization.test.ts already asserts. That boundary
// is what keeps it honest: vitest.config.mts warns that mocking a database "would assert that the
// mocks behave, not that the system does", and it is right. Here the mocks ARE the I/O boundary and
// the thing being executed is the wiring — which is the thing that was broken.

const authCalls: unknown[] = []
/** Every reserve_album_video call: the name and its parameters. */
const bookings: Array<{ name: string; params: Record<string, unknown> }> = []
/** Cloudflare uploads handed back because the album filled up. */
const releases: string[] = []
const streamCalls: unknown[][] = []
const inserts: unknown[] = []

// An unusual value on purpose: a hardcoded 60, 900 or 21600 at the call site cannot coincide with
// it, so assertion (2) below cannot pass by accident.
const RESERVATION = 4321
// Also unusual on purpose: a hardcoded 600/1200/3000 at the call site cannot coincide with it.
const BUDGET = 7777

const cfg: {
  authOk: boolean; refusal: Response | null; ipRlOk: boolean; rateLimitCalls: unknown[][]
  /** What the atomic booking answers. false = somebody else took the last minutes. */
  bookingOk: boolean
  bookingError: string | null
} = { authOk: true, refusal: null, ipRlOk: true, rateLimitCalls: [], bookingOk: true, bookingError: null }

vi.mock('@/lib/server/video-upload-authorization', () => ({
  authorizeVideoUpload: async (params: unknown) => {
    authCalls.push(params)
    return cfg.authOk
      ? { ok: true, effectiveTier: 'free', maxDurationSeconds: RESERVATION, budgetSeconds: BUDGET }
      : { ok: false, response: cfg.refusal }
  },
}))
vi.mock('@/lib/cloudflare/stream', () => ({
  createStreamUpload: async (...args: unknown[]) => {
    streamCalls.push(args)
    return {
      uploadUrl: 'https://upload.cloudflarestream.com/abc123',
      streamUid: 'uid-from-cloudflare',
      iframeUrl: 'https://iframe.videodelivery.net/abc',
      thumbnailUrl: 'https://videodelivery.net/abc/thumb.jpg',
    }
  },
  deleteStreamVideo: async (uid: string) => { releases.push(uid) },
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ insert: async (row: unknown) => { inserts.push(row); return { error: null } } }),
    // THE BOOKING. The hold used to be a plain insert, which cannot be atomic: the budget is read
    // before the Cloudflare call and the row is written after it. This records what was booked and
    // can refuse, so both halves are observable.
    rpc: (name: string, params: Record<string, unknown>) => {
      bookings.push({ name, params })
      return { returns: async () => (cfg.bookingError
        ? { data: null, error: { message: cfg.bookingError } }
        : { data: cfg.bookingOk, error: null }) }
    },
  }),
}))
vi.mock('@/lib/rate-limit', () => ({
  // Records its arguments AND can refuse. The route's own per-IP limit is the one thing the module
  // docstring says the CALLER still owns, and `if (false)` on it survived all ten of these tests
  // because the mock always said yes and nobody looked at what was asked.
  checkRateLimit: async (...args: unknown[]) => {
    cfg.rateLimitCalls.push(args)
    return cfg.ipRlOk ? { ok: true } : { ok: false, retryAfterSeconds: 60 }
  },
  clientIpKey: (_req: unknown, prefix: string) => `${prefix}:test`,
}))
vi.mock('@/lib/report-server-error', () => ({ reportServerError: () => {} }))

const { POST } = await import('@/app/api/upload/stream/route')

const ALBUM_ID = '11111111-2222-3333-4444-555555555555'

function post(body: Record<string, unknown>): Request {
  return new Request('https://hushare.space/api/upload/stream', {
    method: 'POST',
    // The real forbidCrossSiteRequest runs — an Origin is required, so this also proves the CSRF
    // guard is still in front of everything.
    headers: { 'Content-Type': 'application/json', Origin: 'https://hushare.space' },
    body: JSON.stringify(body),
  })
}

const VALID = { albumId: ALBUM_ID, fileName: 'clip.mp4', contentType: 'video/mp4', fileSize: 5_000_000, durationSeconds: 42 }

beforeEach(() => {
  authCalls.length = 0
  streamCalls.length = 0
  inserts.length = 0
  cfg.authOk = true
  cfg.refusal = null
  cfg.ipRlOk = true
  cfg.rateLimitCalls = []
  cfg.bookingOk = true
  cfg.bookingError = null
  bookings.length = 0
  releases.length = 0
})

describe('the route cannot skip authorization', () => {
  it('calls the authorizer with the request own fields', async () => {
    // Kills the "stub auth to {ok:true}" mutation: if the call is removed, nothing is recorded.
    await POST(post(VALID))
    expect(authCalls).toHaveLength(1)
    expect(authCalls[0]).toEqual({
      albumId: ALBUM_ID,
      contentType: 'video/mp4',
      fileSize: 5_000_000,
      durationSeconds: 42,
    })
  })

  it('returns the authorizer refusal UNCHANGED, and never reaches Cloudflare', async () => {
    // Kills "drop the `if (!auth.ok) return`", which is the realistic drift — nobody commits a
    // stubbed auth object, but a refactor does lose an early return.
    cfg.authOk = false
    cfg.refusal = new Response(JSON.stringify({ error: 'nope' }), { status: 403 })
    const res = await POST(post(VALID))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'nope' })
    expect(streamCalls, 'a refused upload must never reserve Cloudflare quota').toHaveLength(0)
    expect(bookings).toHaveLength(0)
  })
})

describe('the reservation the authorizer decided is the one Cloudflare is given', () => {
  it('passes auth.maxDurationSeconds through, not a value of its own', async () => {
    // THE MUTATION THAT SURVIVED EVERYTHING. Hardcoding 60 here means every video over a minute
    // uploads completely and then dies at 100% during Cloudflare processing.
    await POST(post(VALID))
    expect(streamCalls).toHaveLength(1)
    expect(streamCalls[0][2], 'the third argument to createStreamUpload is the reservation').toBe(RESERVATION)
  })

  it('still passes it through when the clip could not be measured', async () => {
    // The unmeasured path is where a "sensible default" is most tempting to inline.
    await POST(post({ ...VALID, durationSeconds: undefined }))
    expect(streamCalls[0][2]).toBe(RESERVATION)
  })
})

describe('the upload session is bound to the album that asked for it', () => {
  it('records Cloudflare uid against this album', async () => {
    // Without this row, photos/create cannot verify a uid belongs to the album redeeming it — the
    // guard that stops a uid issued for album A being injected into album B.
    await POST(post(VALID))
    expect(bookings).toHaveLength(1)
    expect(bookings[0].name, 'the hold must be BOOKED, not inserted — an insert cannot be atomic')
      .toBe('reserve_album_video')
    expect(bookings[0].params).toMatchObject({ p_stream_uid: 'uid-from-cloudflare', p_album_id: ALBUM_ID })
  })

  it('records the duration THIS request was approved on, so it can be charged later', async () => {
    // The client used to declare a video's length twice — here, where it is checked against the
    // album's minute pool, and again to photos/create, which is the number that actually got
    // written and summed. Declaring one second bought a 62-second Cloudflare reservation, so a real
    // 62-second video uploaded fine while the album's total rose by one.
    //
    // Storing it at the moment of approval is what makes the checked number and the charged number
    // the same number. If this stops being written, photos/create silently falls back to believing
    // the client again and the gap reopens with nothing else to notice.
    await POST(post(VALID))
    expect(bookings[0].params).toMatchObject({ p_declared: 42 })
  })

  it('stores null when the clip could not be measured, rather than a guess', async () => {
    // ~16% of real videos have no duration the browser can read. Null means exactly that, and is
    // counted as zero against the budget with Cloudflare's own ceiling as the server-side bound.
    await POST(post({ ...VALID, durationSeconds: undefined }))
    expect(bookings[0].params).toMatchObject({ p_declared: null })
  })

  it('never stores a negative duration, whatever the client claims', async () => {
    // One negative row summed into an album's total read as zero through the old total-only clamp
    // and disabled that album's video budget permanently.
    await POST(post({ ...VALID, durationSeconds: -2_000_000_000 }))
    expect(bookings[0].params).toMatchObject({ p_declared: null })
  })
})

describe('malformed requests never reach the authorizer', () => {
  it('refuses a bad body before any album work', async () => {
    // Not a duplicate of the module's own validation: this asserts the ORDER, that a malformed
    // request costs no query at all.
    const res = await POST(post({ ...VALID, albumId: 'not-a-uuid' }))
    expect(res.status).toBe(400)
    expect(authCalls).toHaveLength(0)
  })

  it('refuses a cross-site request before anything else', async () => {
    const res = await POST(new Request('https://hushare.space/api/upload/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify(VALID),
    }))
    expect(res.status).not.toBe(200)
    expect(authCalls).toHaveLength(0)
  })
})

describe('the limit the route still owns for itself', () => {
  it('checks the per-IP limit, keyed and failing closed', async () => {
    // The module docstring says the caller keeps CSRF, the per-IP limit and field validation. The
    // first two were tested and this one was not — `if (false)` on it passed every test here.
    await POST(post(VALID))
    expect(cfg.rateLimitCalls).toHaveLength(1)
    const [key, window, ceiling, opts] = cfg.rateLimitCalls[0]
    expect(key).toBe('stream_ip:test')
    expect(window).toBe(3600)
    expect(typeof ceiling).toBe('number')
    // failOpen:false is deliberate: a limiter we cannot consult must refuse on the only path that
    // bounds Cloudflare Stream cost.
    expect(opts).toEqual({ failOpen: false })
  })

  it('429s a hammered IP before authorizing anything', async () => {
    // Ordering: a flooded IP must cost no album lookup and no subscription lookup.
    cfg.ipRlOk = false
    const res = await POST(post(VALID))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(authCalls, 'a rate-limited request must not reach authorization').toHaveLength(0)
    expect(streamCalls).toHaveLength(0)
  })
})

describe('the last of an album minutes can only be sold once', () => {
  // The budget is read BEFORE the Cloudflare call and the hold is written AFTER it, so two requests
  // a few hundred milliseconds apart both read an empty album. The hold made that window minutes
  // instead of the whole upload; booking through reserve_album_video closes what is left, because it
  // takes an advisory lock, writes the hold and re-asks inside that lock.
  it('books against the budget the authorizer decided', async () => {
    // Hardcoding a tier cap here would be the same defect as hardcoding the Cloudflare reservation,
    // which survived every test until it was pinned.
    await POST(post(VALID))
    expect(bookings[0].params.p_budget_seconds).toBe(BUDGET)
  })

  it('refuses with 403 when somebody else took the last minutes', async () => {
    cfg.bookingOk = false
    const res = await POST(post(VALID))
    expect(res.status, '403 not 429 — upload-policy retries a 429 four more times').toBe(403)
    expect(await res.json()).toMatchObject({ code: 'album_video_full' })
  })

  it('hands the Cloudflare upload back when it refuses', async () => {
    // An unreleased reservation is quota nobody can use, against a ceiling shared by every album.
    cfg.bookingOk = false
    await POST(post(VALID))
    expect(releases, 'the seat we just took must not be left to expire').toEqual(['uid-from-cloudflare'])
  })

  it('does NOT release anything on a successful booking', async () => {
    await POST(post(VALID))
    expect(releases).toEqual([])
  })

  it('502s rather than guessing when the booking itself errors', async () => {
    cfg.bookingError = 'deadlock detected'
    const res = await POST(post(VALID))
    expect(res.status).toBe(502)
  })
})
