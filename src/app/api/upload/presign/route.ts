import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedImage, createPresignedPut, r2PublicUrl, safeExtForMime } from '@/lib/cloudflare/r2'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { uploadCapsForTier } from '@/lib/media'
import { getUserTierById } from '@/lib/subscriptions'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { v4 as uuid } from 'uuid'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_FILESIZE_HARD_CAP = 200 * 1024 * 1024 // 200 MB absolute ceiling regardless of tier
// Client thumbnails are ~20–80KB JPEGs; 8MB is a generous ceiling that still blocks abuse of
// the thumb slot as a second full-size upload channel.
const MAX_THUMB_BYTES = 8 * 1024 * 1024

type Body = {
  albumId?: unknown
  fileName?: unknown
  contentType?: unknown
  fileSize?: unknown
  isThumb?: unknown
  thumbSize?: unknown
}

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as Body | null
  const { albumId, fileName, contentType, fileSize, isThumb, thumbSize } = body ?? {}

  if (
    typeof albumId !== 'string' || !UUID_RE.test(albumId) ||
    typeof fileName !== 'string' || !fileName || fileName.length > 255 ||
    typeof contentType !== 'string' || !contentType ||
    typeof fileSize !== 'number' || !Number.isFinite(fileSize) || !Number.isInteger(fileSize) || fileSize <= 0
  ) {
    return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400, headers: NO_STORE })
  }

  // Optional paired-thumbnail presign: one round trip covers the image AND its ~30KB thumbnail
  // (the client used to make a second full presign call per photo just for the thumb).
  if (
    thumbSize !== undefined &&
    (typeof thumbSize !== 'number' || !Number.isFinite(thumbSize) || !Number.isInteger(thumbSize) ||
      thumbSize <= 0 || thumbSize > MAX_THUMB_BYTES)
  ) {
    return NextResponse.json({ error: 'Invalid thumbSize' }, { status: 400, headers: NO_STORE })
  }

  const normalizedType = contentType.toLowerCase()
  if (!isAllowedImage(normalizedType)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 415, headers: NO_STORE })
  }

  // Fast-fail before DB round-trips if file is obviously too large
  if (fileSize > MAX_FILESIZE_HARD_CAP) {
    return NextResponse.json({ error: 'File too large' }, { status: 413, headers: NO_STORE })
  }

  const admin = createAdminClient()

  // The IP rate limit and the album lookup are independent — run them in parallel and check
  // the limiter's verdict first. (Previously all four DB interactions here ran serially,
  // putting ~2 extra round trips of latency on every single upload's critical path.)
  const [ipRl, albumRes] = await Promise.all([
    checkRateLimit(clientIpKey(req, 'presign_ip'), 3600, 500, { failOpen: false }),
    admin
      .from('albums')
      .select('id, user_id, guest_uploads_enabled')
      .eq('id', albumId)
      .is('retired_at', null)
      .maybeSingle<{ id: string; user_id: string | null; guest_uploads_enabled: boolean }>(),
  ])
  if (!ipRl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(ipRl.retryAfterSeconds), ...NO_STORE } },
    )
  }
  const album = albumRes.data
  if (albumRes.error || !album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }
  if (!album.guest_uploads_enabled) {
    return NextResponse.json({ error: 'Uploads disabled for this album' }, { status: 403, headers: NO_STORE })
  }

  // Album rate limit ∥ tier lookup — again independent; the limiter verdict is checked first,
  // so a rate-limited caller still gets a 429 (the tier read just cost one parallel query).
  const [albumRl, tierRes] = await Promise.all([
    checkRateLimit(`presign_album:${albumId}`, 3600, 5000, { failOpen: false }),
    getUserTierById(album.user_id)
      .then(tier => ({ tier, error: null as unknown }))
      .catch((error: unknown) => ({ tier: null, error })),
  ])
  if (!albumRl.ok) {
    return NextResponse.json(
      { error: 'Album upload rate limit reached' },
      { status: 429, headers: { 'Retry-After': String(albumRl.retryAfterSeconds), ...NO_STORE } },
    )
  }
  if (tierRes.tier === null) {
    console.error('[presign] getUserTierById failed:', tierRes.error instanceof Error ? tierRes.error.message : String(tierRes.error))
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503, headers: NO_STORE })
  }

  const caps = uploadCapsForTier(tierRes.tier)
  if (fileSize > caps.image) {
    return NextResponse.json(
      { error: `File too large (max ${caps.image / 1024 / 1024} MB for your tier)` },
      { status: 413, headers: NO_STORE },
    )
  }

  // isThumb must be strictly true (not just truthy) — prevent "false" string from triggering thumb path
  const thumbOnly = isThumb === true
  // Derive a safe extension cross-validated against the declared MIME type
  const rawExt = String(fileName).split('.').pop()?.toLowerCase() ?? ''
  const ext = thumbOnly ? 'jpg' : safeExtForMime(normalizedType, rawExt)
  // For thumbs, always use image/jpeg regardless of what the client declared
  const finalContentType = thumbOnly ? 'image/jpeg' : normalizedType

  const key = thumbOnly
    ? `thumbs/${albumId}/${uuid()}.jpg`
    : `albums/${albumId}/${uuid()}.${ext}`
  // A paired thumb only makes sense for a main-image presign
  const thumbKey = !thumbOnly && typeof thumbSize === 'number'
    ? `thumbs/${albumId}/${uuid()}.jpg`
    : null

  let presignedUrl: string
  let thumbPresignedUrl: string | null = null
  let publicUrl: string
  try {
    ;[presignedUrl, thumbPresignedUrl] = await Promise.all([
      createPresignedPut(key, finalContentType, 3600, fileSize),
      thumbKey ? createPresignedPut(thumbKey, 'image/jpeg', 3600, thumbSize as number) : Promise.resolve(null),
    ])
    publicUrl = r2PublicUrl(key)
  } catch (e) {
    console.error('[presign] presign/r2url failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Could not generate upload URL' }, { status: 502, headers: NO_STORE })
  }

  return NextResponse.json(
    {
      presignedUrl,
      key,
      publicUrl,
      ...(thumbKey && thumbPresignedUrl
        ? { thumb: { presignedUrl: thumbPresignedUrl, key: thumbKey, publicUrl: r2PublicUrl(thumbKey) } }
        : {}),
    },
    { headers: NO_STORE },
  )
}
