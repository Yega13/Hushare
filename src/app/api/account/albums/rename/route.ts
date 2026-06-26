import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const rl = await checkRateLimit(clientIpKey(req, 'account_rename'), 60, 30, { failOpen: false })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  const body = await req.json().catch(() => null) as { album_id?: unknown; title?: unknown } | null
  const { album_id, title } = body ?? {}

  if (typeof album_id !== 'string' || !UUID_RE.test(album_id)) {
    return NextResponse.json({ error: 'Invalid album_id' }, { status: 400, headers: NO_STORE })
  }
  if (typeof title !== 'string' || title.trim().replace(/[\x00-\x1F\x7F]/g, '').length < 1 || title.trim().length > 120) {
    return NextResponse.json({ error: 'Title must be 1–120 characters' }, { status: 400, headers: NO_STORE })
  }
  const cleanTitle = title.trim().replace(/[\x00-\x1F\x7F]/g, '')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { error, count } = await admin
    .from('albums')
    .update({ title: cleanTitle }, { count: 'exact' })
    .eq('id', album_id)
    .eq('user_id', user.id)

  if (error) {
    console.error('[account/albums/rename] update failed:', error.message)
    return NextResponse.json({ error: 'Could not rename album' }, { status: 500, headers: NO_STORE })
  }

  if (!count) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
