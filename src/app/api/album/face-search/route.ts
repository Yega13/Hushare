import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { searchFacesByImage } from '@/lib/rekognition'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { getUserTierById } from '@/lib/subscriptions'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { track } from '@/lib/analytics'

export const runtime = 'nodejs'
export const maxDuration = 30

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_SELFIE_BYTES = 5 * 1024 * 1024

const SLUG_RE = /^[a-zA-Z0-9._-]{1,200}$/
function isValidSlug(s: string): boolean { return SLUG_RE.test(s) }

// Rekognition calls cost money — rate limits must be shared across Worker instances.
// IP limit is generous because at an event every guest's "find my photos" comes from the same
// venue-WiFi IP; the per-ALBUM limit is the real Rekognition-cost cap (it binds first per event).
const SEARCH_WINDOW_SECONDS = 60
const SEARCH_IP_MAX = 120
const SEARCH_ALBUM_MAX = 120

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden
  try {
    return await handlePost(req)
  } catch (err) {
    // Outer catch so an unexpected Rekognition/AWS error doesn't crash the Worker and return
    // Cloudflare's 503 HTML interstitial (which the client can't parse).
    const name = (err as { name?: string }).name ?? 'Unknown'
    const message = err instanceof Error ? err.message : String(err)
    console.error('[face-search] unhandled:', name, message)
    return NextResponse.json(
      { error: `Face search failed (${name}). Please try again or contact support.` },
      { status: 500, headers: NO_STORE },
    )
  }
}

async function handlePost(req: Request) {
  // failOpen:false — face search invokes paid AWS Rekognition per call. If the rate-limit store
  // is unavailable, deny rather than allow unbounded Rekognition spend against opted-in albums.
  const ipLimit = await checkRateLimit(clientIpKey(req, 'face_search'), SEARCH_WINDOW_SECONDS, SEARCH_IP_MAX, { failOpen: false })
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: 'Too many searches. Please wait a minute and try again.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(ipLimit.retryAfterSeconds) } },
    )
  }

  let slug: string
  let selfieBytes: Uint8Array

  try {
    const form = await req.formData()
    slug = String(form.get('slug') ?? '').trim()
    const file = form.get('selfie')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Missing selfie file' }, { status: 400, headers: NO_STORE })
    }
    if (file.size > MAX_SELFIE_BYTES) {
      return NextResponse.json({ error: 'Selfie too large (max 5MB)' }, { status: 400, headers: NO_STORE })
    }
    selfieBytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE })
  }

  if (!slug || !isValidSlug(slug)) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()

  const { data: album } = await admin
    .from('albums')
    .select('id, user_id, face_finder_enabled')
    .or(`slug.eq.${slug},custom_slug.eq.${slug}`)
    .is('retired_at', null)
    .maybeSingle<{ id: string; user_id: string | null; face_finder_enabled: boolean }>()

  if (!album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }
  if (!album.face_finder_enabled || (await getUserTierById(album.user_id)) !== 'studio') {
    return NextResponse.json({ error: 'Face Finder is not enabled for this album' }, { status: 403, headers: NO_STORE })
  }

  // failOpen:false — same reasoning as the IP-scoped limiter above.
  const albumLimit = await checkRateLimit(`face_search_album:${album.id}`, SEARCH_WINDOW_SECONDS, SEARCH_ALBUM_MAX, { failOpen: false })
  if (!albumLimit.ok) {
    return NextResponse.json(
      { error: 'Too many searches. Please wait a minute and try again.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(albumLimit.retryAfterSeconds) } },
    )
  }

  // Verify there are indexed photos — otherwise the Rekognition collection may not exist yet.
  const { count: indexedCount } = await admin
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('album_id', album.id)
    .not('face_ids', 'is', null)

  if (!indexedCount || indexedCount === 0) {
    return NextResponse.json(
      { error: 'No photos have been indexed yet. Please wait for indexing to complete.' },
      { status: 422, headers: NO_STORE },
    )
  }

  let matches: { photoId: string; similarity: number }[]
  try {
    matches = await searchFacesByImage(album.id, selfieBytes)
  } catch (err: unknown) {
    const name = (err as { name?: string }).name
    const message = err instanceof Error ? err.message : String(err)
    if (name === 'InvalidParameterException') {
      return NextResponse.json(
        { error: 'No face detected in selfie. Try a clearer photo facing the camera.' },
        { status: 422, headers: NO_STORE },
      )
    }
    if (name === 'ResourceNotFoundException') {
      return NextResponse.json(
        { error: 'Album not indexed yet. Please try again in a moment.' },
        { status: 422, headers: NO_STORE },
      )
    }
    console.error('[face-search] Rekognition error:', name, message)
    return NextResponse.json(
      { error: `Face search failed: ${name ?? 'Unknown'} — ${message.slice(0, 200)}` },
      { status: 502, headers: NO_STORE },
    )
  }

  track({ name: 'face_search_run', albumId: album.id, matches: matches.length })

  return NextResponse.json({ matches }, { headers: NO_STORE })
}
