import { NextResponse } from 'next/server'
import { deleteFaces } from '@/lib/rekognition'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { deleteR2KeysChunked, collectDeletionTargets } from '@/lib/album-delete'
import { deleteStreamVideo } from '@/lib/cloudflare/stream'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { track } from '@/lib/analytics'
import { queueAlbumChangedBroadcast } from '@/lib/broadcast'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
      await deleteR2KeysChunked(bucket, keys, 'photo/delete')
    } else {
      console.error('[photo/delete] R2 binding unavailable, orphaning keys:', keys)
    }
  } catch (e) {
    console.error('[photo/delete] R2 delete failed:', e instanceof Error ? e.message : String(e))
  }
}

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; photo_id?: unknown } | null
  const { slug, photo_id } = body ?? {}

  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }
  if (typeof photo_id !== 'string' || !UUID_RE.test(photo_id)) {
    return NextResponse.json({ error: 'Invalid photo_id' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit<AlbumWithCover>(req, slug.trim(), 'cover_photo_id')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  const admin = createAdminClient()

  // Verify the photo belongs to THIS album — prevents cross-album deletion
  const { data: photo } = await admin
    .from('photos')
    .select('id, storage_backend, storage_path, thumb_url, poster_url, stream_uid, face_ids')
    .eq('id', photo_id)
    .eq('album_id', access.album.id)
    .maybeSingle<PhotoForDelete>()

  if (!photo) {
    return NextResponse.json({ error: 'Photo not found in this album' }, { status: 404, headers: NO_STORE })
  }

  // Collect R2 keys before any mutation
  const r2Keys: string[] = []
  // The SAME function album deletion uses. This was a hand-copy of it, and only that copy was
  // tested. More importantly, album-delete
  // carries the reasoning for why a Stream row's storage_path must never be read (that key belongs
  // to whatever else wrote it) and only that copy was tested. Three copies of a rule about which
  // file to destroy is three chances to destroy the wrong one.
  //
  // .r2Keys ONLY. The shared function also returns streamUids, but this route deletes the Stream
  // video itself further down — taking both here would issue the delete twice.
  for (const key of collectDeletionTargets([photo], null).r2Keys) r2Keys.push(key)

  // Clear cover pointer before deleting the row — if DB delete later fails, the worst
  // case is no cover (acceptable), not a broken cover URL pointing at a deleted photo
  if (access.album.cover_photo_id === photo_id) {
    const { error: coverErr } = await admin
      .from('albums')
      .update({ cover_photo_id: null })
      .eq('id', access.album.id)
    if (coverErr) {
      console.error('[photo/delete] cover clear failed:', coverErr.message)
    }
  }

  // Delete DB row FIRST — if asset cleanup fails, row is gone (clean). If DB delete fails,
  // assets still exist (no broken URLs in the app). Reversed order is wrong.
  const { error: deleteError } = await admin
    .from('photos')
    .delete()
    .eq('id', photo_id)
    .eq('album_id', access.album.id)

  if (deleteError) {
    console.error('[photo/delete] DB delete failed:', deleteError.message)
    return NextResponse.json({ error: 'Could not delete photo' }, { status: 500, headers: NO_STORE })
  }

  // Best-effort asset cleanup — non-fatal after DB row is gone
  await deleteR2Keys(r2Keys)

  if (photo.storage_backend === 'stream' && photo.stream_uid) {
    deleteStreamVideo(photo.stream_uid).catch(e =>
      console.error('[photo/delete] Stream remove failed:', e instanceof Error ? e.message : String(e))
    )
  }

  // Delete the face templates this photo produced. Without this the photo disappears from the
  // album while its biometric records stay in the Rekognition collection, still matchable by any
  // later selfie search -- so "delete this photo" did not delete the most sensitive thing derived
  // from it. The privacy policy promises the opposite in as many words, and deleteFaces() existed
  // for exactly this and had never been called from anywhere.
  const faceIds = (photo as { face_ids?: string[] | null }).face_ids
  if (faceIds?.length) {
    deleteFaces(access.album.id, faceIds).catch(e =>
      console.error('[photo/delete] Rekognition deleteFaces failed:', e instanceof Error ? e.message : String(e))
    )
  }

  track({ name: 'media_deleted', albumId: access.album.id, count: 1 })

  // Tell open viewers to refetch. Deletions used to reach them via a postgres_changes listener,
  // which required granting anon SELECT on `photos` — and that grant allowed anyone holding the
  // public anon key to enumerate every photo on the platform. Broadcast carries no row data, so
  // it needs no table access at all.
  queueAlbumChangedBroadcast(access.album.id)

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
