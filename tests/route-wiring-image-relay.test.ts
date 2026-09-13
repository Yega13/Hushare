import { describe, it, expect, vi, beforeEach } from 'vitest'
import { READ_FAILURE_MESSAGE } from '@/lib/upload/failure'

// THE RELAY THAT STORED NOTHING AND CALLED IT A SUCCESS, executed by a test for the first time.
//
// /api/upload/image-relay is how a photo reaches R2 when a network blocks R2's own upload domain.
// It is 190 lines that write customer bytes into the bucket, and no test ran any of them: the five
// test files that mention it read its path or its field rules, and none imports it.
//
// WHY NOW. On 2026-09-13 R2's own object listing found 14 photo rows pointing at zero-byte objects,
// in two albums, and both uploads had logged the relay taking over from a failed direct upload
// seconds before the empty rows were saved. Of the three ways bytes reach R2, this route's
// buffered branch was the only one with no lower bound: the direct PUT binds content-length into
// its signature, and the declared-size branch pipes through FixedLengthStream, which errors on a
// short body. The buffered branch checked that the body was not too big, and stored an empty one.
//
// SCOPE, ENFORCED BY REVIEW -- do not grow this file. It asserts only that:
//   1. each refusal answers with the status and words the client acts on,
//   2. NOTHING REACHES THE BUCKET on any refusal -- the assertion a regex can never make,
//   3. what IS stored is the bytes that arrived, by the branch the request's shape selects.
// Authorization itself is tests/image-upload-authorization.test.ts, and the field rules are
// tests/presign-fields.test.ts; neither is repeated here.

const HOST = 'cdn.hushare.space'
const ALBUM_ID = '11111111-2222-3333-4444-555555555555'
const KEY = `albums/${ALBUM_ID}/relayed.jpg`

/** Every object that reached the bucket, and HOW it arrived. Empty is what matters on a refusal. */
const puts: Array<{ key: string; bytes: number; via: 'stream' | 'buffer'; contentType?: string }> = []
/** Every authorization request, so "was it asked at all" is observable. */
const authCalls: unknown[] = []
const cfg: { authOk: boolean; refusal: Response | null } = { authOk: true, refusal: null }

vi.mock('@/lib/server/image-upload-authorization', () => ({
  authorizeImageUpload: async (_req: unknown, params: unknown) => {
    authCalls.push(params)
    return cfg.authOk
      ? { ok: true, tier: 'free', imageCap: 25 * 1024 * 1024 }
      : { ok: false, response: cfg.refusal }
  },
  deriveImageKey: () => ({ key: KEY, finalContentType: 'image/jpeg' }),
}))

// The R2 binding. Records the byte count that actually reached put(), reading a stream to its end
// the way the platform would, so a stream that errors part-way never counts as stored.
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => ({
    env: {
      R2_BUCKET: {
        put: async (key: string, value: ReadableStream | ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) => {
          const via = value instanceof ArrayBuffer ? 'buffer' : 'stream'
          const bytes = value instanceof ArrayBuffer ? value.byteLength : (await new Response(value).arrayBuffer()).byteLength
          puts.push({ key, bytes, via, contentType: options?.httpMetadata?.contentType })
          return {}
        },
      },
    },
  }),
}))
vi.mock('@/lib/report-server-error', () => ({ reportServerError: () => {} }))

// Cloudflare's FixedLengthStream does not exist in Node, and the route reads it from globalThis when
// the module loads -- so it is installed BEFORE the import below. It encodes exactly one rule, the
// documented one: "An error will occur if too many, or too few bytes are written through the stream."
class FakeFixedLengthStream {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
  constructor(length: number) {
    let seen = 0
    const t = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, c) {
        seen += chunk.byteLength
        if (seen > length) throw new TypeError(`FixedLengthStream: more than ${length} bytes`)
        c.enqueue(chunk)
      },
      flush() {
        if (seen !== length) throw new TypeError(`FixedLengthStream: ${seen} of ${length} bytes`)
      },
    })
    this.readable = t.readable
    this.writable = t.writable
  }
}
Object.assign(globalThis, { FixedLengthStream: FakeFixedLengthStream })

const { POST } = await import('@/app/api/upload/image-relay/route')

const FIELDS = `albumId=${ALBUM_ID}&fileName=IMG_2741.jpeg&contentType=image%2Fjpeg&isThumb=0`

function bodyOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      if (bytes.byteLength > 0) c.enqueue(bytes)
      c.close()
    },
  })
}

/** A body the relay is NOT told the size of -- an XHR body arriving with no usable Content-Length. */
function unsized(bytes: Uint8Array, fields = FIELDS): Request {
  return new Request(`https://hushare.space/api/upload/image-relay?${fields}`, {
    method: 'POST',
    // The real forbidCrossSiteRequest runs, so an Origin is required.
    headers: { Origin: 'https://hushare.space', 'Content-Type': 'image/jpeg' },
    body: bodyOf(bytes),
    duplex: 'half',
  } as RequestInit)
}

/** A body that declares its size up front, so the route streams it through FixedLengthStream. */
function sized(bytes: Uint8Array, declared: number): Request {
  return new Request(`https://hushare.space/api/upload/image-relay?${FIELDS}`, {
    method: 'POST',
    headers: { Origin: 'https://hushare.space', 'Content-Type': 'image/jpeg', 'content-length': String(declared) },
    body: bodyOf(bytes),
    duplex: 'half',
  } as RequestInit)
}

beforeEach(() => {
  process.env.R2_PUBLIC_HOST = HOST
  puts.length = 0
  authCalls.length = 0
  cfg.authOk = true
  cfg.refusal = null
})

describe('the image relay stores what arrived, and refuses what did not', () => {
  it('A BODY OF ZERO BYTES IS REFUSED, and nothing reaches the bucket', async () => {
    // The defect. This used to become a zero-byte object behind a 200 and a public URL, and the
    // client wrote a row for it. Fourteen photo rows in R2 look exactly like that.
    const res = await POST(unsized(new Uint8Array(0)))
    expect(res.status, 'an empty body must be refused').toBe(400)
    // The client's own read-failure sentence, so the guest is told what will actually help.
    expect(await res.json()).toEqual({ error: READ_FAILURE_MESSAGE })
    expect(puts, 'an empty body must never become an object').toHaveLength(0)
  })

  it('a real body with no declared size is stored byte for byte, from the buffer', async () => {
    const res = await POST(unsized(new Uint8Array([1, 2, 3, 4, 5, 6, 7])))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ key: KEY })
    expect(puts).toEqual([{ key: KEY, bytes: 7, via: 'buffer', contentType: 'image/jpeg' }])
  })

  it('a body with a declared size is STREAMED through, not held whole in Worker memory', async () => {
    const res = await POST(sized(new Uint8Array([9, 9, 9, 9, 9]), 5))
    expect(res.status).toBe(200)
    expect(puts, 'the declared-size branch must stream, and deliver every byte').toEqual([
      { key: KEY, bytes: 5, via: 'stream', contentType: 'image/jpeg' },
    ])
  })

  it('a declared size the body does not deliver is never answered with success', async () => {
    // Why the declared branch needs no empty check of its own: a short body errors the stream, and
    // the route must turn that into a failure rather than a 200 with a URL for bytes that never came.
    const res = await POST(sized(new Uint8Array(0), 5))
    expect(res.status, 'a short body must not be reported as stored').not.toBe(200)
    expect(puts).toHaveLength(0)
  })

  it("an authorization refusal is handed back unchanged, and nothing is stored", async () => {
    cfg.authOk = false
    cfg.refusal = new Response(JSON.stringify({ error: 'refused by the album' }), { status: 403 })
    const res = await POST(unsized(new Uint8Array([1, 2, 3])))
    expect(res, "authorization's own response, not one of the route's").toBe(cfg.refusal)
    expect(puts).toHaveLength(0)
  })

  it('invalid fields are refused before authorization is even asked', async () => {
    const res = await POST(unsized(new Uint8Array([1, 2, 3]), `albumId=${ALBUM_ID}&fileName=&contentType=image%2Fjpeg`))
    expect(res.status).toBe(400)
    expect(authCalls, 'the cheap check must protect the expensive one').toHaveLength(0)
    expect(puts).toHaveLength(0)
  })
})
