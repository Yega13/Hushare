import { NextResponse } from 'next/server'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { createPresignedPut, r2PublicUrl, isAllowedImage, safeExtForMime } from '@/lib/cloudflare/r2'
import { v4 as uuid } from 'uuid'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

const MAX_LOGO_BYTES = 5 * 1024 * 1024  // 5 MB — a logo is a small mark, not a photo

// Presign for a custom album logo — mirrors /api/album/header-image/upload exactly, just a
// different R2 prefix and a tighter size cap (a logo has no business being a multi-MB photo).
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
  if (typeof fileSize !== 'number' || !Number.isFinite(fileSize) || !Number.isInteger(fileSize) || fileSize <= 0 || fileSize > MAX_LOGO_BYTES) {
    return NextResponse.json({ error: `Invalid file size (max ${MAX_LOGO_BYTES / 1024 / 1024} MB)` }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit(req, slug.trim())
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  // Per-album rate limit prevents unlimited R2 presign slots from one owner cycling uploads.
  // failOpen:false — deny on outage rather than allow unbounded logo uploads.
  const albumRl = await checkRateLimit(
    clientIpKey(req, `logo_upload:${access.album.id}`),
    600, 5, { failOpen: false },
  )
  if (!albumRl.ok) {
    return NextResponse.json(
      { error: 'Too many logo uploads. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(albumRl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  const normalizedType = contentType.toLowerCase()
  const rawExt = typeof fileName === 'string' ? (fileName.split('.').pop()?.toLowerCase() ?? '') : ''
  const ext = safeExtForMime(normalizedType, rawExt)
  const key = `logos/${access.album.id}/${uuid()}.${ext}`

  let presignedUrl: string
  let publicUrl: string
  try {
    presignedUrl = await createPresignedPut(key, normalizedType, 3600, fileSize)
    publicUrl = r2PublicUrl(key)
  } catch (e) {
    console.error('[album/logo/upload] presign failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Could not generate upload URL' }, { status: 502, headers: NO_STORE })
  }

  return NextResponse.json({ presignedUrl, publicUrl }, { headers: NO_STORE })
}
