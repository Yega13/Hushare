import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyAccessToken } from '@/lib/album-password'
import { timingSafeEqual } from '@/lib/timing-safe'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Same columns AlbumPageClient renders.
const PHOTO_COLS = [
  'id', 'album_id', 'storage_path', 'storage_backend',
  'url', 'thumb_url', 'caption', 'author_name', 'created_at',
  'media_type', 'poster_url', 'stream_uid', 'stream_iframe_url',
  'stream_thumbnail_url', 'duration_seconds',
  'display_radius', 'display_filter', 'sort_order', 'face_ids',
].join(', ')

// Authenticated photo listing.
//
// The anon client can only read photos of OPEN albums (the "photos readable when album
// is open" RLS policy). Password-protected and reveal-gated albums are invisible to
// anon — so their photos are fetched here, via the admin client, AFTER verifying that
// the caller is the owner (owner-token cookie) or an unlocked guest (password
// access-token cookie). This is what schema.sql refers to by "fetched via API route
// (admin client) after cookie verification".
export async function GET(req: Request) {
  const albumId = new URL(req.url).searchParams.get('albumId') ?? ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(albumId)) {
    return NextResponse.json({ error: 'Invalid album id' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: album } = await admin
    .from('albums')
    .select('id, owner_token, password_hash, reveal_at, retired_at')
    .eq('id', albumId)
    .maybeSingle<{ id: string; owner_token: string; password_hash: string | null; reveal_at: string | null; retired_at: string | null }>()

  if (!album || album.retired_at) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }

  const cookieStore = await cookies()

  // Owner?
  let authorized = false
  const ownerCookie = (cookieStore.get(`hushare_owner_${albumId}`)?.value ?? '').trim()
  if (ownerCookie) authorized = timingSafeEqual(ownerCookie, album.owner_token)

  if (!authorized) {
    // Reveal gate — before the reveal time, nobody but the owner sees the media.
    if (album.reveal_at && new Date(album.reveal_at) > new Date()) {
      return NextResponse.json({ error: 'Locked' }, { status: 403, headers: NO_STORE })
    }
    if (album.password_hash) {
      // Password-protected: require a valid access-token cookie.
      const pwCookie = cookieStore.get(`hushare_pw_${albumId}`)?.value ?? ''
      authorized = pwCookie.length > 0
        ? await verifyAccessToken(pwCookie, album.password_hash, albumId)
        : false
      if (!authorized) {
        return NextResponse.json({ error: 'Password required' }, { status: 403, headers: NO_STORE })
      }
    } else {
      // Open album — anyone may read.
      authorized = true
    }
  }

  const { data: photos, error } = await admin
    .from('photos')
    .select(PHOTO_COLS)
    .eq('album_id', albumId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(2000)

  if (error) {
    console.error('[album/photos] fetch failed:', error.message)
    return NextResponse.json({ error: 'Failed to load photos' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ photos: photos ?? [] }, { headers: NO_STORE })
}
