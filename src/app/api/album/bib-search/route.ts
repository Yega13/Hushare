import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { refuseBelowTier } from '@/lib/require-tier'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { queueAlbumSettingsBroadcast } from '@/lib/broadcast'
import { queueBibIndex } from '@/lib/server/bib-index'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// The owner's "this is a race" switch. Free for everyone: bib search exists for race organisers,
// and gating it would block the exact people it's for. Turning it ON is the ONLY thing that causes
// an album's photos to be sent for OCR — that consent step is why non-race albums never do.
export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as
    { slug?: unknown; enabled?: unknown; min?: unknown; max?: unknown } | null
  const { slug, enabled, min, max } = body ?? {}

  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }
  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400, headers: NO_STORE })
  }

  // Race numbering bounds. Omitted entirely -> left alone; sent as null -> cleared. Whole positive
  // numbers only, and the DB carries the same CHECK so a bad pair can't land even if this is bypassed.
  function parseBound(v: unknown, name: string): { ok: true; value: number | null | undefined } | { ok: false; error: string } {
    if (v === undefined) return { ok: true, value: undefined }
    if (v === null) return { ok: true, value: null }
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 999_999) {
      return { ok: false, error: `${name} must be a whole number between 1 and 999999, or null` }
    }
    return { ok: true, value: v }
  }
  const parsedMin = parseBound(min, 'min')
  if (!parsedMin.ok) return NextResponse.json({ error: parsedMin.error }, { status: 400, headers: NO_STORE })
  const parsedMax = parseBound(max, 'max')
  if (!parsedMax.ok) return NextResponse.json({ error: parsedMax.error }, { status: 400, headers: NO_STORE })
  if (
    typeof parsedMin.value === 'number' && typeof parsedMax.value === 'number' &&
    parsedMin.value > parsedMax.value
  ) {
    return NextResponse.json({ error: 'min cannot be greater than max' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit(req, slug.trim())
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  // Bib number search is a paid feature — checked against the ALBUM OWNER'S plan, never the
  // caller's. Owner links are shareable, so asking about whoever is holding one would let a
  // single subscriber mint this on albums belonging to strangers.
  const refusal = await refuseBelowTier(access.album.user_id, 'studio', 'Bib number search')
  if (refusal) return refusal

  const patch: { bib_search_enabled: boolean; bib_min?: number | null; bib_max?: number | null } =
    { bib_search_enabled: enabled }
  if (parsedMin.value !== undefined) patch.bib_min = parsedMin.value
  if (parsedMax.value !== undefined) patch.bib_max = parsedMax.value

  const admin = createAdminClient()
  const { error } = await admin.from('albums').update(patch).eq('id', access.album.id)
  if (error) {
    console.error('[album/bib-search] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update bib search' }, { status: 500, headers: NO_STORE })
  }

  // Switching it on mid-event must also catch up on photos uploaded BEFORE the switch — otherwise
  // an owner who enables it after uploading would see it silently do nothing. Runs after the
  // response; photos already indexed are skipped, so this can't double-bill.
  if (enabled) queueBibIndex(access.album.id)

  // The range goes out too: it's applied client-side at search time, so a guest with the album
  // already open must pick up a corrected range without reloading.
  queueAlbumSettingsBroadcast(access.album.id, patch)
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
