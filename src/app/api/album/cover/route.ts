import { NextResponse } from 'next/server'
import { refuseAccess } from '@/lib/server/respond'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { setAlbumHeader } from '@/lib/server/album-header'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type CoverAlbum = {
  id: string
  owner_token: string
  user_id: string | null
  custom_slug?: string | null
  header_image: string | null
}

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; photo_id?: unknown } | null
  const { slug, photo_id } = body ?? {}

  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }
  if (photo_id !== null && photo_id !== undefined) {
    if (typeof photo_id !== 'string' || !UUID_RE.test(photo_id)) {
      return NextResponse.json({ error: 'photo_id must be a valid UUID or null' }, { status: 400, headers: NO_STORE })
    }
  }

  const access = await verifyOwnerViaCookieWithRateLimit<CoverAlbum>(req, slug.trim(), 'header_image')
  if (!access.ok) return refuseAccess(access)

  const admin = createAdminClient()

  const targetPhotoId = typeof photo_id === 'string' ? photo_id : null

  if (targetPhotoId !== null) {
    // Verify the photo belongs to this album — prevents setting another album's photo as cover
    const { data: photo } = await admin
      .from('photos')
      .select('id')
      .eq('id', targetPhotoId)
      .eq('album_id', access.album.id)
      .maybeSingle()
    if (!photo) {
      return NextResponse.json({ error: 'Photo not found in this album' }, { status: 404, headers: NO_STORE })
    }
  }

  // Picking an existing photo (or clearing, targetPhotoId null) always replaces any custom header
  // image — setAlbumHeader is the single place that enforces the "one source at a time" rule and
  // cleans up R2, so this route never has to remember either half of that itself.
  const result = await setAlbumHeader(
    admin,
    access.album.id,
    { coverPhotoId: targetPhotoId, headerImage: null },
    access.album.header_image,
  )
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
