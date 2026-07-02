import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { broadcastAlbumSettings } from '@/lib/broadcast'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

  const access = await verifyOwnerViaCookieWithRateLimit(req, slug.trim())
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

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

  const { error } = await admin
    .from('albums')
    .update({ cover_photo_id: targetPhotoId })
    .eq('id', access.album.id)

  if (error) {
    console.error('[album/cover] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update cover photo' }, { status: 500, headers: NO_STORE })
  }

  void broadcastAlbumSettings(access.album.id, { cover_photo_id: targetPhotoId })
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
