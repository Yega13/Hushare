import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAccountAdmin } from '@/lib/auth'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { deleteAlbumAssetsAndRows } from '@/lib/album-delete'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Admin-only: delete ANY album (moderation / DMCA / illegal content). Reuses the same full-cleanup
// routine (R2 + Stream + Rekognition + cascading DB delete) that owner-delete and the retention
// cron use. Gated to ADMIN_EMAILS; returns 404 (not 403) to non-admins so the endpoint stays hidden.
export async function POST(req: Request) {
  const csrf = forbidCrossSiteRequest(req)
  if (csrf) return csrf

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!isAccountAdmin(user)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  }

  const body = await req.json().catch(() => null) as { albumId?: unknown } | null
  const albumId = body?.albumId
  if (typeof albumId !== 'string' || !UUID_RE.test(albumId)) {
    return NextResponse.json({ error: 'Invalid albumId' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: album, error } = await admin
    .from('albums')
    .select('id, background_theme')
    .eq('id', albumId)
    .maybeSingle<{ id: string; background_theme: string | null }>()
  if (error || !album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }

  const result = await deleteAlbumAssetsAndRows(admin, album)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500, headers: NO_STORE })
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
