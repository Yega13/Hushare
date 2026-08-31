import { NextResponse } from 'next/server'
import { reportServerError } from '@/lib/report-server-error'
import { createAdminClient } from '@/lib/supabase/admin'
import { timingSafeEqual } from '@/lib/timing-safe'
import { cookieNameForAlbum, verifyAccessToken } from '@/lib/album-password'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { createPresignedGet } from '@/lib/cloudflare/r2'
import { track } from '@/lib/analytics'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

type PhotoRow = { url: string | null; storage_path: string | null; storage_backend: string; album_id: string; hidden: boolean }
type AlbumRow = {
  id: string
  owner_token: string
  allow_guest_downloads: boolean
  password_hash: string | null
  reveal_at: string | null
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
  // Per-IP, but at an event many guests download from behind one venue-WiFi IP (and a single ZIP
  // download of a big album fetches many blobs). Limits raised so a crowd saving photos isn't
  // throttled: blob (ZIP) 20000/hr, single-photo 600/30s.
  const isBlobMode = url.searchParams.get('blob') === '1'
  const rl = isBlobMode
    ? await checkRateLimit(clientIpKey(req, 'download_blob'), 3600, 200000, { failOpen: false })
    : await checkRateLimit(clientIpKey(req, 'download_photo'), 30, 600, { failOpen: false })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  const admin = createAdminClient()
  const { data: photo, error: photoErr } = await admin
    .from('photos')
    .select('url, storage_path, storage_backend, album_id, hidden')
    .eq('id', photoId)
    .maybeSingle<PhotoRow>()

  if (photoErr) {
    reportServerError('download-photo', 'DB error (500)')
    return NextResponse.json({ error: 'DB error' }, { status: 500, headers: NO_STORE })
  }
  if (!photo) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  }

  const { data: album, error: albumErr } = await admin
    .from('albums')
    .select('id, owner_token, allow_guest_downloads, password_hash, reveal_at, retired_at')
    .eq('id', photo.album_id)
    .maybeSingle<AlbumRow>()

  if (albumErr || !album || album.retired_at) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  }

  const jar = await cookies()
  const ownerCookie = (jar.get(`hushare_owner_${album.id}`)?.value ?? '').trim()
  const isOwner = ownerCookie.length > 0 && timingSafeEqual(ownerCookie, album.owner_token)

  if (!isOwner) {
    // THREE GATES, not one. This route checked the password and nothing else, so the other two
    // ways an album withholds a photo were simply not enforced on the download path — M1 of the
    // 2026-08-20 audit.
    //
    // A COUNTDOWN REVEAL is a promise that nobody sees the album before a set moment. Reading it
    // here costs one column that was already being fetched from the same row.
    if (album.reveal_at && new Date(album.reveal_at) > new Date()) {
      return NextResponse.json({ error: 'This album has not been revealed yet' }, { status: 403, headers: NO_STORE })
    }
    // HIDDEN covers both photo moderation (waiting for the owner's approval) and a photo the owner
    // deliberately took down. The album grid already refuses to show these to a guest; without this
    // the file behind one stayed downloadable to anyone holding its id. "Guest photos wait for your
    // approval before anyone else sees them" is sold on the pricing page and said again in the
    // public statement — a gate that the grid honours and the download does not is not a gate.
    if (photo.hidden) {
      return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
    }
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

  track({
    name: 'media_downloaded',
    albumId: album.id,
    kind: isBlobMode ? 'zip' : 'single',
    source: isOwner ? 'owner' : 'guest',
  })

  if (isBlobMode) {
    // Fetch the asset from R2 server-side and stream bytes directly to the client.
    // This avoids a cross-origin presigned-URL redirect, which would require R2 CORS
    // headers for client-side fetch() to be able to read the response body for ZIP assembly.
    const r2Res = await fetch(signedUrl)
    if (!r2Res.ok || !r2Res.body) {
      reportServerError('download-photo', 'Asset unavailable (502)')
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
