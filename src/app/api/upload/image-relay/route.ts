import { NextResponse } from 'next/server'
import { tooLargeMessage } from '@/lib/media'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { r2PublicUrl, IMMUTABLE_CACHE_CONTROL } from '@/lib/cloudflare/r2'
import { authorizeImageUpload, deriveImageKey } from '@/lib/server/image-upload-authorization'
import { forbidCrossSiteRequest } from '@/lib/request-security'

// The ceiling for a body whose length the browser did not declare. 64 MB: larger than any photo
// this uploader can produce (6000px long edge re-encoded), smaller than a Worker's memory limit.
const RELAY_UNKNOWN_SIZE_MAX = 64 * 1024 * 1024

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Minimal local types — avoids importing @cloudflare/workers-types globally (conflicts with DOM
// types), matching the pattern already used elsewhere in this codebase (e.g. lib/album-delete.ts's
// R2BucketLike, the video relay's RateLimitBinding).
type R2PutOptions = { httpMetadata?: { contentType?: string; cacheControl?: string } }
type R2BucketLike = { put(key: string, value: ReadableStream | ArrayBuffer, options?: R2PutOptions): Promise<unknown> }
type ImageRelayEnv = { R2_BUCKET?: R2BucketLike }

// FixedLengthStream is a Cloudflare Workers global (not a Web/DOM standard type, so not in the
// project's lib.dom types) — a passthrough that (a) gives its `readable` side a KNOWN LENGTH,
// which R2Bucket.put() requires ("Provided readable stream must have a known length" — discovered
// live: a bare req.body, or one piped through a generic TransformStream, does NOT carry this,
// which a plain arrayBuffer-based approach would have masked), and (b) bounds total bytes passed
// through to exactly the declared length, so it doubles as the enforcement that a lying
// Content-Length can't smuggle more bytes into storage than what authorizeImageUpload approved.
type FixedLengthStreamCtor = new (length: number) => {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
}
const FixedLengthStream = (globalThis as unknown as { FixedLengthStream: FixedLengthStreamCtor }).FixedLengthStream

// Same-origin fallback for R2 image uploads — for networks that block R2's upload domain
// (<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com) outright, the same class of problem Phase 1
// solved for Cloudflare Stream video uploads (confirmed in production: one device's network blocked
// BOTH upload domains). Unlike Phase 1, R2 has a native Cloudflare Workers binding (R2_BUCKET,
// already used elsewhere in this codebase for deletes) — so this route writes directly via that
// binding. There is no outbound fetch anywhere in this route, so there is no fetch-based SSRF
// surface to defend against at all.
//
// SECURITY: this route NEVER accepts a client-supplied storage key. It re-runs the ENTIRE
// authorization chain /api/upload/presign already performs (src/lib/server/image-upload-
// authorization.ts) from scratch on every call — rate limits, album + guest_uploads_enabled check,
// tier lookup, size cap — and only then generates a fresh server-side key. No client input ever
// influences the write destination.
//
// Body handling: streams the request body directly into R2Bucket.put() rather than buffering —
// unlike Phase 1's TUS chunks (bounded to 5MB by our own client config), images have no such tight
// bound (the tier cap allows up to 200MB, and this codebase's own upload pipeline deliberately never
// re-encodes animated GIFs, so a legitimate large file is a real case, not just a theoretical one).
// FixedLengthStream (see above) enforces the REAL authorized size on actual bytes received,
// independent of whatever Content-Length the client declared — Content-Length is trusted only for
// the authorization gate (the same trust level /api/upload/presign already places on a
// client-declared fileSize), never as the sole enforcement of how many bytes are actually written.

function parseBoolParam(v: string | null): boolean {
  return v === '1' || v === 'true'
}

export async function POST(req: Request): Promise<Response> {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const url = new URL(req.url)
  const albumId = url.searchParams.get('albumId') ?? ''
  const fileName = url.searchParams.get('fileName') ?? ''
  const contentType = url.searchParams.get('contentType') ?? ''
  const isThumb = parseBoolParam(url.searchParams.get('isThumb'))

  if (!UUID_RE.test(albumId) || !fileName || fileName.length > 255 || !contentType) {
    return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400, headers: NO_STORE })
  }

  // Content-Length is the browser's own declaration for a Blob/ArrayBuffer body — trusted here only
  // for the authorization gate, at the SAME trust level /api/upload/presign already places on a
  // client-declared fileSize field. The size-limit stream below enforces the real cap regardless.
  // A MISSING Content-Length IS NOT A REASON TO REFUSE SOMEBODY'S PHOTO.
  //
  // Chrome on iOS 26 sends upload requests without it — confirmed on a real device, from an album
  // where Cloudflare Stream rejected that same phone's video chunks for the identical reason. This
  // route used to answer 400 and the photo was simply lost, on the one path that exists BECAUSE the
  // direct upload already failed. The relay is the last resort; it cannot be the pickiest step.
  //
  // The header was only ever a pre-authorisation hint, at the same trust level as the presign
  // route's client-declared fileSize — and the size-limit stream below enforces the real cap on the
  // actual bytes regardless. So when it is absent, authorise against the album's own ceiling (the
  // largest this album could legally accept) and let the stream do what it already does. Nothing is
  // weakened: a caller could always have declared this number anyway.
  const headerSize = Number(req.headers.get('content-length') ?? '')
  const declaredSize = Number.isFinite(headerSize) && headerSize > 0 ? headerSize : null

  const auth = await authorizeImageUpload(req, {
    albumId,
    contentType,
    // null → the album's own per-file ceiling, resolved inside authorizeImageUpload.
    fileSize: declaredSize,
  })
  if (!auth.ok) return auth.response

  const { key, finalContentType } = deriveImageKey(albumId, contentType, fileName, isThumb)

  const bucket = (getCloudflareContext()?.env as ImageRelayEnv | undefined)?.R2_BUCKET
  if (!bucket) {
    console.error('[image-relay] R2_BUCKET binding unavailable')
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503, headers: NO_STORE })
  }
  if (!req.body) {
    return NextResponse.json({ error: 'Missing request body' }, { status: 400, headers: NO_STORE })
  }

  // TWO WAYS TO KNOW HOW BIG THE BODY IS, because one browser will not say.
  //
  // With a Content-Length: FixedLengthStream is the strict, streaming path — piping req.body into
  // `writable` fails if MORE bytes than declaredSize arrive (a lying header cannot smuggle extra
  // bytes past the size we already authorised), and R2Bucket.put() gets a `readable` with the
  // known length it requires. Unchanged, and still what almost every upload takes.
  //
  // Without one (Chrome on iOS 26): buffer the body and measure it ourselves, bounded — an unknown
  // length cannot be handed to FixedLengthStream at all. RELAY_UNKNOWN_SIZE_MAX is far above any
  // processed photo (the uploader caps the long edge at 6000px) and far below the Worker's memory
  // ceiling, so this can neither refuse a real picture nor be used to exhaust the isolate. Refusing
  // outright is what this route used to do, and it lost somebody's photos on the LAST-RESORT path.
  let pipePromise: Promise<unknown>
  let putPromise: Promise<unknown>
  if (declaredSize !== null) {
    const { readable, writable } = new FixedLengthStream(declaredSize)
    pipePromise = req.body.pipeTo(writable)
    putPromise = bucket.put(key, readable, {
      httpMetadata: { contentType: finalContentType, cacheControl: IMMUTABLE_CACHE_CONTROL },
    })
  } else {
    const buffered = await req.arrayBuffer()
    if (buffered.byteLength > RELAY_UNKNOWN_SIZE_MAX) {
      return NextResponse.json(
        { error: tooLargeMessage('image', RELAY_UNKNOWN_SIZE_MAX) },
        { status: 413, headers: NO_STORE },
      )
    }
    pipePromise = Promise.resolve()
    putPromise = bucket.put(key, buffered, {
      httpMetadata: { contentType: finalContentType, cacheControl: IMMUTABLE_CACHE_CONTROL },
    })
  }

  try {
    await Promise.all([pipePromise, putPromise])
  } catch (e) {
    console.error('[image-relay] R2 put failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Upload failed' }, { status: 502, headers: NO_STORE })
  }

  return NextResponse.json({ key, publicUrl: r2PublicUrl(key) }, { headers: NO_STORE })
}
