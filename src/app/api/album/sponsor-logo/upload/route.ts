import { NextResponse } from 'next/server'
import { refuseAccess } from '@/lib/server/respond'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { createPresignedPut, r2PublicUrl, isAllowedImage, safeExtForMime } from '@/lib/cloudflare/r2'
import { v4 as uuid } from 'uuid'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_SPONSOR_LOGO_BYTES = 5 * 1024 * 1024  // 5 MB — same class of asset as the album logo
const MAX_SPONSORS = 12  // a "strip" is a handful of marks, not an infinite scroller

// Presign for a sponsor logo — mirrors /api/album/logo/upload, different R2 prefix, and gated the
// same way (paid feature — see /api/album/sponsors for the same check on the record step).
export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as {
    slug?: unknown
    contentType?: unknown
    fileName?: unknown
    fileSize?: unknown
  } | null
  const { slug, contentType, fileName, fileSize } = body ?? {}

  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }
  if (typeof contentType !== 'string' || !isAllowedImage(contentType.toLowerCase())) {
    return NextResponse.json({ error: 'Invalid or unsupported image type' }, { status: 415, headers: NO_STORE })
  }
  if (typeof fileSize !== 'number' || !Number.isFinite(fileSize) || !Number.isInteger(fileSize) || fileSize <= 0 || fileSize > MAX_SPONSOR_LOGO_BYTES) {
    return NextResponse.json({ error: `Invalid file size (max ${MAX_SPONSOR_LOGO_BYTES / 1024 / 1024} MB)` }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit<{ id: string; owner_token: string; user_id: string | null; custom_slug?: string | null; sponsor_logos: unknown }>(req, slug.trim(), 'sponsor_logos')
  if (!access.ok) return refuseAccess(access)

  const existing = Array.isArray(access.album.sponsor_logos) ? access.album.sponsor_logos.length : 0
  if (existing >= MAX_SPONSORS) {
    return NextResponse.json({ error: `Up to ${MAX_SPONSORS} sponsor logos per album.` }, { status: 400, headers: NO_STORE })
  }

  const albumRl = await checkRateLimit(
    clientIpKey(req, `sponsor_upload:${access.album.id}`),
    600, 8, { failOpen: false },
  )
  if (!albumRl.ok) {
    return NextResponse.json(
      { error: 'Too many sponsor logo uploads. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(albumRl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  const normalizedType = contentType.toLowerCase()
  const rawExt = typeof fileName === 'string' ? (fileName.split('.').pop()?.toLowerCase() ?? '') : ''
  const ext = safeExtForMime(normalizedType, rawExt)
  const key = `sponsors/${access.album.id}/${uuid()}.${ext}`

  let presignedUrl: string
  let publicUrl: string
  try {
    presignedUrl = await createPresignedPut(key, normalizedType, 3600, fileSize)
    publicUrl = r2PublicUrl(key)
  } catch (e) {
    console.error('[album/sponsor-logo/upload] presign failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Could not generate upload URL' }, { status: 502, headers: NO_STORE })
  }

  return NextResponse.json({ presignedUrl, publicUrl }, { headers: NO_STORE })
}
