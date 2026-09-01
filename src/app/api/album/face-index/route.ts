import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ALBUM_GATE_COLS, gateAllowsContribution } from '@/lib/server/album-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureCollection, indexPhotoFaces } from '@/lib/rekognition'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { albumHasTier } from '@/lib/require-tier'
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
    .select(`id, user_id, face_finder_enabled, ${ALBUM_GATE_COLS}`)
    .or(`slug.eq.${slug},custom_slug.eq.${slug}`)
    .is('retired_at', null)
    .maybeSingle<{
      id: string; user_id: string | null; face_finder_enabled: boolean
      owner_token: string; password_hash: string | null; reveal_at: string | null
    }>()
  return { admin, album }
}

async function faceFinderAvailable(album: { id: string; user_id: string | null; face_finder_enabled: boolean }): Promise<boolean> {
  if (!album.face_finder_enabled) return false
  // The ALBUM'S entitlement, package included. Owner-tier here meant a Max Package album's
  // toggle switched on (that route is package-aware) while indexing refused every photo —
  // a switch that works wired to a feature that never runs.
  return albumHasTier(album, 'studio')
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

  // 30/min per IP was the LOWEST limit in the product, and 400 guests at a venue share one
  // public IP — so Face Finder died for the whole room after the 30th person opened it, on a
  // dead-end error screen with no retry. Every sibling limit was raised for this exact reason
  // (album_photos 20000, presence 3000, album_resolve 900); this one was missed.
  //
  // The AWS spend this was protecting is bounded by the ALBUM limiter on the POST that actually
  // indexes, not by reads of a photo-id list. failOpen stays false because this GET still calls
  // ensureCollection(), which touches Rekognition.
  const ipLimit = await checkRateLimit(clientIpKey(req, 'face_index_list'), 60, 2000, { failOpen: false })
  if (!ipLimit.ok) return rateLimitResponse(ipLimit.retryAfterSeconds)

  const { admin, album } = await resolveAlbum(slug)
  if (!album) return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  if (!await faceFinderAvailable(album)) {
    return NextResponse.json({ error: 'Face Finder is not enabled for this album' }, { status: 403, headers: NO_STORE })
  }

  // The album's password / reveal gate applies HERE too.
  //
  // This returned every unindexed photo id and the album's exact photo count after checking only
  // that the slug existed and Face Finder was on. For a PASSWORD-PROTECTED album that is precisely
  // the metadata the password withholds, and for a pre-reveal album it leaks the count before the
  // reveal. The photos RLS policy (album_is_open) exists to stop anonymous reads of protected
  // albums; reaching for the admin client here stepped around that model instead of implementing
  // it. Every other read path gates on exactly this.
  const gate = await gateAllowsContribution(album, await cookies())
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 403, headers: NO_STORE })

  try {
    // ensureCollection hits AWS Rekognition — surface its error instead of letting an
    // unhandled throw become an opaque 500 (Cloudflare HTML interstitial).
    await ensureCollection(album.id)

    // EXPLICIT limit, because PostgREST silently caps an un-ranged select at 1000 rows. Without
    // it, an album with 3,000 unindexed photos returned 1,000 ids beside a total of 4,566, and
    // the client computed "already indexed = 3,566" and displayed 100% — while 2,000 photos had
    // never been looked at and the selfie search then confidently found nobody in them (rule 20,
    // on the primary path). Naming the cap makes the number honest: `remaining` below reports
    // the true outstanding count, so the client can show real progress across several passes.
    const FACE_LIST_MAX = 1000
    const { data: unindexed } = await admin
      .from('photos')
      .select('id')
      .eq('album_id', album.id)
      .is('face_ids', null)
      .neq('media_type', 'video')
      .order('created_at', { ascending: true })
      .limit(FACE_LIST_MAX)

    // TWO counts, because `ids` is a capped page and not the whole outstanding set. The client
    // used to infer "already indexed" as total - ids.length, which reads a truncated page as a
    // finished job and reports 100%. `remaining` is counted in the database, so the client can
    // say what is genuinely left and come back for another page.
    const [{ count: total }, { count: remaining }] = await Promise.all([
      admin.from('photos').select('id', { count: 'exact', head: true })
        .eq('album_id', album.id).neq('media_type', 'video'),
      admin.from('photos').select('id', { count: 'exact', head: true })
        .eq('album_id', album.id).neq('media_type', 'video').is('face_ids', null),
    ])

    return NextResponse.json(
      {
        ids: unindexed?.map((p) => p.id) ?? [],
        total: total ?? 0,
        remaining: remaining ?? 0,
        // True when this response is a PAGE rather than the whole outstanding set, so the client
        // knows to ask again instead of concluding it has finished.
        more: (remaining ?? 0) > (unindexed?.length ?? 0),
      },
      { headers: NO_STORE },
    )
  } catch (err) {
    const name = (err as { name?: string }).name ?? 'Unknown'
    const message = err instanceof Error ? err.message : String(err)
    console.error('[face-index GET] setup failed:', name, message)
    return NextResponse.json(
      { error: `Face Finder setup failed: ${name} — ${message.slice(0, 200)}` },
      { status: 502, headers: NO_STORE },
    )
  }
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

  // failOpen:false — indexPhotoFaces below is a paid Rekognition call per photo.
  const ipLimit = await checkRateLimit(clientIpKey(req, 'face_index'), INDEX_WINDOW_SECONDS, INDEX_IP_MAX, { failOpen: false })
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

  // The album's password / reveal gate applies to the WRITE path too — the GET above gates and
  // this did not. Without it, anyone who knows the slug of a password-protected or pre-reveal
  // album could spend the owner's Rekognition budget and enroll biometric face templates for
  // people in photos they are not allowed to see, and read back the album's unindexed count.
  // Third sibling of the same omission; the other two were fixed and this one was missed.
  const gate = await gateAllowsContribution(album, await cookies())
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 403, headers: NO_STORE })

  // failOpen:false — same reasoning as the IP-scoped limiter above.
  const albumLimit = await checkRateLimit(`face_index_album:${album.id}`, INDEX_WINDOW_SECONDS, INDEX_ALBUM_MAX, { failOpen: false })
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
      // LEFT NULL, so a later pass retries. [] is the sentinel for "looked at, found nobody",
      // and writing it here made a TRANSIENT failure permanently mark a photo as face-free —
      // silent data loss, and a runner who is in that photo can never be found in it again.
      // lib/server/face-sweep.ts fixed exactly this and said so in a comment; the browser-driven
      // path kept the bug (rule 13: one fact, two authors). It matters at event scale because
      // every phone runs 8 concurrent indexers, so AWS throttling is normal, not exceptional.
      // A genuinely unreadable image still resolves: indexPhotoFaces RETURNS [] rather than
      // throwing when AWS reads the image and finds no face.
      return NextResponse.json({ indexed: 0, retryable: true }, { headers: NO_STORE })
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
      // LEFT NULL so a later pass retries. [] means "looked at, found nobody" — writing it on a
      // thrown error marks a photo face-free forever, and nothing ever revisits a non-NULL
      // face_ids, so a runner in that photo can never be found in it again.
      //
      // THIRD copy of this rule. lib/server/face-sweep.ts fixed it and explained why; the
      // targeted branch above was fixed today and its comment claimed the consolidation was
      // complete; this scan still had it. The two writes that DO set [] here are correct — a
      // photo with no url and no thumb_url can never be indexed, which is a real permanent
      // answer rather than a failure.
    }
  }

  return NextResponse.json(
    { indexed, remaining: Math.max(0, (remaining ?? 0) - toIndex.length) },
    { headers: NO_STORE },
  )
}
