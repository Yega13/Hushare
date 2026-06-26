import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { broadcastAlbumSettings } from '@/lib/broadcast'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; allow_guest_downloads?: unknown } | null
  const { slug, allow_guest_downloads } = body ?? {}

  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }
  if (typeof allow_guest_downloads !== 'boolean') {
    return NextResponse.json({ error: 'allow_guest_downloads must be a boolean' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit(req, slug.trim())
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  const admin = createAdminClient()
  const { error } = await admin
    .from('albums')
    .update({ allow_guest_downloads })
    .eq('id', access.album.id)

  if (error) {
    console.error('[album/guest-downloads] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update setting' }, { status: 500, headers: NO_STORE })
  }

  // Broadcast so guests see the change without a page refresh
  void broadcastAlbumSettings(access.album.id, { allow_guest_downloads })

  return NextResponse.json({ ok: true, allow_guest_downloads }, { headers: NO_STORE })
}
