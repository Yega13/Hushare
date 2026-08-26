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
// This is READ-ONLY against pending_stream_uploads — it never consumes the row. That happens
// exactly once, later, in /api/album/photos/create's atomic UPDATE ... RETURNING claim.

type PendingRow = { album_id: string; upload_url: string | null }

async function lookupPendingUpload(uid: string): Promise<PendingRow | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('pending_stream_uploads')
    .select('album_id, upload_url')
    .eq('stream_uid', uid)
    // A CONSUMED TOKEN IS NOT RELAYABLE, and this line is what keeps that true.
    //
    // photos/create used to DELETE the row when it claimed a token, so a consumed uid simply had
    // no row and this lookup returned null. It now marks consumed_at instead (so a retried save
    // can be told apart from an injection attempt — see that route), which means the row survives
    // the claim. Without this filter, that change would quietly reopen the relay for a video that
    // has already been saved: the same uid, still forwarding chunks, indefinitely.
    //
    // Nothing about the relay itself needs to change for the retry fix. A retried SAVE never comes
    // back through here — the bytes are already in Stream; it is the database row that is missing.
    .is('consumed_at', null)
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
const FORWARD_REQUEST_HEADER_BLOCKLIST = new Set(['host', 'cookie', 'content-length', 'connection', 'authorization', 'x-http-method-override'])
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
  const clientMethod = req.method
  // Some networks/proxies silently drop the HTTP PATCH method (photos upload with PUT and sail
  // through; video TUS uses PATCH and dies with no HTTP response). tus-js-client's
  // overridePatchMethod sends POST + "X-HTTP-Method-Override: PATCH" instead — honour that here
  // and forward a REAL PATCH to Cloudflare. Response shaping still keys off the CLIENT method.
  const override = req.headers.get('x-http-method-override')
  const method = (clientMethod === 'POST' && override?.toUpperCase() === 'PATCH') ? 'PATCH' : clientMethod

  if (!UID_RE.test(uid)) {
    return jsonResponse(clientMethod, 400, 'Invalid uid')
  }

  const pending = await lookupPendingUpload(uid)
  if (!pending) {
    return jsonResponse(clientMethod, 404, 'Upload not found')
  }
  if (!pending.upload_url) {
    // Pre-migration row (created before upload_url existed) — nothing to relay to.
    return jsonResponse(clientMethod, 400, 'Upload not available for relay')
  }

  const contentLengthHeader = req.headers.get('content-length')
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_RELAY_BODY_BYTES) {
    return jsonResponse(clientMethod, 413, 'Chunk too large')
  }

  // Bounded buffering (not zero-copy streaming) is the right call here, not a shortcut: every
  // chunk is capped at STREAM_CHUNK_SIZE_BYTES (5MB) by our own client config, so simple buffering
  // is safe, and simpler/lower-risk than true streaming for a bound this small.
  const body = method === 'PATCH' ? await req.arrayBuffer() : undefined
  if (body && body.byteLength > MAX_RELAY_BODY_BYTES) {
    return jsonResponse(clientMethod, 413, 'Chunk too large')
  }

  let upstream: Response
  try {
    upstream = await fetch(pending.upload_url, {
      method,
      headers: buildForwardHeaders(req.headers),
      body,
      // Fail fast + retryable (TUS resumes from the confirmed offset) rather than leaving the
      // client hanging if Cloudflare's upstream ever stalls.
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    console.error('[stream-relay] upstream fetch failed:', e instanceof Error ? e.message : String(e))
    return jsonResponse(clientMethod, 502, 'Relay failed')
  }

  return buildUpstreamPassthrough(clientMethod, upstream)
}

// Shared edge rate-limit guard for the write methods (PATCH + its POST-override twin).
async function relayRateLimit(method: string, uid: string): Promise<Response | null> {
  try {
    const limiter = (getCloudflareContext()?.env as RelayEnv | undefined)?.STREAM_RELAY_LIMITER
    if (limiter) {
      const { success } = await limiter.limit({ key: uid })
      if (!success) return jsonResponse(method, 429, 'Too many requests')
    }
  } catch (e) {
    console.warn('[stream-relay] rate limiter check failed, proceeding:', e instanceof Error ? e.message : String(e))
  }
  return null
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
  const limited = await relayRateLimit('PATCH', uid)
  if (limited) return limited

  return relay(req, uid)
}

// POST is the PATCH-via-override twin: for networks that block the PATCH method, tus-js-client sends
// POST + "X-HTTP-Method-Override: PATCH". Same guards as PATCH; relay() maps it back to a real PATCH.
export async function POST(req: Request, { params }: { params: Promise<{ uid: string }> }): Promise<Response> {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const { uid } = await params
  if (!UID_RE.test(uid)) {
    return jsonResponse('POST', 400, 'Invalid uid')
  }

  const limited = await relayRateLimit('POST', uid)
  if (limited) return limited

  return relay(req, uid)
}
