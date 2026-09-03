import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { timingSafeEqual } from '@/lib/timing-safe'
import { canRestore, binState } from '@/lib/album-bin'
import { lookupAlbumIncludingBinned } from '@/lib/album-owner-access'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_SLUG = 80

// PUTTING BACK AN ALBUM THAT IS IN THE BIN.
//
// This is the ONLY route that may look at a binned album, and it exists because every other one
// cannot. verifyOwnerViaCookie filters `retired_at is null` at SQL level — deliberately, so that an
// owner cannot mutate a hidden album — and the bin sets retired_at. Without this route the data
// would sit there for seven days with nobody able to reach it, which is a bin in name only.
//
// THE PROOF IS THE SAME PROOF. The owner cookie, compared to the album's owner_token with
// timingSafeEqual, exactly as album-owner-access does it. Restoring is not a lesser act than
// deleting and does not get a lesser check — and reusing the comparison rather than writing a
// second one is the point (rule 13).
//
// IT CANNOT BE USED TO FIND ALBUMS. Every failure answers the same 404, so the route cannot tell
// an attacker whether a slug exists, whether it is binned, or whether their token was close.
export async function POST(req: Request) {
  const csrf = forbidCrossSiteRequest(req)
  if (csrf) return csrf

  // Bounded before the lookup: this reads a row that ordinary routes refuse to read, so it must not
  // become a way to probe slugs at speed. Fails CLOSED — a limiter we cannot consult refuses.
  const rl = await checkRateLimit(clientIpKey(req, 'album_restore'), 3600, 60, { failOpen: false })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  const body = await req.json().catch(() => null) as { slug?: unknown } | null
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''
  if (!slug || slug.length > MAX_SLUG) {
    return NextResponse.json({ error: 'Missing album' }, { status: 400, headers: NO_STORE })
  }

  // Through the shared lookup, which keeps the charset check that makes the `.or()` safe and the
  // rule that a random slug beats a colliding custom_slug. Writing this query here instead was a
  // filter-injection hole and a coin toss over which album got restored.
  const album = await lookupAlbumIncludingBinned(slug)
  const admin = createAdminClient()

  // One answer for "no such album", "not in the bin", "not yours" and "too late". Anything more
  // specific is a lookup service for album slugs.
  const notFound = NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  if (!album) return notFound

  const cookieStore = await cookies()
  const cookie = (cookieStore.get(`hushare_owner_${album.id}`)?.value ?? '').trim()
  if (!cookie || !timingSafeEqual(cookie, album.owner_token)) return notFound

  if (!canRestore(album.deleted_at, Date.now())) return notFound

  // Both columns cleared together, and ONLY for a row still in the bin: `.not('deleted_at','is',null)`
  // is the race guard. Two restores arriving together must not have the second one un-retire an
  // album that the purge has meanwhile begun to destroy.
  const { data: restored, error: updateErr } = await admin
    .from('albums')
    .update({ deleted_at: null, retired_at: null, last_activity_at: new Date().toISOString() })
    .eq('id', album.id)
    .not('deleted_at', 'is', null)
    .select('id')

  if (updateErr) {
    console.error('[album/restore] update failed for album', album.id, ':', updateErr.message)
    return NextResponse.json({ error: 'Could not restore the album' }, { status: 500, headers: NO_STORE })
  }
  // Zero rows means somebody else restored it first. That is a success from where the owner stands.
  if (!restored || restored.length === 0) {
    return NextResponse.json({ ok: true, alreadyRestored: true }, { headers: NO_STORE })
  }

  console.info('[album/restore] album', album.id, 'restored from the bin')
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}

/** Is this album in the bin, and for how much longer? Used by the owner's "undo" surface. */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const slug = (url.searchParams.get('slug') ?? '').trim()
  if (!slug || slug.length > MAX_SLUG) {
    return NextResponse.json({ error: 'Missing album' }, { status: 400, headers: NO_STORE })
  }

  const album = await lookupAlbumIncludingBinned(slug)

  const nothing = NextResponse.json({ inBin: false }, { headers: NO_STORE })
  if (!album) return nothing

  const cookieStore = await cookies()
  const cookie = (cookieStore.get(`hushare_owner_${album.id}`)?.value ?? '').trim()
  if (!cookie || !timingSafeEqual(cookie, album.owner_token)) return nothing

  const state = binState(album.deleted_at, Date.now())
  if (state.state === 'live') return nothing
  return NextResponse.json(
    { inBin: true, daysLeft: state.state === 'in-bin' ? state.daysLeft : null },
    { headers: NO_STORE },
  )
}
