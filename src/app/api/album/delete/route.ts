import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { BIN_DAYS, binMessage } from '@/lib/album-bin'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

type AlbumWithBackground = {
  id: string
  owner_token: string
  user_id: string | null
  custom_slug?: string | null
  background_theme: string | null
  logo_url: string | null
  header_image: string | null
  sponsor_logos: unknown
}

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown } | null
  const { slug } = body ?? {}

  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit<AlbumWithBackground>(req, slug.trim(), 'background_theme, logo_url, header_image, sponsor_logos')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  const admin = createAdminClient()

  // MARKED, NOT DESTROYED. This used to delete every R2 object, every Stream video and the row, in
  // one request, with no backup anywhere and no undo. Anyone holding the owner link could do it —
  // and on an album made without an account the owner link is the ONLY proof of ownership, so that
  // is everybody it was ever shared with.
  //
  // The album disappears immediately and completely: retired_at is what the guest resolver and every
  // owner mutation already filter on, at SQL level, so setting it here hides the album through paths
  // that already exist and are already tested. Adding a new filter to the 86 places that read this
  // table is how one gets missed, and a miss means an album the owner believes is gone is still
  // being served.
  //
  // deleted_at records why and when. cron/retire-albums destroys it after the window in
  // lib/album-bin. Both columns are written in ONE update so an album can never end up recorded as
  // deleted while still visible.
  const nowIso = new Date().toISOString()
  const { error: binErr } = await admin
    .from('albums')
    .update({ deleted_at: nowIso, retired_at: nowIso })
    .eq('id', access.album.id)
    // Only if it is not ALREADY in the bin, so a double-click cannot restart the seven days and
    // quietly extend how long we store it.
    .is('deleted_at', null)

  if (binErr) {
    console.error('[album/delete] could not bin album', access.album.id, ':', binErr.message)
    return NextResponse.json({ error: 'Could not delete the album' }, { status: 500, headers: NO_STORE })
  }

  // THE OWNER COOKIE IS KEPT, deliberately, and this is the one line that makes the bin usable.
  // It used to be cleared here, which was right when deletion was final. Now it is the only thing
  // that proves who may restore the album — dropping it would leave the data sitting there with
  // nobody able to reach it, which is a bin in name only.
  //
  // It grants nothing else: every owner route filters retired_at, so the cookie opens exactly one
  // door while the album is binned, and that door is /api/album/restore.

  // No anon-cap bookkeeping needed here: the create route lists anon album IDs and prunes any that no
  // longer exist, and a binned album is filtered out of that count the same way.

  return NextResponse.json(
    { ok: true, restorableForDays: BIN_DAYS, message: binMessage(BIN_DAYS) },
    { headers: NO_STORE },
  )
}
