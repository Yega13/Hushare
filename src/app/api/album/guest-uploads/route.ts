import { NextResponse } from 'next/server'
import { refuseAccess } from '@/lib/server/respond'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { queueAlbumSettingsBroadcast } from '@/lib/broadcast'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// TURN GUEST UPLOADING OFF (OR BACK ON).
//
// `albums.guest_uploads_enabled` has been enforced since the beginning — photos/create, presign,
// stream and image-relay all refuse when it is false, so it is a real gate and not a UI hint. What
// was missing was any way to CHANGE it: no route accepted the field and no control existed in the
// owner toolbar, so the only way to close an album to guests was an UPDATE against the database by
// hand. A customer asked for exactly this (a race organiser who wanted a view-only gallery) and the
// honest answer was "the product enforces a setting it gives you no way to set".
//
// Deliberately its own route rather than a field on a general settings endpoint, matching
// guest-downloads: these two decide what a STRANGER may do to somebody's album, and keeping them as
// named routes means the owner-cookie check is impossible to skip by adding a key to a payload.
export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; guest_uploads_enabled?: unknown } | null
  const { slug, guest_uploads_enabled } = body ?? {}

  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }
  if (typeof guest_uploads_enabled !== 'boolean') {
    return NextResponse.json({ error: 'guest_uploads_enabled must be a boolean' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit(req, slug.trim())
  if (!access.ok) return refuseAccess(access)

  const admin = createAdminClient()
  const { error } = await admin
    .from('albums')
    .update({ guest_uploads_enabled })
    .eq('id', access.album.id)

  if (error) {
    console.error('[album/guest-uploads] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update setting' }, { status: 500, headers: NO_STORE })
  }

  // Broadcast so a guest with the album already open loses (or regains) the upload zone without
  // reloading. Without this, someone who had the page open would keep seeing an upload button that
  // the server has started refusing — the worst version of this change.
  queueAlbumSettingsBroadcast(access.album.id, { guest_uploads_enabled })

  return NextResponse.json({ ok: true, guest_uploads_enabled }, { headers: NO_STORE })
}
