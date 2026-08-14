import { createAdminClient } from '@/lib/supabase/admin'
import { ensureCollection, indexPhotoFaces } from '@/lib/rekognition'

// Server-side face indexing, mirroring src/lib/server/bib-index.ts.
//
// Face indexing used to be driven entirely by the guest's browser: FaceFinder called
// /api/album/face-index in a loop, and the fallback path indexed ONE photo per HTTP request. For a
// small album that was invisible. For a race album of a couple of thousand photos it means a couple
// of thousand sequential round trips from a runner's phone — roughly an hour of holding the tab
// open, and it stops dead the moment they close it. The first guest to open Face Finder paid that
// cost for everyone, and to them the feature looks broken.
//
// So the same cron that sweeps bib numbers now indexes faces too: work happens server-side, in
// batches, and resumes wherever the previous run stopped.
//
// Idempotency is the same contract bib uses, and it matters just as much here because IndexFaces is
// billed per image: face_ids NULL means "never looked at", and [] means "looked at, found nobody".
// A photo with a non-NULL value is never re-sent to AWS.

const BATCH = 10
const CONCURRENCY = 5

type PendingPhoto = { id: string; url: string | null; thumb_url: string | null }

// Faces are matched against the 600px thumbnail: it is what SearchFacesByImage receives at query
// time, so indexing the same rendition keeps the two sides consistent, and it is far cheaper to
// fetch than the original. Falls back to the full image for legacy rows without a thumbnail.
function faceImageUrl(p: PendingPhoto): string | null {
  return p.thumb_url ?? p.url
}

async function indexOne(admin: ReturnType<typeof createAdminClient>, albumId: string, photo: PendingPhoto): Promise<void> {
  const imageUrl = faceImageUrl(photo)
  if (!imageUrl) {
    await admin.from('photos').update({ face_ids: [] }).eq('id', photo.id)
    return
  }
  try {
    const faceIds = await indexPhotoFaces(albumId, photo.id, imageUrl)
    await admin.from('photos').update({ face_ids: faceIds }).eq('id', photo.id)
  } catch (e) {
    // Left NULL so a later sweep retries, exactly like bib-index does. This previously wrote [],
    // which is the sentinel for "looked at, found nobody" — so a TRANSIENT failure permanently
    // marked a photo as face-free and it was never re-examined. That is silent data loss: hitting
    // Cloudflare's subrequest ceiling mid-sweep quietly emptied Face Finder for those photos.
    // A genuinely unreadable image still resolves, because indexPhotoFaces returns [] rather than
    // throwing when AWS reads the image and finds no face.
    console.error('[face-sweep] indexPhotoFaces failed for', photo.id, e instanceof Error ? e.message : String(e))
  }
}

// Indexes one batch. Returns how many photos still need indexing, so the caller knows whether to
// keep going within its time budget.
export async function indexAlbumFacesBatch(albumId: string): Promise<number> {
  const admin = createAdminClient()

  // Re-checked every batch: an owner who switches Face Finder off mid-sweep stops it, and nothing
  // further is sent to AWS.
  const { data: album } = await admin
    .from('albums')
    .select('face_finder_enabled')
    .eq('id', albumId)
    .maybeSingle<{ face_finder_enabled: boolean }>()
  if (!album?.face_finder_enabled) return 0

  const { data: pending } = await admin
    .from('photos')
    .select('id, url, thumb_url')
    .eq('album_id', albumId)
    .neq('media_type', 'video')
    .is('face_ids', null)
    .limit(BATCH)
    .returns<PendingPhoto[]>()
  if (!pending || pending.length === 0) return 0

  // Only touch AWS once we know there is work — ensureCollection is a billable API call.
  await ensureCollection(albumId)

  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
      while (cursor < pending.length) await indexOne(admin, albumId, pending[cursor++])
    }),
  )

  // Previously a COUNT(*) over the album on EVERY batch — a scan per batch, which on a 600-photo
  // album cost more than the OCR it was measuring. A full batch means there is very likely more
  // work; a short one means the queue just drained. The caller only needs "keep going or stop".
  return pending.length === BATCH ? BATCH : 0
}
