import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { sendPhotoNotificationEmail } from '@/lib/email'
import { streamVideoUrls } from '@/lib/cloudflare/stream'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Cloudflare Stream UIDs are always exactly 32 lowercase hex chars — no /i flag intentional
const STREAM_UID_RE = /^[a-f0-9]{32}$/

const MAX_PHOTOS_PER_CALL = 200
const MAX_ALBUM_PHOTOS = 10_000
const MAX_CAPTION_LEN = 30
const MAX_AUTHOR_NAME_LEN = 16

type PhotoInput = {
  storage_backend: unknown
  media_type: unknown
  storage_path?: unknown
  url?: unknown
  thumb_url?: unknown
  stream_uid?: unknown
  poster_url?: unknown
  duration_seconds?: unknown
  caption?: unknown
  author_name?: unknown
}

type Body = {
  albumId?: unknown
  photos?: unknown
}

type AlbumRow = {
  id: string
  user_id: string | null
  guest_uploads_enabled: boolean
  title: string
  slug: string
}

function r2UrlPrefix(host: string, albumId: string, prefix: 'albums' | 'thumbs') {
  return `https://${host}/${prefix}/${albumId}/`
}

function hasTraversal(s: string): boolean {
  // Check literal "..", null bytes, backslash (Windows path separator), URL-encoded variants
  if (s.includes('..') || s.includes('\x00') || s.includes('%00') || s.includes('\\')) return true
  const lower = s.toLowerCase()
  return lower.includes('%2e%2e') || lower.includes('%2e.') || lower.includes('.%2e')
    || lower.includes('%25') || lower.includes('%2f') || lower.includes('%5c')
}

function validatePhoto(
  photo: PhotoInput,
  index: number,
  albumId: string,
  r2Host: string,
): string | null {
  const { storage_backend, media_type } = photo

  if (storage_backend !== 'r2' && storage_backend !== 'stream') {
    return `photos[${index}]: storage_backend must be "r2" or "stream"`
  }
  if (media_type !== 'image' && media_type !== 'video') {
    return `photos[${index}]: media_type must be "image" or "video"`
  }
  if (storage_backend === 'stream' && media_type !== 'video') {
    return `photos[${index}]: stream backend only supports media_type "video"`
  }
  if (storage_backend === 'r2' && media_type !== 'image') {
    return `photos[${index}]: r2 backend only supports media_type "image"`
  }
  if (typeof photo.caption === 'string' && photo.caption.length > MAX_CAPTION_LEN) {
    return `photos[${index}]: caption exceeds ${MAX_CAPTION_LEN} chars`
  }
  if (typeof photo.author_name === 'string' && photo.author_name.length > MAX_AUTHOR_NAME_LEN) {
    return `photos[${index}]: author_name exceeds ${MAX_AUTHOR_NAME_LEN} chars`
  }

  const albumsPrefix = r2UrlPrefix(r2Host, albumId, 'albums')
  const thumbsPrefix = r2UrlPrefix(r2Host, albumId, 'thumbs')

  if (storage_backend === 'r2') {
    if (
      typeof photo.storage_path !== 'string' ||
      photo.storage_path.length > 512 ||
      !photo.storage_path.startsWith(`albums/${albumId}/`) ||
      hasTraversal(photo.storage_path)
    ) {
      return `photos[${index}]: storage_path must start with "albums/${albumId}/" and must not contain ".."`
    }
    if (
      typeof photo.url !== 'string' ||
      photo.url.length > 2048 ||
      !photo.url.startsWith(albumsPrefix) ||
      hasTraversal(photo.url)
    ) {
      return `photos[${index}]: url must start with "${albumsPrefix}" and must not contain ".."`
    }
    if (
      photo.thumb_url != null &&
      (typeof photo.thumb_url !== 'string' ||
        photo.thumb_url.length > 2048 ||
        (!photo.thumb_url.startsWith(thumbsPrefix) && !photo.thumb_url.startsWith(albumsPrefix)) ||
        hasTraversal(photo.thumb_url))
    ) {
      return `photos[${index}]: thumb_url must start with "${thumbsPrefix}" or "${albumsPrefix}" and must not contain ".."`
    }
  } else {
    if (typeof photo.stream_uid !== 'string' || !STREAM_UID_RE.test(photo.stream_uid)) {
      return `photos[${index}]: stream_uid must be a 32-character lowercase hex string`
    }
    if (
      photo.poster_url != null &&
      (typeof photo.poster_url !== 'string' ||
        photo.poster_url.length > 2048 ||
        (!photo.poster_url.startsWith(albumsPrefix) && !photo.poster_url.startsWith(thumbsPrefix)) ||
        hasTraversal(photo.poster_url))
    ) {
      return `photos[${index}]: poster_url must start with "${albumsPrefix}" or "${thumbsPrefix}" and must not contain ".."`
    }
    if (
      photo.duration_seconds != null &&
      (typeof photo.duration_seconds !== 'number' ||
        !Number.isFinite(photo.duration_seconds) ||
        photo.duration_seconds <= 0)
    ) {
      return `photos[${index}]: duration_seconds must be a positive number`
    }
  }

  return null
}

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const ipRl = await checkRateLimit(clientIpKey(req, 'photos_create_ip'), 3600, 500, { failOpen: false })
  if (!ipRl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(ipRl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  const body = await req.json().catch(() => null) as Body | null
  const { albumId, photos } = body ?? {}

  if (typeof albumId !== 'string' || !UUID_RE.test(albumId)) {
    return NextResponse.json({ error: 'Invalid albumId' }, { status: 400, headers: NO_STORE })
  }
  if (!Array.isArray(photos) || photos.length === 0) {
    return NextResponse.json({ error: 'photos must be a non-empty array' }, { status: 400, headers: NO_STORE })
  }
  if (photos.length > MAX_PHOTOS_PER_CALL) {
    return NextResponse.json({ error: `Max ${MAX_PHOTOS_PER_CALL} photos per call` }, { status: 400, headers: NO_STORE })
  }

  // Strip scheme if present — R2_PUBLIC_HOST may be set as "https://..." in some envs
  const r2Host = (process.env.R2_PUBLIC_HOST ?? '').trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
  if (!r2Host) {
    console.error('[photos/create] R2_PUBLIC_HOST not set')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500, headers: NO_STORE })
  }

  for (let i = 0; i < photos.length; i++) {
    const err = validatePhoto(photos[i] as PhotoInput, i, albumId, r2Host)
    if (err) return NextResponse.json({ error: err }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()

  const { data: album, error: albumError } = await admin
    .from('albums')
    .select('id, user_id, guest_uploads_enabled, title, slug')
    .eq('id', albumId)
    .is('retired_at', null)
    .maybeSingle<AlbumRow>()

  if (albumError) {
    console.error('[photos/create] album lookup failed:', albumError.message)
    return NextResponse.json({ error: 'Service error' }, { status: 500, headers: NO_STORE })
  }
  if (!album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }
  if (!album.guest_uploads_enabled) {
    return NextResponse.json({ error: 'Uploads disabled for this album' }, { status: 403, headers: NO_STORE })
  }

  const albumRl = await checkRateLimit(`photos_create_album:${albumId}`, 3600, 5000, { failOpen: false })
  if (!albumRl.ok) {
    return NextResponse.json(
      { error: 'Album upload rate limit reached' },
      { status: 429, headers: { 'Retry-After': String(albumRl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  // Hard cap: prevent storage exhaustion via unlimited guest uploads
  const { count: photoCount, error: countErr } = await admin
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('album_id', albumId)
  if (!countErr && photoCount != null && photoCount >= MAX_ALBUM_PHOTOS) {
    return NextResponse.json({ error: 'Album photo limit reached' }, { status: 429, headers: NO_STORE })
  }

  // Targeted dedup: only query for the specific paths/uids we're about to insert
  const incomingPaths = (photos as PhotoInput[])
    .filter(p => p.storage_backend === 'r2')
    .map(p => p.storage_path as string)

  const incomingUids = (photos as PhotoInput[])
    .filter(p => p.storage_backend === 'stream')
    .map(p => p.stream_uid as string)

  const [pathCheck, uidCheck] = await Promise.all([
    incomingPaths.length > 0
      ? admin.from('photos').select('storage_path').eq('album_id', albumId).in('storage_path', incomingPaths)
      : Promise.resolve({ data: [] as { storage_path: string }[], error: null }),
    incomingUids.length > 0
      ? admin.from('photos').select('stream_uid').eq('album_id', albumId).in('stream_uid', incomingUids)
      : Promise.resolve({ data: [] as { stream_uid: string }[], error: null }),
  ])

  if (pathCheck.error || uidCheck.error) {
    console.error('[photos/create] dedup query failed:', (pathCheck.error ?? uidCheck.error)?.message)
    return NextResponse.json({ error: 'Failed to process photos' }, { status: 500, headers: NO_STORE })
  }

  const existingPaths = new Set(pathCheck.data.map(r => r.storage_path))
  const existingUids = new Set(uidCheck.data.map(r => r.stream_uid))

  const toInsert = (photos as PhotoInput[]).filter(p => {
    if (p.storage_backend === 'r2') return !existingPaths.has(p.storage_path as string)
    if (p.storage_backend === 'stream') return !existingUids.has(p.stream_uid as string)
    return false
  })

  const skipped = photos.length - toInsert.length

  if (toInsert.length === 0) {
    return NextResponse.json({ inserted: 0, skipped }, { headers: NO_STORE })
  }

  const rows = toInsert.map(p => {
    if (p.storage_backend === 'stream') {
      const uid = p.stream_uid as string
      return {
        album_id: albumId,
        storage_backend: 'stream' as const,
        media_type: 'video' as const,
        stream_uid: uid,
        ...streamVideoUrls(uid),
        poster_url: typeof p.poster_url === 'string' ? p.poster_url : null,
        // DB column is integer; duration from client is a float
        duration_seconds: typeof p.duration_seconds === 'number' ? Math.round(p.duration_seconds) : null,
        caption: typeof p.caption === 'string' ? p.caption.trim() : null,
        author_name: typeof p.author_name === 'string' ? p.author_name.trim() : null,
      }
    }
    return {
      album_id: albumId,
      storage_backend: 'r2' as const,
      media_type: 'image' as const,
      storage_path: p.storage_path as string,
      url: p.url as string,
      thumb_url: typeof p.thumb_url === 'string' ? p.thumb_url : null,
      caption: typeof p.caption === 'string' ? p.caption.trim() : null,
      author_name: typeof p.author_name === 'string' ? p.author_name.trim() : null,
    }
  })

  // Verify stream_uid → albumId binding: each UID must have been issued by
  // /api/upload/stream for THIS album. Prevents cross-album stream UID injection.
  // Deduplicate first so a batch with the same uid twice doesn't burn two pending tokens.
  const streamUidsToVerify = [...new Set(
    (toInsert as PhotoInput[])
      .filter(p => p.storage_backend === 'stream')
      .map(p => p.stream_uid as string),
  )]

  if (streamUidsToVerify.length > 0) {
    // Atomic DELETE+RETURNING: verify and consume in one statement.
    // A plain SELECT-then-DELETE TOCTOU allows two concurrent requests to both pass
    // the SELECT check before either fires the DELETE.
    // Reject tokens older than 24h — they were never completed.
    const tokenTtlCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: consumed, error: consumeErr } = await admin
      .from('pending_stream_uploads')
      .delete()
      .in('stream_uid', streamUidsToVerify)
      .eq('album_id', albumId)
      .gte('created_at', tokenTtlCutoff)
      .select('stream_uid')
    if (consumeErr) {
      console.error('[photos/create] pending_stream_uploads consume failed:', consumeErr.message)
      return NextResponse.json({ error: 'Failed to process photos' }, { status: 500, headers: NO_STORE })
    }
    const verified = new Set((consumed ?? []).map((r: { stream_uid: string }) => r.stream_uid))
    for (const uid of streamUidsToVerify) {
      if (!verified.has(uid)) {
        return NextResponse.json({ error: 'stream_uid not issued for this album' }, { status: 403, headers: NO_STORE })
      }
    }
  }

  // Split by backend. Both use upsert+ignoreDuplicates: R2 has unique(album_id,storage_path),
  // stream now has unique(album_id,stream_uid) — concurrent races never abort the whole batch.
  const r2Rows = rows.filter(r => r.storage_backend === 'r2')
  const streamRows = rows.filter(r => r.storage_backend === 'stream')

  let insertedCount = 0

  if (r2Rows.length > 0) {
    const { data, error } = await admin
      .from('photos')
      .upsert(r2Rows, { onConflict: 'album_id,storage_path', ignoreDuplicates: true })
      .select('id')
    if (error) {
      console.error('[photos/create] r2 upsert failed:', error.message)
      return NextResponse.json({ error: 'Failed to save photos' }, { status: 500, headers: NO_STORE })
    }
    insertedCount += (data ?? []).length
  }

  if (streamRows.length > 0) {
    const { data, error } = await admin
      .from('photos')
      .upsert(streamRows, { onConflict: 'album_id,stream_uid', ignoreDuplicates: true })
      .select('id')
    if (error) {
      console.error('[photos/create] stream upsert failed:', error.message)
      return NextResponse.json({ error: 'Failed to save photos' }, { status: 500, headers: NO_STORE })
    }
    insertedCount += (data ?? []).length
  }

  const inserted = insertedCount

  void (async () => {
    try {
      if (inserted === 0) return
      if (!album.user_id) return
      const { data: userData } = await admin.auth.admin.getUserById(album.user_id)
      const email = userData?.user?.email
      if (!email) return
      const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space').replace(/\/+$/, '')
      const albumUrl = `${siteUrl}/${album.slug}`
      await sendPhotoNotificationEmail(email, album.title, albumUrl, inserted)
    } catch (e) {
      console.warn('[photos/create] notification email failed:', e instanceof Error ? e.message : String(e))
    }
  })()

  // Recompute skipped from actual insertedCount — the pre-insert dedup may undercount
  // if the upsert's ignoreDuplicates silently handled a concurrent race
  return NextResponse.json({ inserted, skipped: photos.length - inserted }, { headers: NO_STORE })
}
