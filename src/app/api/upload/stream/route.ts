import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedVideo } from '@/lib/cloudflare/r2'
import { createStreamUpload } from '@/lib/cloudflare/stream'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { uploadCapsForTier, STUDIO_VIDEO_BYTES } from '@/lib/media'
import { getUserTierById } from '@/lib/subscriptions'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_VIDEO_HARD_CAP = STUDIO_VIDEO_BYTES // absolute ceiling = studio tier cap

type Body = {
  albumId?: unknown
  fileName?: unknown
  contentType?: unknown
  fileSize?: unknown
}

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const ipRl = await checkRateLimit(clientIpKey(req, 'stream_ip'), 3600, 200, { failOpen: false })
  if (!ipRl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(ipRl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  const body = await req.json().catch(() => null) as Body | null
  const { albumId, fileName, contentType, fileSize } = body ?? {}

  if (
    typeof albumId !== 'string' || !UUID_RE.test(albumId) ||
    typeof fileName !== 'string' || !fileName || fileName.length > 255 ||
    typeof contentType !== 'string' || !contentType ||
    typeof fileSize !== 'number' || !Number.isFinite(fileSize) || !Number.isInteger(fileSize) || fileSize <= 0
  ) {
    return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400, headers: NO_STORE })
  }

  const normalizedType = contentType.toLowerCase()
  if (!isAllowedVideo(normalizedType)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 415, headers: NO_STORE })
  }

  if (fileSize > MAX_VIDEO_HARD_CAP) {
    return NextResponse.json({ error: 'File too large' }, { status: 413, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: album, error: albumError } = await admin
    .from('albums')
    .select('id, user_id, guest_uploads_enabled')
    .eq('id', albumId)
    .is('retired_at', null)
    .maybeSingle<{ id: string; user_id: string | null; guest_uploads_enabled: boolean }>()

  if (albumError || !album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }
  if (!album.guest_uploads_enabled) {
    return NextResponse.json({ error: 'Uploads disabled for this album' }, { status: 403, headers: NO_STORE })
  }

  // Rate-limit BEFORE subscription lookup — reject hammered albums without paying the tier cost
  const albumRl = await checkRateLimit(`stream_album:${albumId}`, 3600, 200, { failOpen: false })
  if (!albumRl.ok) {
    return NextResponse.json(
      { error: 'Album video upload rate limit reached' },
      { status: 429, headers: { 'Retry-After': String(albumRl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  let tier: Awaited<ReturnType<typeof getUserTierById>>
  try {
    tier = await getUserTierById(album.user_id)
  } catch (e) {
    console.error('[stream] getUserTierById failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503, headers: NO_STORE })
  }

  const caps = uploadCapsForTier(tier)
  if (fileSize > caps.video) {
    return NextResponse.json(
      { error: `File too large (max ${caps.video / 1024 / 1024} MB for your tier)` },
      { status: 413, headers: NO_STORE },
    )
  }

  let uploadUrl: string
  let streamUid: string
  let iframeUrl: string
  let thumbnailUrl: string
  try {
    // Sanitize fileName to printable ASCII before passing to Cloudflare Stream's metadata API.
    const safeName = String(fileName).replace(/[^\w.\- ]/g, '_').slice(0, 255)
    ;({ uploadUrl, streamUid, iframeUrl, thumbnailUrl } = await createStreamUpload(fileSize, safeName))
  } catch (e) {
    console.error('[stream] createStreamUpload failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Failed to initiate video upload' }, { status: 502, headers: NO_STORE })
  }

  // Guard against a compromised or misconfigured Cloudflare API returning a
  // non-Cloudflare upload URL that would be forwarded to the client. Cloudflare
  // returns either upload.videodelivery.net (legacy) or upload.cloudflarestream.com.
  if (
    !uploadUrl.startsWith('https://upload.videodelivery.net/') &&
    !uploadUrl.startsWith('https://upload.cloudflarestream.com/')
  ) {
    console.error('[stream] Cloudflare returned unexpected uploadUrl origin:', uploadUrl.slice(0, 80))
    return NextResponse.json({ error: 'Failed to initiate video upload' }, { status: 502, headers: NO_STORE })
  }

  // Bind stream_uid → albumId before returning to client.
  // photos/create verifies and consumes this row — prevents a guest from calling
  // /upload/stream for album A then injecting that uid into album B via photos/create.
  const { error: pendingErr } = await admin
    .from('pending_stream_uploads')
    .insert({ stream_uid: streamUid, album_id: albumId })
  if (pendingErr) {
    console.error('[stream] pending_stream_uploads insert failed:', pendingErr.message)
    return NextResponse.json({ error: 'Failed to initiate video upload' }, { status: 502, headers: NO_STORE })
  }

  // 1% chance — purge stale rows (video uploaded but photos/create never called, e.g. tab closed).
  if (Math.random() < 0.01) {
    const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    void admin.from('pending_stream_uploads').delete().lt('created_at', staleCutoff)
  }

  return NextResponse.json({ uploadUrl, streamUid, iframeUrl, thumbnailUrl }, { headers: NO_STORE })
}
