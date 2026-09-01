import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { deleteR2KeysChunked, collectDeletionTargets, withoutStillReferenced, rowsReferencingKeys } from '@/lib/album-delete'
import { deleteStreamVideo } from '@/lib/cloudflare/stream'
import { deleteFaces } from '@/lib/rekognition'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { track } from '@/lib/analytics'
import { queueAlbumChangedBroadcast } from '@/lib/broadcast'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BULK_DELETE = 500

type R2BucketLike = { delete(keys: string | string[]): Promise<void> }
type R2Env = { R2_BUCKET: R2BucketLike }

type AlbumWithCover = {
  id: string
  owner_token: string
  user_id: string | null
  custom_slug?: string | null
  cover_photo_id: string | null
}

type PhotoForDelete = {
  id: string
  storage_backend: 'r2' | 'stream'
  storage_path: string | null
  thumb_url: string | null
  poster_url: string | null
  stream_uid: string | null
}

async function deleteR2Keys(keys: string[]): Promise<void> {
  if (!keys.length) return
  try {
    const ctx = getCloudflareContext()
    const bucket = (ctx?.env as R2Env | undefined)?.R2_BUCKET
    if (bucket) {
      await deleteR2KeysChunked(bucket, keys, 'photo/bulk-delete')
    } else {
      console.error('[photo/bulk-delete] R2 binding unavailable, orphaning keys:', keys)
    }
  } catch (e) {
    console.error('[photo/bulk-delete] R2 delete failed:', e instanceof Error ? e.message : String(e))
  }
}

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
  if (photo_ids.length > MAX_BULK_DELETE) {
    return NextResponse.json({ error: `Max ${MAX_BULK_DELETE} photos per bulk delete` }, { status: 400, headers: NO_STORE })
  }
  for (const id of photo_ids) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Each photo_id must be a valid UUID' }, { status: 400, headers: NO_STORE })
    }
  }

  const access = await verifyOwnerViaCookieWithRateLimit<AlbumWithCover>(req, slug.trim(), 'cover_photo_id')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  const admin = createAdminClient()

  // Fetch only photos that belong to this album — prevents cross-album deletion
  const { data: photos, error: fetchError } = await admin
    .from('photos')
    .select('id, storage_backend, storage_path, thumb_url, poster_url, stream_uid, face_ids')
    .eq('album_id', access.album.id)
    .in('id', photo_ids as string[])
    .returns<PhotoForDelete[]>()

  if (fetchError) {
    console.error('[photo/bulk-delete] fetch failed:', fetchError.message)
    return NextResponse.json({ error: 'Could not fetch photos' }, { status: 500, headers: NO_STORE })
  }

  const validPhotos = photos ?? []

  if (validPhotos.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0 }, { headers: NO_STORE })
  }

  // Collect all R2 keys and Stream UIDs before any mutation
  const r2Keys: string[] = []
  const streamUids: string[] = []

  // The same shared decision as album deletion and single-photo deletion — see album-delete for
  // why a Stream row's storage_path is never read. This was the third hand-copy of it.
  {
    const targets = collectDeletionTargets(validPhotos, null)
    for (const key of targets.r2Keys) r2Keys.push(key)
    for (const uid of targets.streamUids) streamUids.push(uid)
  }

  const deletedIds = validPhotos.map(p => p.id)

  // Clear cover pointer before deleting rows — if DB delete fails, worst case is no cover
  if (access.album.cover_photo_id && deletedIds.includes(access.album.cover_photo_id)) {
    const { error: coverErr } = await admin
      .from('albums')
      .update({ cover_photo_id: null })
      .eq('id', access.album.id)
    if (coverErr) {
      console.error('[photo/bulk-delete] cover clear failed:', coverErr.message)
    }
  }

  // Delete DB rows FIRST — if asset cleanup fails, rows are gone (clean). If DB delete fails,
  // assets still exist (no broken URLs). Reversed order would leave broken URLs on DB failure.
  const { error: deleteError } = await admin
    .from('photos')
    .delete()
    .eq('album_id', access.album.id)
    .in('id', deletedIds)

  if (deleteError) {
    console.error('[photo/bulk-delete] DB delete failed:', deleteError.message)
    return NextResponse.json({ error: 'Could not delete photos' }, { status: 500, headers: NO_STORE })
  }

  // Best-effort asset cleanup — non-fatal after DB rows are gone
  // NOTHING A SURVIVING ROW STILL POINTS AT — the same guard as single-photo deletion, and this
  // is the route that matters most: a guest can post many junk rows all copying real thumbnails,
  // and bulk-delete is exactly how an owner clears junk. Asked AFTER the rows are gone, so what
  // comes back is precisely the survivors, and a failed lookup deletes nothing (rule 19).
  // By KEY, across every URL column — the exact-string per-column lookup this replaces returned
  // an empty survivor set for a row storing `...jpg?x` (same file, different string) or copying
  // another row's poster_url into its thumb_url, and an empty survivor set means "delete it all".
  // This is the route that matters most: junk rows copying real thumbnails are cleared here.
  let safe = { r2Keys: new Set<string>(), streamUids: new Set<string>() }
  try {
    const survivors = await rowsReferencingKeys(admin, access.album.id, r2Keys)
    safe = withoutStillReferenced(
      { r2Keys: new Set(r2Keys), streamUids: new Set(streamUids) },
      survivors,
    )
  } catch (e) {
    console.error('[photo/bulk-delete] survivor check failed — deleting no files:',
      e instanceof Error ? e.message : String(e))
  }

  await deleteR2Keys([...safe.r2Keys])

  // The guarded set here too — a Stream video another surviving row still names must not be
  // destroyed, and it is the one asset with no copy anywhere.
  await Promise.all([...safe.streamUids].map(uid =>
    deleteStreamVideo(uid).catch(e =>
      console.error('[photo/bulk-delete] Stream remove failed:', e instanceof Error ? e.message : String(e))
    )
  ))

  // Same as photo/delete: the biometric templates these photos produced have to go with them,
  // or a bulk delete quietly leaves every face still enrolled and searchable.
  const allFaceIds = validPhotos.flatMap(
    (p) => ((p as { face_ids?: string[] | null }).face_ids ?? []),
  )
  if (allFaceIds.length) {
    deleteFaces(access.album.id, allFaceIds).catch(e =>
      console.error('[photo/bulk-delete] Rekognition deleteFaces failed:', e instanceof Error ? e.message : String(e))
    )
  }

  track({ name: 'media_deleted', albumId: access.album.id, count: validPhotos.length })

  // See the note in photo/delete: viewers refresh via broadcast so `photos` needs no anon grant.
  queueAlbumChangedBroadcast(access.album.id)

  return NextResponse.json({ ok: true, deleted: validPhotos.length }, { headers: NO_STORE })
}
