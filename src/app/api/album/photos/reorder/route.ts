import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { queueAlbumChangedBroadcast } from '@/lib/broadcast'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_REORDER = 2000

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; photo_ids?: unknown } | null
  const { slug, photo_ids } = body ?? {}

  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }
  if (!Array.isArray(photo_ids) || photo_ids.length === 0) {
    return NextResponse.json({ error: 'photo_ids must be a non-empty array' }, { status: 400, headers: NO_STORE })
  }
  if (photo_ids.length > MAX_REORDER) {
    return NextResponse.json({ error: `Max ${MAX_REORDER} photos per reorder` }, { status: 400, headers: NO_STORE })
  }
  for (const id of photo_ids) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Each photo_id must be a valid UUID' }, { status: 400, headers: NO_STORE })
    }
  }

  const access = await verifyOwnerViaCookieWithRateLimit(req, slug.trim())
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  const ids = photo_ids as string[]
  const orders = ids.map((_, i) => i)

  const admin = createAdminClient()

  // Pre-validate that all submitted IDs belong to this album — the SQL RPC also enforces this
  // at DB level, but without a pre-check a partially-matched reorder would silently succeed
  // with no indication of which IDs were ignored, leaving the UI out of sync.
  const { count, error: countErr } = await admin
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('album_id', access.album.id)
    .in('id', ids)
  if (countErr || count !== ids.length) {
    return NextResponse.json({ error: 'One or more photo IDs do not belong to this album' }, { status: 400, headers: NO_STORE })
  }

  const { error } = await admin.rpc('batch_set_sort_order', {
    p_album_id: access.album.id,
    p_ids: ids,
    p_orders: orders,
  })

  if (error) {
    console.error('[photos/reorder] RPC failed:', error.message)
    return NextResponse.json({ error: 'Could not reorder photos' }, { status: 500, headers: NO_STORE })
  }

  // Arranging photos by hand IS the album's order from now on. Without this the album keeps
  // whatever photo_order it had and sorts by created_at, so the drag appears to work, the rows
  // are written, and the arrangement is silently ignored on the next load.
  const { error: orderErr } = await admin
    .from('albums').update({ photo_order: 'manual' }).eq('id', access.album.id)
  if (orderErr) {
    // The sort values are already written, so the arrangement is not lost — it just will not be
    // honoured until this succeeds. Worth saying so rather than reporting a clean success.
    console.error('[photos/reorder] could not switch album to manual order:', orderErr.message)
    return NextResponse.json(
      { error: 'Photos were reordered but the album could not be switched to manual order. Try again.' },
      { status: 500, headers: NO_STORE },
    )
  }

  // Reordering is an UPDATE; viewers pick it up via broadcast rather than postgres_changes.
  queueAlbumChangedBroadcast(access.album.id)

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
