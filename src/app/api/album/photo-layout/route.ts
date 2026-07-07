import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { queueAlbumSettingsBroadcast } from '@/lib/broadcast'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const VALID = new Set(['grid', 'justified'])

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; photo_layout?: unknown } | null
  const { slug, photo_layout } = body ?? {}

  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }
  if (typeof photo_layout !== 'string' || !VALID.has(photo_layout)) {
    return NextResponse.json({ error: 'photo_layout must be "grid" or "justified"' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit(req, slug.trim())
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  const admin = createAdminClient()
  const { error } = await admin.from('albums').update({ photo_layout }).eq('id', access.album.id)
  if (error) {
    console.error('[album/photo-layout] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update layout' }, { status: 500, headers: NO_STORE })
  }

  queueAlbumSettingsBroadcast(access.album.id, { photo_layout })

  return NextResponse.json({ ok: true, photo_layout }, { headers: NO_STORE })
}
