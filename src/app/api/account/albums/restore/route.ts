import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { canRestore } from '@/lib/album-bin'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// PUTTING BACK AN ALBUM FROM THE ACCOUNT PAGE.
//
// The sibling route under /api/album/restore proves ownership with the owner COOKIE, because an
// album made without an account has nothing else. This one proves it with the ACCOUNT — the album
// row carries user_id, and that is stronger: it survives a new device, a cleared browser and the
// cookie's seven-day life, which is exactly the situation somebody is in when they come looking for
// an album they deleted last Tuesday.
//
// Two routes rather than one because the two proofs are genuinely different and share nothing but
// the window, which both take from lib/album-bin.
export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const rl = await checkRateLimit(clientIpKey(req, 'account_restore'), 60, 20, { failOpen: false })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  const body = await req.json().catch(() => null) as { album_id?: unknown } | null
  const albumId = body?.album_id
  if (typeof albumId !== 'string' || !UUID_RE.test(albumId)) {
    return NextResponse.json({ error: 'Invalid album_id' }, { status: 400, headers: NO_STORE })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const admin = createAdminClient()
  // Scoped to this account's own albums by the same `user_id` filter the delete route uses, so a
  // signed-in stranger cannot restore somebody else's album by guessing a UUID.
  const { data: album } = await admin
    .from('albums')
    .select('id, deleted_at')
    .eq('id', albumId)
    .eq('user_id', user.id)
    .maybeSingle<{ id: string; deleted_at: string | null }>()

  if (!album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }

  if (!canRestore(album.deleted_at, Date.now())) {
    // Either it was never deleted, or the window has closed and cron/retire-albums has destroyed or
    // is about to destroy it. Saying "too late" is honest; pretending it worked is not.
    return NextResponse.json(
      { error: 'This album can no longer be restored.' },
      { status: 410, headers: NO_STORE },
    )
  }

  // Both columns cleared together, and only while it is still in the bin — the same race guard as
  // the cookie route: a restore must never un-hide a row the purge has already begun to destroy.
  const { data: restored, error: updateErr } = await admin
    .from('albums')
    .update({ deleted_at: null, retired_at: null, last_activity_at: new Date().toISOString() })
    .eq('id', album.id)
    .eq('user_id', user.id)
    .not('deleted_at', 'is', null)
    .select('id')

  if (updateErr) {
    console.error('[account/albums/restore] update failed for album', album.id, ':', updateErr.message)
    return NextResponse.json({ error: 'Could not restore the album' }, { status: 500, headers: NO_STORE })
  }
  if (!restored || restored.length === 0) {
    // Somebody else restored it first, which from here is a success.
    return NextResponse.json({ ok: true, alreadyRestored: true }, { headers: NO_STORE })
  }

  console.info('[account/albums/restore] album', album.id, 'restored from the bin')
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
