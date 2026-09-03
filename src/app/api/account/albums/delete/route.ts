import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { BIN_DAYS, binMessage } from '@/lib/album-bin'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type AlbumForDelete = {
  id: string
  background_theme: string | null
  logo_url: string | null
  header_image: string | null
  sponsor_logos: unknown
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
    .select('id, background_theme, logo_url, header_image, sponsor_logos, user_id')
    .eq('id', album_id)
    .eq('user_id', user.id)
    .maybeSingle<AlbumForDelete>()

  if (!album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }

  // THE SAME BIN AS THE OWNER TOOLBAR. This is the SECOND way an owner can delete an album, and it
  // kept destroying everything immediately after the first one learned not to — so which button you
  // pressed decided whether your photos still existed. Both mark now, and lib/album-bin owns the
  // window for both (rule 13).
  //
  // retired_at is set alongside deleted_at because that is the column every guest and owner path
  // already filters at SQL level; deleted_at records when, and cron/retire-albums destroys it after
  // the window. `.is('deleted_at', null)` stops a second press restarting the clock.
  const nowIso = new Date().toISOString()
  const { error: binErr } = await admin
    .from('albums')
    .update({ deleted_at: nowIso, retired_at: nowIso })
    .eq('id', album.id)
    .eq('user_id', user.id)
    .is('deleted_at', null)

  if (binErr) {
    console.error('[account/albums/delete] could not bin album', album.id, ':', binErr.message)
    return NextResponse.json({ error: 'Could not delete the album' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json(
    { ok: true, restorableForDays: BIN_DAYS, message: binMessage(BIN_DAYS) },
    { headers: NO_STORE },
  )
}
