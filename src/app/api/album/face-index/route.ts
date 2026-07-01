import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureCollection, indexPhotoFaces } from '@/lib/rekognition'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { getUserTierById } from '@/lib/subscriptions'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' }

// Validate slugs before embedding them in PostgREST .or() filters. A bare interpolation like
// `slug.eq.${slug}` is injectable: a slug with commas/operators would add extra filter arms.
const SLUG_RE = /^[a-zA-Z0-9._-]{1,200}$/
function isValidSlug(s: string): boolean { return SLUG_RE.test(s) }

// Rekognition calls cost money — rate limits must be shared across Worker instances.
const INDEX_WINDOW_SECONDS = 10 * 60
const INDEX_IP_MAX = 600
const INDEX_ALBUM_MAX = 1000

// Index from the 600px thumbnail when available (small = fast base64/sign, within the 5MB
// Rekognition direct-bytes limit, faces still ~60px in a group). Fall back to the full image.
function faceIndexImageUrl(photo: { thumb_url: string | null; url: string | null }): string | null {
  return photo.thumb_url ?? photo.url ?? null
}

async function resolveAlbum(slug: string) {
  const admin = createAdminClient()
  const { data: album } = await admin
    .from('albums')
    .select('id, user_id, face_finder_enabled')
    .or(`slug.eq.${slug},custom_slug.eq.${slug}`)
    .is('retired_at', null)
    .maybeSingle<{ id: string; user_id: string | null; face_finder_enabled: boolean }>()
  return { admin, album }
}

async function faceFinderAvailable(album: { user_id: string | null; face_finder_enabled: boolean }): Promise<boolean> {
  if (!album.face_finder_enabled) return false
  return (await getUserTierById(album.user_id)) === 'studio'
}

function rateLimitResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: 'Too many requests. Please wait a few minutes and try again.' },
    { status: 429, headers: { ...NO_STORE, 'Retry-After': String(retryAfterSeconds) } },
  )
}

// GET: returns all unindexed image photo IDs so the client can fan out concurrent indexing.
// Read-only, no cost → no owner auth. Only POST (paid Rekognition calls) is owner-gated.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const slug = url.searchParams.get('slug')?.trim() ?? ''
  if (!slug || !isValidSlug(slug)) return NextResponse.json({ error: 'Invalid slug' }, { status: 400, headers: NO_STORE })

  const ipLimit = await checkRateLimit(clientIpKey(req, 'face_index_list'), 60, 30, { failOpen: true })
  if (!ipLimit.ok) return rateLimitResponse(ipLimit.retryAfterSeconds)

  const { admin, album } = await resolveAlbum(slug)
  if (!album) return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  if (!await faceFinderAvailable(album)) {
    return NextResponse.json({ error: 'Face Finder is not enabled for this album' }, { status: 403, headers: NO_STORE })
  }

  await ensureCollection(album.id)

  const { data: unindexed } = await admin
    .from('photos')
    .select('id')
    .eq('album_id', album.id)
    .is('face_ids', null)
    .neq('media_type', 'video')
    .order('created_at', { ascending: true })

  const { count: total } = await admin
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('album_id', album.id)
    .neq('media_type', 'video')

  return NextResponse.json(
    { ids: unindexed?.map((p) => p.id) ?? [], total: total ?? 0 },
    { headers: NO_STORE },
  )
}

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden
  try {
    return await handlePost(req)
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    console.error('[face-index] unhandled:', msg)
    return NextResponse.json({ error: msg }, { status: 500, headers: NO_STORE })
  }
}

async function handlePost(req: Request) {
  let body: { slug?: string; photoId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  if (!slug || !isValidSlug(slug)) return NextResponse.json({ error: 'Invalid slug' }, { status: 400, headers: NO_STORE })

  const ipLimit = await checkRateLimit(clientIpKey(req, 'face_index'), INDEX_WINDOW_SECONDS, INDEX_IP_MAX, { failOpen: true })
  if (!ipLimit.ok) return rateLimitResponse(ipLimit.retryAfterSeconds)

  // NOT owner-gated: the Face Finder is guest-facing, so a guest (with no owner cookie) must be
  // able to trigger indexing. This is safe because indexing only runs on albums the owner
  // explicitly opted into (face_finder_enabled + Studio), each photo is indexed at most once
  // (face_ids is then set, so repeat calls are no-ops), and the per-IP/per-album rate limits
  // below bound the one-time cost the owner already opted into by enabling the feature.
  const { admin, album } = await resolveAlbum(slug)
  if (!album) return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  if (!await faceFinderAvailable(album)) {
    return NextResponse.json({ error: 'Face Finder is not enabled for this album' }, { status: 403, headers: NO_STORE })
  }

  const albumLimit = await checkRateLimit(`face_index_album:${album.id}`, INDEX_WINDOW_SECONDS, INDEX_ALBUM_MAX, { failOpen: true })
  if (!albumLimit.ok) return rateLimitResponse(albumLimit.retryAfterSeconds)

  const photoId = body.photoId ? String(body.photoId).trim() : null

  if (photoId) {
    // Targeted mode: process exactly one photo (called by concurrent FaceFinder workers)
    const { data: photo } = await admin
      .from('photos')
      .select('id, url, thumb_url, face_ids')
      .eq('id', photoId)
      .eq('album_id', album.id)
      .maybeSingle<{ id: string; url: string | null; thumb_url: string | null; face_ids: string[] | null }>()

    if (!photo) return NextResponse.json({ error: 'Photo not found' }, { status: 404, headers: NO_STORE })
    if (photo.face_ids !== null) return NextResponse.json({ indexed: 0 }, { headers: NO_STORE })

    const imageUrl = faceIndexImageUrl(photo)
    if (!imageUrl) {
      await admin.from('photos').update({ face_ids: [] }).eq('id', photo.id)
      return NextResponse.json({ indexed: 0 }, { headers: NO_STORE })
    }
    try {
      const faceIds = await indexPhotoFaces(album.id, photo.id, imageUrl)
      await admin.from('photos').update({ face_ids: faceIds }).eq('id', photo.id)
      return NextResponse.json({ indexed: 1 }, { headers: NO_STORE })
    } catch (err) {
      const name = (err as { name?: string }).name ?? 'Unknown'
      const message = err instanceof Error ? err.message : String(err)
      console.error('[face-index] indexPhotoFaces failed:', photo.id, name, message)
      // Mark unindexable (face_ids = []) so it isn't retried forever.
      await admin.from('photos').update({ face_ids: [] }).eq('id', photo.id)
      return NextResponse.json({ indexed: 0 }, { headers: NO_STORE })
    }
  }

  // Fallback scan mode: one photo at a time to stay within the Worker time limit.
  const { data: photos } = await admin
    .from('photos')
    .select('id, url, thumb_url')
    .eq('album_id', album.id)
    .is('face_ids', null)
    .neq('media_type', 'video')
    .limit(1)

  const toIndex = photos ?? []

  const { count: remaining } = await admin
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('album_id', album.id)
    .is('face_ids', null)
    .neq('media_type', 'video')

  let indexed = 0
  for (const photo of toIndex) {
    const imageUrl = faceIndexImageUrl(photo)
    if (!imageUrl) {
      await admin.from('photos').update({ face_ids: [] }).eq('id', photo.id)
      continue
    }
    try {
      const faceIds = await indexPhotoFaces(album.id, photo.id, imageUrl)
      await admin.from('photos').update({ face_ids: faceIds }).eq('id', photo.id)
      indexed++
    } catch (err) {
      const name = (err as { name?: string }).name ?? 'Unknown'
      const message = err instanceof Error ? err.message : String(err)
      console.error('[face-index/fallback] indexPhotoFaces failed:', photo.id, name, message)
      await admin.from('photos').update({ face_ids: [] }).eq('id', photo.id)
    }
  }

  return NextResponse.json(
    { indexed, remaining: Math.max(0, (remaining ?? 0) - toIndex.length) },
    { headers: NO_STORE },
  )
}
