import { NextResponse } from 'next/server'
import { refuseAccess, serverError } from '@/lib/server/respond'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { refuseBelowTier } from '@/lib/require-tier'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { queueAlbumSettingsBroadcast } from '@/lib/broadcast'
import { exclusionCandidates, normalizeExclusions, type NumberTally } from '@/lib/bib-exclusions'

export const runtime = 'nodejs'

/** The owner row this route reads: the base plus the one extra column it asks for. */
type OwnerAlbumWithExclusions = {
  id: string; owner_token: string; user_id: string | null
  bib_excluded_numbers: string[]
}

const NO_STORE = { 'Cache-Control': 'no-store' }

// THE OWNER'S SIGNAGE LIST — the half of bib search a rule cannot do.
//
// lib/bib-filter refuses any number sharing its OCR line, which removes the billboards and the
// dated banners: 96.3% of the noise, measured. What survives is a number printed ALONE, and a year
// across a finish arch is typographically identical to a bib on a chest. On the measured race about
// 75 photographs still answer to 2026 -- which is also inside that album's own 2xxx bib series, so
// no range can remove it without removing runners too.
//
// FREQUENCY NOMINATES; A PERSON DECIDES. On the 69-photo album the banner year and the real bib
// 00663 each appeared on exactly 4 photographs, and 20260814_bib_range.sql recorded that warning
// before anyone tried it. A threshold safe on 4,566 photos sits below the entire real-bib
// population on 69, because a runner appears on 1-4 photographs whatever the album size. So this
// route offers counts and takes an answer; it never decides.
//
// The list is applied at SEARCH time (lib/bib-match, both halves), so saving it re-filters every
// photograph at once -- no re-index, no re-OCR, and no window where the album says "no photos".

/** GET: what to show the owner — the most-seen numbers, and what they have already excluded. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const slug = searchParams.get('slug')
  if (!slug) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }

  // Owner-only. The tallies are not secret, but an album's numbers should not be enumerable by
  // anyone who merely knows the slug.
  const access = await verifyOwnerViaCookieWithRateLimit<OwnerAlbumWithExclusions>(
    req, slug.trim(), 'bib_excluded_numbers')
  if (!access.ok) return refuseAccess(access)

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('album_bib_tallies', {
    p_album_id: access.album.id,
    p_limit: 100,
  })
  if (error) {
    return serverError('album/bib-exclusions', error.message, {
      albumId: access.album.id, publicMessage: 'Could not read this album\'s numbers',
    })
  }

  const excluded = access.album.bib_excluded_numbers ?? []
  // COUNTED in SQL, RANKED in lib. The database returns raw tallies and nothing else; which of them
  // are worth putting in front of a person is a decision, and it lives with its tests.
  const tallies: NumberTally[] = (data ?? []).map((r) => ({ number: r.number, photos: Number(r.photos) }))
  return NextResponse.json(
    { candidates: exclusionCandidates(tallies, excluded), excluded },
    { headers: NO_STORE },
  )
}

/** POST: replace the list. */
export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; excluded?: unknown } | null
  const { slug, excluded } = body ?? {}
  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }
  if (!Array.isArray(excluded)) {
    return NextResponse.json({ error: 'excluded must be an array' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit<OwnerAlbumWithExclusions>(
    req, slug.trim(), 'bib_excluded_numbers')
  if (!access.ok) return refuseAccess(access)

  // Canonical numeric form, de-duplicated and bounded, before anything compares or stores it. The
  // column carries the same ceiling, because this route is reachable by anyone holding an owner
  // link and a guard that exists only in TypeScript is a guard the database does not have.
  const next = normalizeExclusions(excluded)
  const current = access.album.bib_excluded_numbers ?? []

  // ONE DIRECTION ONLY (tests/gate-direction). Adding an exclusion uses the paid feature and is
  // gated; REMOVING one must always work. A gate that runs both ways freezes a wrong exclusion onto
  // the album of an owner who has left the plan -- and a wrong exclusion hides a runner's own
  // photographs from them, which is the one mistake here nobody would ever report.
  const addsSomething = next.some((n) => !current.includes(n))
  if (addsSomething) {
    const refusal = await refuseBelowTier(access.album, 'studio', 'Bib number search')
    if (refusal) return refusal
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('albums')
    .update({ bib_excluded_numbers: next })
    .eq('id', access.album.id)
  if (error) {
    return serverError('album/bib-exclusions', error.message, {
      albumId: access.album.id, publicMessage: 'Could not save the excluded numbers',
    })
  }

  // Out to every guest with the album already open. The list is applied on the phone as well as in
  // the database, so without this a runner keeps getting the banner's photographs until they
  // reload -- which is exactly why the bib range is broadcast too.
  queueAlbumSettingsBroadcast(access.album.id, { bib_excluded_numbers: next })
  return NextResponse.json({ ok: true, excluded: next }, { headers: NO_STORE })
}
