import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const UID_RE = /^[a-f0-9]{32}$/

// Minimal local type — avoids importing @cloudflare/workers-types globally (conflicts with DOM
// types), matching the pattern already used elsewhere in this codebase (e.g. lib/album-delete.ts's
// R2BucketLike). "eventually consistent per Cloudflare location" per Cloudflare's own docs — fine
// here since this binding is an abuse backstop, not a precise accounting mechanism (see wrangler.toml).
type RateLimitBinding = { limit(opts: { key: string }): Promise<{ success: boolean }> }
type RelayEnv = { STREAM_RELAY_LIMITER?: RateLimitBinding }

// Same-origin TUS pass-through proxy for Cloudflare Stream video uploads — the fallback for
// networks that block upload.cloudflarestream.com outright (confirmed in production: one device's
// every direct-upload attempt failed with a network-level error — no HTTP response ever arrived —
// while dozens of other videos uploaded fine from other devices in the same window). The browser
// talks to hushare.space (which that device CAN reach) instead of Cloudflare's upload domain
// directly; this route forwards the exact same TUS protocol to the real Cloudflare URL.
//
// SECURITY: this route NEVER accepts a client-supplied destination. The only fetch target it can
// ever reach is upload_url, which WE stored server-side in pending_stream_uploads at upload-session
// creation time (src/app/api/upload/stream/route.ts), itself already origin-validated in
// createStreamUpload() (src/lib/cloudflare/stream.ts) to start with https://upload.videodelivery.net/
// or https://upload.cloudflarestream.com/. There is no SSRF surface here — uid is the only client
// input, and it only ever resolves to a URL we chose, never one the client chooses.
//
// This is READ-ONLY against pending_stream_uploads — it never deletes/consumes the row. That
// happens exactly once, later, in /api/album/photos/create's atomic DELETE+RETURNING.

type PendingRow = { album_id: string; upload_url: string | null }

async function lookupPendingUpload(uid: string): Promise<PendingRow | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('pending_stream_uploads')
    .select('album_id, upload_url')
    .eq('stream_uid', uid)
    .maybeSingle<PendingRow>()
  return data ?? null
}

// Headers that must never be forwarded outbound: host/connection are hop-by-hop or
// destination-specific; content-length is recomputed per the ACTUAL body we send (see below);
// cookie must never leak to Cloudflare's public API; authorization is the most important one to
// exclude — the direct-upload path never sends CLOUDFLARE_STREAM_TOKEN (or any bearer token) to
// upload.cloudflarestream.com, since the unguessable upload_url itself IS the capability. This
// route must build its outbound headers by copying ONLY the incoming client request's headers
// (minus this blocklist) — it must never separately attach a header from our own secrets.
const FORWARD_REQUEST_HEADER_BLOCKLIST = new Set(['host', 'cookie', 'content-length', 'connection', 'authorization'])
const FORWARD_RESPONSE_HEADER_BLOCKLIST = new Set(['content-length', 'content-encoding', 'transfer-encoding', 'connection'])

function buildForwardHeaders(incoming: Headers): Headers {
  const out = new Headers()
  for (const [key, value] of incoming.entries()) {
    if (!FORWARD_REQUEST_HEADER_BLOCKLIST.has(key.toLowerCase())) out.set(key, value)
  }
  return out
}

// CRITICAL, discovered live: every response this route returns must carry an explicit Content-
// Length that matches the body ACTUALLY sent. A prior version used NextResponse.json() (and a bare
// upstream.body passthrough) without one; combined with the runtime's default Connection: keep-
// alive, the client (curl, and by extension tus-js-client's XHR/fetch) had no way to know when the
// response ended and hung for 15-30s on every single request, even though the server had already
// sent correct headers within ~1s. HEAD responses are the sharpest case: HTTP forbids a body on a
// HEAD response at all, so those are constructed as explicitly bodyless (`null`, Content-Length: 0)
// rather than trusting whatever Cloudflare's own upstream HEAD response happened to contain.

function isHead(method: string): boolean {
  return method === 'HEAD'
}

function jsonResponse(method: string, status: number, error: string): Response {
  if (isHead(method)) {
    return new Response(null, { status, headers: { 'Cache-Control': 'no-store', 'Content-Length': '0' } })
  }
  const json = JSON.stringify({ error })
  const bytes = new TextEncoder().encode(json)
  return new Response(bytes, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'Content-Length': String(bytes.length) },
  })
}

async function buildUpstreamPassthrough(method: string, upstream: Response): Promise<Response> {
  const headers = new Headers()
  for (const [key, value] of upstream.headers.entries()) {
    if (!FORWARD_RESPONSE_HEADER_BLOCKLIST.has(key.toLowerCase())) headers.set(key, value)
  }
  headers.set('Cache-Control', 'no-store')

  if (isHead(method)) {
    // Never trust/pass through upstream.body for HEAD — HTTP forbids a body here regardless of
    // what Cloudflare's own response contained.
    headers.set('Content-Length', '0')
    return new Response(null, { status: upstream.status, headers })
  }

  // PATCH responses from Cloudflare's TUS endpoint are tiny (headers-only confirmation, ~empty
  // body) — buffer it so Content-Length is always exact, consistent with the bounded-buffering
  // approach used for the request body below.
  const bytes = await upstream.arrayBuffer()
  headers.set('Content-Length', String(bytes.byteLength))
  return new Response(bytes, { status: upstream.status, headers })
}

// Defensive ceiling above the expected 5MB TUS chunk size (STREAM_CHUNK_SIZE_BYTES in
// src/lib/constants.ts) — catches a bug or tampered client before it ever reaches the upstream fetch.
const MAX_RELAY_BODY_BYTES = 8 * 1024 * 1024

async function relay(req: Request, uid: string): Promise<Response> {
  const method = req.method

  if (!UID_RE.test(uid)) {
    return jsonResponse(method, 400, 'Invalid uid')
  }

  const pending = await lookupPendingUpload(uid)
  if (!pending) {
    return jsonResponse(method, 404, 'Upload not found')
  }
  if (!pending.upload_url) {
    // Pre-migration row (created before upload_url existed) — nothing to relay to.
    return jsonResponse(method, 400, 'Upload not available for relay')
  }

  const contentLengthHeader = req.headers.get('content-length')
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_RELAY_BODY_BYTES) {
    return jsonResponse(method, 413, 'Chunk too large')
  }

  // Bounded buffering (not zero-copy streaming) is the right call here, not a shortcut: every
  // chunk is capped at STREAM_CHUNK_SIZE_BYTES (5MB) by our own client config, so simple buffering
  // is safe, and simpler/lower-risk than true streaming for a bound this small.
  const body = method === 'PATCH' ? await req.arrayBuffer() : undefined
  if (body && body.byteLength > MAX_RELAY_BODY_BYTES) {
    return jsonResponse(method, 413, 'Chunk too large')
  }

  let upstream: Response
  try {
    upstream = await fetch(pending.upload_url, {
      method,
      headers: buildForwardHeaders(req.headers),
      body,
    })
  } catch (e) {
    console.error('[stream-relay] upstream fetch failed:', e instanceof Error ? e.message : String(e))
    return jsonResponse(method, 502, 'Relay failed')
  }

  return buildUpstreamPassthrough(method, upstream)
}

export async function HEAD(req: Request, { params }: { params: Promise<{ uid: string }> }): Promise<Response> {
  // No Origin required for HEAD — idempotent, no state change, and the uid is unguessable
  // (Cloudflare-generated 128-bit hex) so there's nothing meaningful to protect beyond what the
  // pending_stream_uploads lookup already gates.
  const { uid } = await params
  return relay(req, uid)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ uid: string }> }): Promise<Response> {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const { uid } = await params
  if (!UID_RE.test(uid)) {
    return jsonResponse('PATCH', 400, 'Invalid uid')
  }

  // Edge-native rate limit (see wrangler.toml) — not the DB-backed checkRateLimit, which would add
  // 2-3 Postgres round trips to every chunk at a frequency (hundreds-to-thousands per large video)
  // that helper was never sized for. Fails OPEN if the binding is unavailable (e.g. local dev
  // without the binding configured) — this is an abuse backstop, not the primary access control
  // (that's the pending_stream_uploads existence check, which always runs regardless).
  try {
    const limiter = (getCloudflareContext()?.env as RelayEnv | undefined)?.STREAM_RELAY_LIMITER
    if (limiter) {
      const { success } = await limiter.limit({ key: uid })
      if (!success) {
        return jsonResponse('PATCH', 429, 'Too many requests')
      }
    }
  } catch (e) {
    console.warn('[stream-relay] rate limiter check failed, proceeding:', e instanceof Error ? e.message : String(e))
  }

  return relay(req, uid)
}
