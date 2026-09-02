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
const streamCalls: unknown[][] = []
const inserts: unknown[] = []

// An unusual value on purpose: a hardcoded 60, 900 or 21600 at the call site cannot coincide with
// it, so assertion (2) below cannot pass by accident.
const RESERVATION = 4321

const cfg: { authOk: boolean; refusal: Response | null } = { authOk: true, refusal: null }

vi.mock('@/lib/server/video-upload-authorization', () => ({
  authorizeVideoUpload: async (params: unknown) => {
    authCalls.push(params)
    return cfg.authOk
      ? { ok: true, effectiveTier: 'free', maxDurationSeconds: RESERVATION }
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
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ insert: async (row: unknown) => { inserts.push(row); return { error: null } } }),
  }),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ ok: true }),
  clientIpKey: () => 'test-key',
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
    expect(inserts).toHaveLength(0)
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
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ stream_uid: 'uid-from-cloudflare', album_id: ALBUM_ID })
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
    expect(inserts[0]).toMatchObject({ declared_duration_seconds: 42 })
  })

  it('stores null when the clip could not be measured, rather than a guess', async () => {
    // ~16% of real videos have no duration the browser can read. Null means exactly that, and is
    // counted as zero against the budget with Cloudflare's own ceiling as the server-side bound.
    await POST(post({ ...VALID, durationSeconds: undefined }))
    expect(inserts[0]).toMatchObject({ declared_duration_seconds: null })
  })

  it('never stores a negative duration, whatever the client claims', async () => {
    // One negative row summed into an album's total read as zero through the old total-only clamp
    // and disabled that album's video budget permanently.
    await POST(post({ ...VALID, durationSeconds: -2_000_000_000 }))
    expect(inserts[0]).toMatchObject({ declared_duration_seconds: null })
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
