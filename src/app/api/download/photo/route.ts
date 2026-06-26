import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { timingSafeEqual } from '@/lib/timing-safe'
import { cookieNameForAlbum, verifyAccessToken } from '@/lib/album-password'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { createPresignedGet } from '@/lib/cloudflare/r2'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

type PhotoRow = { url: string | null; storage_path: string | null; storage_backend: string; album_id: string }
type AlbumRow = {
  id: string
  owner_token: string
  allow_guest_downloads: boolean
  password_hash: string | null
  retired_at: string | null
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const photoId = url.searchParams.get('id')
  if (!photoId) {
    return NextResponse.json({ error: 'Missing photo id' }, { status: 400, headers: NO_STORE })
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(photoId)) {
    return NextResponse.json({ error: 'Invalid photo id' }, { status: 400, headers: NO_STORE })
  }

  // blob=1: used by the ZIP download — streams bytes through the server so client-side
  // fetch() can read the response body without a cross-origin R2 presigned-URL redirect.
  // Uses a separate, higher rate limit (2000/hr) to allow full-album ZIP downloads.
  // Single-photo downloads (no blob=1) use the strict 60/30s limit.
  const isBlobMode = url.searchParams.get('blob') === '1'
  const rl = isBlobMode
    ? await checkRateLimit(clientIpKey(req, 'download_blob'), 3600, 2000, { failOpen: false })
    : await checkRateLimit(clientIpKey(req, 'download_photo'), 30, 60, { failOpen: false })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  const admin = createAdminClient()
  const { data: photo, error: photoErr } = await admin
    .from('photos')
    .select('url, storage_path, storage_backend, album_id')
    .eq('id', photoId)
    .maybeSingle<PhotoRow>()

  if (photoErr) {
    return NextResponse.json({ error: 'DB error' }, { status: 500, headers: NO_STORE })
  }
  if (!photo) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  }

  const { data: album, error: albumErr } = await admin
    .from('albums')
    .select('id, owner_token, allow_guest_downloads, password_hash, retired_at')
    .eq('id', photo.album_id)
    .maybeSingle<AlbumRow>()

  if (albumErr || !album || album.retired_at) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  }

  const jar = await cookies()
  const ownerCookie = (jar.get(`hushare_owner_${album.id}`)?.value ?? '').trim()
  const isOwner = ownerCookie.length > 0 && timingSafeEqual(ownerCookie, album.owner_token)

  if (!isOwner) {
    if (!album.allow_guest_downloads) {
      return NextResponse.json(
        { error: 'Downloads are disabled for this album' },
        { status: 403, headers: NO_STORE },
      )
    }
    if (album.password_hash) {
      const pwCookie = jar.get(cookieNameForAlbum(album.id))?.value ?? ''
      const valid = pwCookie ? await verifyAccessToken(pwCookie, album.password_hash, album.id) : false
      if (!valid) {
        return NextResponse.json({ error: 'Unlock the album first' }, { status: 403, headers: NO_STORE })
      }
    }
  }

  if (photo.storage_backend === 'stream') {
    return NextResponse.json(
      { error: 'Video downloads are not supported via this endpoint' },
      { status: 422, headers: NO_STORE },
    )
  }

  if (!photo.storage_path) {
    return NextResponse.json({ error: 'No downloadable file for this photo' }, { status: 404, headers: NO_STORE })
  }

  // Generate a presigned GET URL with ResponseContentDisposition=attachment.
  // photo.url is a public CDN URL — appending response-content-disposition as a query
  // param to a CDN URL does nothing because R2 only honours it on presigned S3 requests.
  // We must sign a new GetObject request with the disposition baked into the signature.
  const signedUrl = await createPresignedGet(photo.storage_path, 'attachment', 300)

  if (isBlobMode) {
    // Fetch the asset from R2 server-side and stream bytes directly to the client.
    // This avoids a cross-origin presigned-URL redirect, which would require R2 CORS
    // headers for client-side fetch() to be able to read the response body for ZIP assembly.
    const r2Res = await fetch(signedUrl)
    if (!r2Res.ok || !r2Res.body) {
      return NextResponse.json({ error: 'Asset unavailable' }, { status: 502, headers: NO_STORE })
    }
    return new Response(r2Res.body, {
      headers: {
        'Content-Type': r2Res.headers.get('Content-Type') ?? 'application/octet-stream',
        'Content-Disposition': 'attachment',
        'Cache-Control': 'no-store',
      },
    })
  }

  return NextResponse.redirect(signedUrl, {
    status: 302,
    headers: { 'Cache-Control': 'no-store' },
  })
}
