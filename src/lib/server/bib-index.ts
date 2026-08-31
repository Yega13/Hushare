import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserTierById } from '@/lib/subscriptions'
import { detectBibNumbers, IMAGE_TOO_LARGE } from '@/lib/rekognition'

// Bib indexing runs AFTER the response has been sent (waitUntil), never inside it. Upload speed is
// the product's first priority and OCR is ~1s per photo, so it must never sit in the request path.
//
// A Worker's post-response budget only covers about a dozen photos before it's terminated, which
// measurably stalled a 69-photo album at 12. So a sweep does ONE small batch and then asks a fresh
// invocation to continue, chaining until the album is done. Each link gets its own budget.
//
// Everything here is idempotent: photos with a non-NULL bib_numbers are skipped, so a repeated or
// overlapping trigger can never re-OCR (and re-bill) work that's already done. Verified in
// practice — an interrupted sweep resumed at exactly the photo it stopped on.

// Sized to complete comfortably inside one post-response budget. Measured ~11-12 before termination.
// Sized against the WORKERS PAID subrequest budget of 1000 per invocation (2026-08-17; it was 50
// on the free plan, which is why this used to be 10). Each photo costs 3 subrequests: fetch the
// image, call Rekognition, write the result back. Both indexers run in the same invocation, so the
// arithmetic that matters is 2 x BATCH x 3, and 100 leaves ~40% headroom. Do not raise this past
// ~150 without re-checking that number -- exceeding the budget does not slow indexing down, it
// makes the whole invocation fail.
//
// CONCURRENCY is capped by AWS, not by us: 10 here plus 10 in the sibling indexer is 20 concurrent
// Rekognition calls, comfortably inside DetectText/IndexFaces default rates. Throttling would
// surface as failed photos, not slow ones.
const BATCH = 100
// Exported so the cron can charge its subrequest budget for the work that will ACTUALLY
// happen. It used to charge for the cap it passed in, which this clamps down — see the
// budget note in api/cron/bib-index for what that cost.
export { BATCH as BIB_BATCH }
// Parallelism within a batch. These are network-bound calls sharing a Worker with real traffic.
const CONCURRENCY = 10
// Absolute ceiling on chain length. Without it, photos that fail every attempt (left NULL so they
// can be retried) would chain forever. 400 links x 8 = 3200 photos, far past any real race.
const MAX_CHAIN = 400

type PendingPhoto = { id: string; url: string | null; thumb_url: string | null }

async function indexOne(admin: ReturnType<typeof createAdminClient>, photo: PendingPhoto): Promise<void> {
  // Prefer the full image: bibs on distant runners are small, and the 600px thumbnail loses exactly
  // the detail OCR needs. Falls back to the thumbnail when there's no original (legacy rows).
  const imageUrl = photo.url ?? photo.thumb_url
  if (!imageUrl) return
  try {
    let bibs
    try {
      bibs = await detectBibNumbers(imageUrl)
    } catch (e) {
      // An original over Rekognition's byte cap fails IDENTICALLY forever — retrying it each
      // pass wedges the queue and keeps "still reading photos" on screen for good. The 600px
      // thumbnail reads fewer distant bibs, but a partial answer beats an eternal NULL. Only
      // the tagged permanent error takes this path; transient failures still fall through to
      // the retry-later catch below.
      const tooLarge = e instanceof Error && e.message === IMAGE_TOO_LARGE
      if (!tooLarge || !photo.thumb_url || photo.thumb_url === imageUrl) throw e
      bibs = await detectBibNumbers(photo.thumb_url)
    }
    // [] is written on success-with-no-bibs, which is a real answer and must be distinguishable
    // from NULL ("never looked at") or the sweep would revisit this photo forever.
    await admin.from('photos').update({ bib_numbers: bibs.map((b) => b.number) }).eq('id', photo.id)
  } catch (e) {
    // Left NULL on failure so a later pass retries, rather than recording a transient AWS error
    // as "this photo has no bib".
    console.error('[bib-index] failed for', photo.id, e instanceof Error ? e.message : String(e))
  }
}

// Indexes one batch. Returns how many photos still need indexing afterwards, so the caller knows
// whether to continue the chain.
// `max` lets the caller shrink a batch to fit what is left of the invocation's subrequest
// budget. The cron sweeps EVERY album with indexing on, so the budget is shared between them
// — see the accounting in api/cron/bib-index. Omitted, this behaves exactly as before.
export async function indexAlbumBibsBatch(albumId: string, max: number = BATCH): Promise<number> {
  const cap = Math.max(1, Math.min(BATCH, Math.floor(max)))
  const admin = createAdminClient()

  const { data: album } = await admin
    .from('albums')
    .select('bib_search_enabled, user_id')
    .eq('id', albumId)
    .maybeSingle<{ bib_search_enabled: boolean; user_id: string | null }>()
  // Re-checked every link: an owner who switches bib search back off mid-sweep stops it.
  if (!album?.bib_search_enabled) return 0

  // AND the owner must still be on Max. The flag alone is not enough: it can be switched on while
  // the feature is free, or survive a downgrade, and indexing is a BILLED call to AWS on every
  // photo. Without this we pay to build an index for a search the server then refuses.
  if (!album.user_id || (await getUserTierById(album.user_id)) !== 'studio') return 0

  const { data: pending } = await admin
    .from('photos')
    .select('id, url, thumb_url')
    .eq('album_id', albumId)
    .eq('media_type', 'image')
    .is('bib_numbers', null)
    .limit(cap)
    .returns<PendingPhoto[]>()
  if (!pending || pending.length === 0) return 0

  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
      while (cursor < pending.length) await indexOne(admin, pending[cursor++])
    }),
  )

  // Previously a COUNT(*) over the album on EVERY batch — a scan per batch, which on a 600-photo
  // album cost more than the OCR it was measuring. A full batch means there is very likely more
  // work; a short one means the queue just drained. The caller only needs "keep going or stop".
  return pending.length === cap ? cap : 0
}

// Asks a FRESH Worker invocation to run the next batch, so the chain isn't bounded by one Worker's
// post-response budget. Fire-and-forget; a dropped link just means indexing resumes on the next
// upload or when the owner reopens the switch, and nothing is lost or double-charged.
export function continueBibIndex(albumId: string, depth: number): void {
  if (depth >= MAX_CHAIN) {
    console.warn('[bib-index] chain cap reached for album', albumId)
    return
  }
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space').replace(/\/+$/, '')
  const secret = process.env.ALBUM_RETIREMENT_SECRET ?? ''
  if (!secret) return

  const p = fetch(`${site}/api/album/bib-index-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ albumId, depth: depth + 1, secret }),
  }).then(() => undefined).catch((e: unknown) =>
    console.error('[bib-index] chain link failed:', e instanceof Error ? e.message : String(e)),
  )
  try { getCloudflareContext().ctx.waitUntil(p) } catch { void p }
}

// Entry point for request handlers: runs a batch after the response, then chains if work remains.
export function queueBibIndex(albumId: string, depth = 0): void {
  const p = (async () => {
    const remaining = await indexAlbumBibsBatch(albumId)
    if (remaining > 0) continueBibIndex(albumId, depth)
  })().catch((e: unknown) =>
    console.error('[bib-index] sweep failed:', e instanceof Error ? e.message : String(e)),
  )
  try { getCloudflareContext().ctx.waitUntil(p) } catch { void p }
}
