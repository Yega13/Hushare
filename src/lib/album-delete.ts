import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { createAdminClient } from '@/lib/supabase/admin'
import { deleteStreamVideo } from '@/lib/cloudflare/stream'
import { deleteCollection } from '@/lib/rekognition'

type AdminClient = ReturnType<typeof createAdminClient>

// Minimal local type — avoids importing @cloudflare/workers-types globally (conflicts with DOM types)
type R2BucketLike = { delete(keys: string | string[]): Promise<void> }
type R2Env = { R2_BUCKET: R2BucketLike }

type AlbumDeleteTarget = {
  id: string
  background_theme: string | null
}

type PhotoToDelete = {
  storage_path: string | null
  storage_backend: 'r2' | 'stream'
  poster_url: string | null
  stream_uid: string | null
  thumb_url: string | null
}

export function r2KeyFromUrl(url: string | null): string | null {
  if (!url) return null
  const rawHost = process.env.R2_PUBLIC_HOST
  if (!rawHost) {
    console.error('[album/delete] R2_PUBLIC_HOST not set — cannot derive R2 key, asset will be orphaned:', url)
    return null
  }
  // Strip any accidental scheme prefix (e.g. "https://cdn.host" → "cdn.host") so the
  // constructed prefix always matches what r2PublicUrl() generates.
  const host = rawHost.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const prefix = `https://${host}/`
  if (!url.startsWith(prefix)) return null
  return url.slice(prefix.length).split('?')[0] || null
}

export async function deleteAlbumAssetsAndRows(
  admin: AdminClient,
  album: AlbumDeleteTarget,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Step 1: Collect storage references BEFORE any deletion.
  // Paginate in 1000-row batches — Supabase default page size is 1000; without this,
  // albums with >1000 photos silently leave orphaned R2 objects and Stream videos.
  const PAGE_SIZE = 1000
  const r2Keys = new Set<string>()
  const streamUids = new Set<string>()

  let offset = 0
  while (true) {
    const { data: batch, error: photosError } = await admin
      .from('photos')
      .select('storage_path, storage_backend, poster_url, stream_uid, thumb_url')
      .eq('album_id', album.id)
      .range(offset, offset + PAGE_SIZE - 1)
      .returns<PhotoToDelete[]>()

    if (photosError) {
      console.error('[album/delete] photo lookup failed:', photosError.message)
      return { ok: false, error: 'Could not prepare album deletion' }
    }

    for (const photo of batch ?? []) {
      if (photo.storage_backend === 'stream') {
        if (photo.stream_uid) streamUids.add(photo.stream_uid)
        const posterKey = r2KeyFromUrl(photo.poster_url)
        if (posterKey) r2Keys.add(posterKey)
      } else {
        if (photo.storage_path) r2Keys.add(photo.storage_path)
        const thumbKey = r2KeyFromUrl(photo.thumb_url)
        if (thumbKey) r2Keys.add(thumbKey)
      }
    }

    if (!batch || batch.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  const bgKey = r2KeyFromUrl(album.background_theme?.startsWith('image:')
    ? album.background_theme.slice(6)
    : null)
  if (bgKey) r2Keys.add(bgKey)

  // Step 2a: Delete pending_stream_uploads rows for this album. These may not have a DB-level
  // CASCADE (depending on schema migration order), so we clean them up explicitly. Best-effort.
  await admin.from('pending_stream_uploads').delete().eq('album_id', album.id)

  // Step 2b: Delete the DB row FIRST — cascades to photos and collection_albums automatically.
  // Order matters: if this fails, assets still exist (no data loss). If asset cleanup fails
  // after this, assets are orphaned (acceptable — cron handles it), but there are no broken
  // image URLs in the app because the album row is already gone.
  const { error: deleteError } = await admin.from('albums').delete().eq('id', album.id)
  if (deleteError) {
    console.error('[album/delete] DB delete failed:', deleteError.message)
    return { ok: false, error: 'Could not delete album' }
  }

  // Step 3: Clean up storage — best-effort, non-fatal
  if (r2Keys.size > 0) {
    try {
      const ctx = getCloudflareContext()
      const bucket = (ctx?.env as R2Env | undefined)?.R2_BUCKET
      if (bucket) {
        await bucket.delete([...r2Keys])
      } else {
        console.error('[album/delete] R2 binding unavailable; orphaning', [...r2Keys])
      }
    } catch (e) {
      console.error('[album/delete] R2 remove failed:', e)
    }
  }

  for (const uid of streamUids) {
    try {
      await deleteStreamVideo(uid)
    } catch (e) {
      console.error('[album/delete] Stream remove failed:', e instanceof Error ? e.message : String(e))
    }
  }

  try {
    await deleteCollection(album.id)
  } catch (e) {
    console.error('[album/delete] Rekognition deleteCollection failed:', e instanceof Error ? e.message : String(e))
  }

  return { ok: true }
}
