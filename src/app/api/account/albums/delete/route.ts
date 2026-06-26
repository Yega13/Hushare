import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { deleteAlbumAssetsAndRows } from '@/lib/album-delete'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type AlbumForDelete = {
  id: string
  background_theme: string | null
  user_id: string | null
}

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  // Tight limit — deletes are irreversible; amplified blast radius on account compromise.
  const rl = await checkRateLimit(clientIpKey(req, 'account_delete'), 60, 10, { failOpen: false })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  const body = await req.json().catch(() => null) as { album_id?: unknown } | null
  const { album_id } = body ?? {}

  if (typeof album_id !== 'string' || !UUID_RE.test(album_id)) {
    return NextResponse.json({ error: 'Invalid album_id' }, { status: 400, headers: NO_STORE })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const admin = createAdminClient()

  const { data: album } = await admin
    .from('albums')
    .select('id, background_theme, user_id')
    .eq('id', album_id)
    .eq('user_id', user.id)
    .maybeSingle<AlbumForDelete>()

  if (!album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }

  const result = await deleteAlbumAssetsAndRows(admin, album)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
