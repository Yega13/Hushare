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

type Body = {
  albumId?: unknown
  fileName?: unknown
  contentType?: unknown
  fileSize?: unknown
  isThumb?: unknown
}

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const ipRl = await checkRateLimit(clientIpKey(req, 'presign_ip'), 3600, 500, { failOpen: false })
  if (!ipRl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(ipRl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  const body = await req.json().catch(() => null) as Body | null
  const { albumId, fileName, contentType, fileSize, isThumb } = body ?? {}

  if (
    typeof albumId !== 'string' || !UUID_RE.test(albumId) ||
    typeof fileName !== 'string' || !fileName || fileName.length > 255 ||
    typeof contentType !== 'string' || !contentType ||
    typeof fileSize !== 'number' || !Number.isFinite(fileSize) || !Number.isInteger(fileSize) || fileSize <= 0
  ) {
    return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400, headers: NO_STORE })
  }

  const normalizedType = contentType.toLowerCase()
  if (!isAllowedImage(normalizedType)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 415, headers: NO_STORE })
  }

  // Fast-fail before DB round-trip if file is obviously too large
  if (fileSize > MAX_FILESIZE_HARD_CAP) {
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
  const albumRl = await checkRateLimit(`presign_album:${albumId}`, 3600, 5000, { failOpen: false })
  if (!albumRl.ok) {
    return NextResponse.json(
      { error: 'Album upload rate limit reached' },
      { status: 429, headers: { 'Retry-After': String(albumRl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  let tier: Awaited<ReturnType<typeof getUserTierById>>
  try {
    tier = await getUserTierById(album.user_id)
  } catch (e) {
    console.error('[presign] getUserTierById failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503, headers: NO_STORE })
  }

  const caps = uploadCapsForTier(tier)
  if (fileSize > caps.image) {
    return NextResponse.json(
      { error: `File too large (max ${caps.image / 1024 / 1024} MB for your tier)` },
      { status: 413, headers: NO_STORE },
    )
  }

  // isThumb must be strictly true (not just truthy) — prevent "false" string from triggering thumb path
  const thumb = isThumb === true
  // Derive a safe extension cross-validated against the declared MIME type
  const rawExt = String(fileName).split('.').pop()?.toLowerCase() ?? ''
  const ext = thumb ? 'jpg' : safeExtForMime(normalizedType, rawExt)
  // For thumbs, always use image/jpeg regardless of what the client declared
  const finalContentType = thumb ? 'image/jpeg' : normalizedType

  const key = thumb
    ? `thumbs/${albumId}/${uuid()}.jpg`
    : `albums/${albumId}/${uuid()}.${ext}`

  let presignedUrl: string
  let publicUrl: string
  try {
    presignedUrl = await createPresignedPut(key, finalContentType, 3600, fileSize)
    publicUrl = r2PublicUrl(key)
  } catch (e) {
    console.error('[presign] presign/r2url failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Could not generate upload URL' }, { status: 502, headers: NO_STORE })
  }

  return NextResponse.json({ presignedUrl, key, publicUrl }, { headers: NO_STORE })
}
