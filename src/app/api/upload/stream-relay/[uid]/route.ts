import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
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
// destination-specific; content-length is recomputed automatically from the body by fetch();
// cookie must never leak to Cloudflare's public API; authorization is the most important one to
// exclude — the direct-upload path never sends CLOUDFLARE_STREAM_TOKEN (or any bearer token) to
// upload.cloudflarestream.com, since the unguessable upload_url itself IS the capability. This
// route must build its outbound headers by copying ONLY the incoming client request's headers
// (minus this blocklist) — it must never separately attach a header from our own secrets.
const FORWARD_REQUEST_HEADER_BLOCKLIST = new Set(['host', 'cookie', 'content-length', 'connection', 'authorization'])
// content-length/content-encoding/transfer-encoding/connection are recomputed by the runtime when
// constructing the outgoing Response — forwarding Cloudflare's original values verbatim (when the
// runtime may re-encode the body differently) would cause a decode mismatch on the client.
const FORWARD_RESPONSE_HEADER_BLOCKLIST = new Set(['content-length', 'content-encoding', 'transfer-encoding', 'connection'])

function buildForwardHeaders(incoming: Headers): Headers {
  const out = new Headers()
  for (const [key, value] of incoming.entries()) {
    if (!FORWARD_REQUEST_HEADER_BLOCKLIST.has(key.toLowerCase())) out.set(key, value)
  }
  return out
}

function buildResponseHeaders(upstream: Headers): Headers {
  const out = new Headers()
  for (const [key, value] of upstream.entries()) {
    if (!FORWARD_RESPONSE_HEADER_BLOCKLIST.has(key.toLowerCase())) out.set(key, value)
  }
  out.set('Cache-Control', 'no-store')
  return out
}

// Defensive ceiling above the expected 5MB TUS chunk size (STREAM_CHUNK_SIZE_BYTES in
// src/lib/constants.ts) — catches a bug or tampered client before it ever reaches the upstream fetch.
const MAX_RELAY_BODY_BYTES = 8 * 1024 * 1024

async function relay(req: Request, uid: string): Promise<Response> {
  if (!UID_RE.test(uid)) {
    return NextResponse.json({ error: 'Invalid uid' }, { status: 400, headers: NO_STORE })
  }

  const pending = await lookupPendingUpload(uid)
  if (!pending) {
    return NextResponse.json({ error: 'Upload not found' }, { status: 404, headers: NO_STORE })
  }
  if (!pending.upload_url) {
    // Pre-migration row (created before upload_url existed) — nothing to relay to.
    return NextResponse.json({ error: 'Upload not available for relay' }, { status: 400, headers: NO_STORE })
  }

  const contentLengthHeader = req.headers.get('content-length')
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_RELAY_BODY_BYTES) {
    return NextResponse.json({ error: 'Chunk too large' }, { status: 413, headers: NO_STORE })
  }

  // Bounded buffering (not zero-copy streaming) is the right call here, not a shortcut: every
  // chunk is capped at STREAM_CHUNK_SIZE_BYTES (5MB) by our own client config, so simple buffering
  // is safe, and simpler/lower-risk than true streaming for a bound this small.
  const body = req.method === 'PATCH' ? await req.arrayBuffer() : undefined
  if (body && body.byteLength > MAX_RELAY_BODY_BYTES) {
    return NextResponse.json({ error: 'Chunk too large' }, { status: 413, headers: NO_STORE })
  }

  let upstream: Response
  try {
    upstream = await fetch(pending.upload_url, {
      method: req.method,
      headers: buildForwardHeaders(req.headers),
      body,
    })
  } catch (e) {
    console.error('[stream-relay] upstream fetch failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Relay failed' }, { status: 502, headers: NO_STORE })
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: buildResponseHeaders(upstream.headers),
  })
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
    return NextResponse.json({ error: 'Invalid uid' }, { status: 400, headers: NO_STORE })
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
        return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: NO_STORE })
      }
    }
  } catch (e) {
    console.warn('[stream-relay] rate limiter check failed, proceeding:', e instanceof Error ? e.message : String(e))
  }

  return relay(req, uid)
}
