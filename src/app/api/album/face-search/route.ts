import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ALBUM_GATE_COLS, FACE_MATCH_PHOTO_COLS, gateAllowsContribution } from '@/lib/server/album-access'
import { timingSafeEqual } from '@/lib/timing-safe'
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
    // The GATE columns as well as the feature ones — see the gate check below.
    .select(`id, user_id, face_finder_enabled, ${ALBUM_GATE_COLS}`)
    .or(`slug.eq.${slug},custom_slug.eq.${slug}`)
    .is('retired_at', null)
    .maybeSingle<{ id: string; user_id: string | null; face_finder_enabled: boolean } & Parameters<typeof gateAllowsContribution>[0]>()

  if (!album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }
  if (!album.face_finder_enabled || (await getUserTierById(album.user_id)) !== 'studio') {
    return NextResponse.json({ error: 'Face Finder is not enabled for this album' }, { status: 403, headers: NO_STORE })
  }

  // THE PASSWORD AND REVEAL GATE APPLIES HERE TOO, and it was missing.
  //
  // This route ran a face search against the album's Rekognition collection knowing only the slug —
  // no password, no reveal, no owner link. Proved against a live password-protected album on
  // 2026-08-28: execution reached AWS with no password cookie present.
  //
  // What that leaked is exactly what a password is bought to withhold: an attacker could upload a
  // photo of a specific person and be told whether that person appears in a locked album, plus the
  // matching photo ids and similarity scores. Biometric confirmation about someone who never
  // consented, on an album its owner had deliberately closed — and it spent the owner's Rekognition
  // budget doing it.
  //
  // face-index GET already had this exact check, with a comment explaining why. This is its sibling
  // and it was missed. Same two lines, deliberately identical so the pair cannot drift again.
  const cookieStore = await cookies()
  const gate = await gateAllowsContribution(album, cookieStore)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 403, headers: NO_STORE })

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


  // THE PHOTOS COME BACK WITH THE MATCH, not just their ids.
  //
  // Face Finder used to take these ids and look each one up in the photos the album page had
  // loaded, dropping any it could not find. On an album that pages its photos in, that silently
  // deleted real results — a runner matched in 40 photos was shown the 28 that happened to be
  // loaded and told nothing about the rest. Sending the rows themselves makes the answer complete
  // regardless of what the page holds, and it is a small payload: a match list is tens of photos,
  // not thousands.
  //
  // Guests never receive hidden photos (pending approval, or hidden by the owner). The owner does,
  // because that is what they see everywhere else in their own album.
  const ownerCookie = (cookieStore.get(`hushare_owner_${album.id}`)?.value ?? '').trim()
  const isOwner = ownerCookie.length > 0 && timingSafeEqual(ownerCookie, album.owner_token)
  let photos: { id: string }[] = []
  if (matches.length > 0) {
    let photoQuery = admin
      .from('photos')
      .select(FACE_MATCH_PHOTO_COLS)
      .eq('album_id', album.id)
      .in('id', matches.map((m) => m.photoId))
    if (!isOwner) photoQuery = photoQuery.eq('hidden', false)
    const { data, error: photoError } = await photoQuery
    if (photoError) {
      // An answer we cannot stand behind is worse than no answer: returning the ids alone would let
      // the client show a confident undercount. The guest gets "try again", which is true.
      console.error('[album/face-search] match photo fetch failed:', photoError.message)
      return NextResponse.json({ error: 'Could not load your photos. Please try again.' }, { status: 500, headers: NO_STORE })
    }
    photos = (data ?? []) as unknown as { id: string }[]
  }

  // THE MATCH LIST IS CUT DOWN TO THE PHOTOS THE CALLER MAY ACTUALLY SEE.
  //
  // Rekognition answers from its own face collection, which knows nothing about `hidden` and still
  // holds faces from photos that have since been deleted. Returning that raw list alongside a
  // filtered photo list told the guest exactly how many results they were not being shown — the
  // count of photos the owner hid or left pending approval, which is the one thing `hidden` exists
  // to withhold. It also promised those photos were "still loading" when they were never coming.
  //
  // Filtering here rather than in the client means the number the guest sees is the number of
  // photos that exist for them, and every id they receive resolves to one.
  const visibleIds = new Set(photos.map((p) => p.id))
  const visibleMatches = matches.filter((m) => visibleIds.has(m.photoId))

  // Tracked AFTER the filter: the number worth knowing is how many photos the guest was actually
  // shown, not how many rows Rekognition returned before the album's own rules were applied.
  track({ name: 'face_search_run', albumId: album.id, matches: visibleMatches.length })

  return NextResponse.json({ matches: visibleMatches, photos }, { headers: NO_STORE })
}
