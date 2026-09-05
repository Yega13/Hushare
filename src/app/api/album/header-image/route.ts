import { NextResponse } from 'next/server'
import { refuseAccess } from '@/lib/server/respond'
import { isOwnAlbumAsset } from '@/lib/cloudflare/r2'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { setAlbumHeader } from '@/lib/server/album-header'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

type HeaderImageAlbum = {
  id: string
  owner_token: string
  user_id: string | null
  custom_slug?: string | null
  header_image: string | null
}

// Records a custom header photo after it's been uploaded to R2 (see header-image/upload). Mirrors
// /api/album/background's validation shape, except the stored value is a plain URL — no "image:"
// prefix needed since this field only ever holds one shape.
function isValidHeaderImage(url: string | null, r2Host: string): boolean {
  if (url === null) return true
  try {
    const parsed = new URL(url)
    if (parsed.origin !== `https://${r2Host}`) return false
    if (!parsed.pathname.startsWith('/headers/')) return false
    if (parsed.pathname.includes('..')) return false
    return true
  } catch { return false }
}

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; header_image?: unknown } | null
  const { slug, header_image } = body ?? {}

  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }
  if (header_image !== null && typeof header_image !== 'string') {
    return NextResponse.json({ error: 'Invalid header_image' }, { status: 400, headers: NO_STORE })
  }
  if (typeof header_image === 'string' && header_image.length > 1024) {
    return NextResponse.json({ error: 'Invalid header_image value' }, { status: 400, headers: NO_STORE })
  }
  const value = typeof header_image === 'string' ? header_image.trim() : null

  const r2Host = (process.env.R2_PUBLIC_HOST ?? '').trim().replace(/\/+$/, '')
  if (value !== null && !r2Host) {
    console.error('[album/header-image] R2_PUBLIC_HOST not set')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500, headers: NO_STORE })
  }

  if (!isValidHeaderImage(value, r2Host)) {
    return NextResponse.json({ error: 'Invalid header_image value' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit<HeaderImageAlbum>(req, slug.trim(), 'header_image')
  if (!access.ok) return refuseAccess(access)

  // Ownership is known only now, so the album-scoped check has to happen here. The prefix check
  // above rejects wrong-host and wrong-folder URLs cheaply; this one rejects another album's asset.
  if (value !== null && !isOwnAlbumAsset(value, 'headers', access.album.id, r2Host)) {
    return NextResponse.json({ error: 'Invalid header_image value' }, { status: 403, headers: NO_STORE })
  }

  const admin = createAdminClient()
  // Setting a custom header image (or clearing it, value null) always replaces whatever photo was
  // chosen as cover — setAlbumHeader is the single place that enforces the "one source at a time"
  // rule and cleans up R2, so this route never has to remember either half of that itself.
  const result = await setAlbumHeader(
    admin,
    access.album.id,
    { coverPhotoId: null, headerImage: value },
    access.album.header_image,
  )
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
