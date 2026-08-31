import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { queueAlbumChangedBroadcast } from '@/lib/broadcast'
import { idBatches, firstDuplicate } from '@/lib/id-batches'
import { reportServerError } from '@/lib/report-server-error'

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

  // A REPEATED ID IS ITS OWN BUG, and must not masquerade as a missing photo. The database
  // matches a duplicate once, so the count comes back short and reads exactly like "one of these
  // does not exist" — sending whoever debugs it hunting for a photo that was never missing.
  const dupe = firstDuplicate(ids)
  if (dupe) {
    console.error('[photos/reorder] duplicate id in payload for album', access.album.id, ':', dupe)
    return NextResponse.json({ error: 'The same photo was sent twice. Reload the album and try again.' }, { status: 400, headers: NO_STORE })
  }

  // Pre-validate that all submitted IDs belong to this album — the SQL RPC also enforces this
  // at DB level, but without a pre-check a partially-matched reorder would silently succeed
  // with no indication of which IDs were ignored, leaving the UI out of sync.
  //
  // IN BATCHES, because PostgREST puts `.in(...)` in the URL. One call with ~500 ids is an 18 KB
  // URL and the fetch throws before any status exists — which is precisely how reordering broke on
  // the 4,565-photo race album, and why it broke on THAT album and no other. See lib/id-batches.
  let found = 0
  for (const batch of idBatches(ids)) {
    const { count, error } = await admin
      .from('photos')
      .select('id', { count: 'exact', head: true })
      .eq('album_id', access.album.id)
      .in('id', batch)

    // A QUERY THAT FAILED IS NOT A VERDICT ABOUT THE DATA. Both outcomes used to return the same
    // 400 — "one or more photo IDs do not belong to this album" — so a broken request accused the
    // owner's album of being inconsistent, and nothing was reported anywhere. Never state a
    // negative we cannot back up (rule 20).
    if (error) {
      console.error('[photos/reorder] ownership check failed:', error.message)
      reportServerError('photos-reorder', 'Could not verify photo ownership before reordering', {
        albumId: access.album.id,
        context: { photoCount: ids.length, batchSize: batch.length, reason: error.message.slice(0, 200) },
      })
      return NextResponse.json(
        { error: 'Could not check the photos just now. Please try again.' },
        { status: 503, headers: NO_STORE },
      )
    }
    found += count ?? 0
  }

  if (found !== ids.length) {
    // Now this genuinely means what it says: every batch answered, and the totals disagree.
    console.error('[photos/reorder] id mismatch on album', access.album.id, ':', found, 'of', ids.length)
    reportServerError('photos-reorder', 'Reorder rejected — photo IDs did not match the album', {
      albumId: access.album.id,
      context: { sent: ids.length, matched: found },
    })
    return NextResponse.json({ error: 'One or more photo IDs do not belong to this album' }, { status: 400, headers: NO_STORE })
  }

  const { error } = await admin.rpc('batch_set_sort_order', {
    p_album_id: access.album.id,
    p_ids: ids,
    p_orders: orders,
  })

  if (error) {
    console.error('[photos/reorder] RPC failed:', error.message)
    reportServerError('photos-reorder', 'Could not save the new photo order', {
      albumId: access.album.id,
      context: { photoCount: ids.length, reason: error.message.slice(0, 200) },
    })
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
