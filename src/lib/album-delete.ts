import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { createAdminClient } from '@/lib/supabase/admin'
import { deleteStreamVideo } from '@/lib/cloudflare/stream'
import { deleteCollection } from '@/lib/rekognition'

type AdminClient = ReturnType<typeof createAdminClient>

// Minimal local type — avoids importing @cloudflare/workers-types globally (conflicts with DOM types)
type R2BucketLike = { delete(keys: string | string[]): Promise<void> }
type R2Env = { R2_BUCKET: R2BucketLike }

// EVERY R2 OBJECT AN ALBUM OWNS, in one place, because two places already disagreed.
//
// Deleting an album was told only about its photos and its background. Nothing ever removed its
// logo, its header image or its sponsor marks — the album row went, and those files stayed in the
// bucket with nothing left pointing at them. Not a rare paid extra either: any album with a header
// image had one.
//
// Meanwhile api/admin/storage-audit built its "referenced" set from photos plus logo_url alone, so
// it reported every live background, header and sponsor mark as an orphan — an object nothing
// points at. That audit exists to inform a decision about deleting orphans. Its numbers were wrong
// in the direction that destroys customers' files, and the sample of keys it prints for
// hand-checking was seeded with real sponsor logos.
//
// Both are the same missing fact. It is written once here now, and both read it.
export const ALBUM_ASSET_COLUMNS = 'id, background_theme, logo_url, header_image, sponsor_logos'

export type AlbumAssets = {
  background_theme?: string | null
  logo_url?: string | null
  header_image?: string | null
  /** jsonb: [{ id, url, name }]. Stored as an array; read defensively, it comes from the database. */
  sponsor_logos?: unknown
}

type AlbumDeleteTarget = AlbumAssets & {
  id: string
}

/**
 * The R2 keys for an album's own design assets — everything that is NOT a photo.
 *
 * Only an UPLOADED background is a file. The built-in themes are stored in the same column as
 * `#ffe476` (a colour) or `stock:pexels-20954747` (a stock reference), and neither is an object in
 * the bucket — which is why the prefix is checked rather than the column being non-empty.
 */
export function albumAssetKeys(album: AlbumAssets): string[] {
  const keys: string[] = []
  // typeof-checked, not just null-checked. sponsor_logos is jsonb, so a url field can be a number
  // or an object if anything ever wrote one — and r2KeyFromUrl calls startsWith on it. That throws,
  // and it throws in the middle of deleting an album or of scanning the bucket, which is the worst
  // possible place to discover that a column can hold surprises. Caught by its own test.
  const add = (url: unknown) => {
    if (typeof url !== 'string') return
    const key = r2KeyFromUrl(url)
    if (key) keys.push(key)
  }

  add(album.background_theme?.startsWith('image:') ? album.background_theme.slice(6) : null)
  add(album.logo_url)
  add(album.header_image)

  // Defensive about the shape: this is jsonb, so it is whatever was written, and a bad row must not
  // take out a deletion or make the audit throw halfway through the bucket.
  if (Array.isArray(album.sponsor_logos)) {
    for (const entry of album.sponsor_logos) {
      if (entry && typeof entry === 'object' && 'url' in entry) add((entry as { url?: unknown }).url)
    }
  }
  return keys
}

export type PhotoToDelete = {
  storage_path: string | null
  storage_backend: 'r2' | 'stream'
  poster_url: string | null
  stream_uid: string | null
  thumb_url: string | null
}

// R2's delete() takes at most 1000 keys per call, and an over-long array fails the WHOLE batch.
//
// Every image contributes two keys (the original and its thumbnail), so any album past ~500 photos
// exceeded it -- and by then the database rows are already gone, so the failure orphans every
// object with no record left to retry from. Silent, permanent, and it grows with each large album
// anyone deletes. This is storage being paid for forever with nothing pointing at it.
//
// Chunked, and each chunk is independent: one failing batch must not take the others with it.
export async function deleteR2KeysChunked(
  bucket: { delete: (keys: string[]) => Promise<unknown> },
  keys: string[],
  label: string,
): Promise<void> {
  const CHUNK = 900   // under R2's 1000 ceiling, with room for the limit to be interpreted strictly
  for (let i = 0; i < keys.length; i += CHUNK) {
    const batch = keys.slice(i, i + CHUNK)
    try {
      await bucket.delete(batch)
    } catch (e) {
      console.error(`[${label}] R2 delete failed for ${batch.length} key(s):`, e instanceof Error ? e.message : String(e))
    }
  }
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

// WHICH FILES DOES DELETING THIS ALBUM REMOVE?
//
// Pulled out of deleteAlbumAssetsAndRows so it can be answered without a database. That function is
// forty lines of paging, deleting and error handling wrapped around this decision, and while the
// decision lived inside it the only way to check it was to mock Supabase — which proves the mock
// behaves, not that the code does. So the I/O stays there and the judgement lives here, where a
// test can hand it rows and read back exactly which keys it would destroy.
//
// The rules this encodes, each of which is a way to delete the wrong thing:
//   - a Stream video has no R2 original; its bytes live at Cloudflare and only its POSTER is in R2.
//     Reading storage_path for one would delete a file belonging to whatever else wrote that key.
//   - an R2 photo has no stream_uid; treating one as Stream would leave its original behind forever
//     and issue a delete against Cloudflare for a video that does not exist.
//   - a URL that cannot be parsed yields NOTHING rather than a guess. Orphaning a file costs
//     $0.015 per GB per month; deleting the wrong one costs somebody their wedding. See
//     r2KeyFromUrl, which fails closed for exactly this reason.
//   - the album's background image is an asset of the album, not of any photo, and is collected
//     separately or it is billed forever.
export function collectDeletionTargets(
  photos: PhotoToDelete[],
  backgroundTheme: string | null,
): { r2Keys: Set<string>; streamUids: Set<string> } {
  const r2Keys = new Set<string>()
  const streamUids = new Set<string>()

  for (const photo of photos) {
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

  // Only an uploaded background is a file; the built-in themes are names, not assets.
  const bgKey = r2KeyFromUrl(backgroundTheme?.startsWith('image:') ? backgroundTheme.slice(6) : null)
  if (bgKey) r2Keys.add(bgKey)

  return { r2Keys, streamUids }
}

/**
 * Remove from a delete set any key a SURVIVING row still points at.
 *
 * A photo row and the file it references are not one-to-one, and nothing in the schema makes them
 * so. Two rows in the same album may name the same thumbnail — and that is reachable on purpose:
 * a guest can post rows whose storage_path is a fresh uuid (so they insert) but whose thumb_url
 * copies a REAL photo's file. The rows render as broken tiles, which is precisely what makes an
 * owner delete them, and deleting them then destroyed the thumbnails of the photos they copied.
 * The owner's own moderation click was the weapon.
 *
 * Validation alone cannot close it: two uploads racing each other can both pass a
 * "not already used" check, and a rule enforced only at write time does nothing about rows
 * already stored. So the last word belongs here, at the moment of destruction, where the question
 * is simply "is anything still using this file?".
 *
 * Errs toward KEEPING bytes. A file left behind costs $0.015 per GB per month; a file destroyed
 * while a live row still points at it is a photo missing from somebody's wedding, and there is no
 * backup of R2 (rule 19).
 */
/** The file name of an R2 key — `albums/<id>/<uuid>.jpg` → `<uuid>.jpg`. */
export function keyFileName(key: string): string | null {
  const name = key.split('/').pop() ?? ''
  // Keys are minted server-side as `<uuid>.<ext>`; anything else is not ours to match on, and a
  // value with a PostgREST metacharacter in it must never reach a filter string.
  return /^[A-Za-z0-9._-]+$/.test(name) ? name : null
}

/**
 * Every row in this album that still references any of these R2 keys — ACROSS ALL URL COLUMNS.
 *
 * THE BUG THIS REPLACES, in two halves that both had to be fixed (rule 13):
 *
 *   The old lookup asked `thumb_url IN (<the exact string>)`, column by column. But the key a row
 *   RESOLVES to is not its URL string: `r2KeyFromUrl` strips a query string, so a stored
 *   `...jpg?x` names the same file while matching no exact-string query — and a guest can store
 *   exactly that, because it passes validatePhoto. It also compared `thumb_url` only against
 *   `thumb_url`, so a row whose thumb_url copied another row's poster_url was invisible to both
 *   halves. Either way the survivor set came back EMPTY, withoutStillReferenced filtered nothing,
 *   and the owner's delete took a real photo's thumbnail with it — permanently, with no backup and
 *   nothing able to regenerate it.
 *
 * So the match is on the file NAME, which is what actually identifies the object, and it is asked
 * of every column that can hold one. `like` with a name validated to [A-Za-z0-9._-] carries no
 * PostgREST metacharacter, so the filter cannot be broken out of.
 *
 * Throws on a query error rather than returning nothing: an empty survivor set means "delete it
 * all", and that must never be what a failed question looks like (rule 19).
 */
export async function rowsReferencingKeys(
  admin: AdminClient,
  albumId: string,
  r2Keys: Iterable<string>,
): Promise<PhotoToDelete[]> {
  const names = [...new Set([...r2Keys].map(keyFileName).filter((n): n is string => n !== null))]
  if (names.length === 0) return []

  const cols = 'id, storage_backend, storage_path, thumb_url, poster_url, stream_uid'
  const out: PhotoToDelete[] = []
  // Batched: the or-string grows with the number of names and PostgREST takes it in the URL.
  const PER_QUERY = 25
  for (let i = 0; i < names.length; i += PER_QUERY) {
    const slice = names.slice(i, i + PER_QUERY)
    const terms = slice.flatMap((n) => [
      `url.like.*${n}*`,
      `thumb_url.like.*${n}*`,
      `poster_url.like.*${n}*`,
      `storage_path.like.*${n}*`,
    ])
    const { data, error } = await admin
      .from('photos')
      .select(cols)
      .eq('album_id', albumId)
      .or(terms.join(','))
      // ORDERED, because a cap without one is not a deterministic subset. A survivor this query
      // fails to return is a live file deleted — the one direction that cannot be undone — so the
      // truncation must at least be repeatable rather than planner-dependent (same reasoning as
      // the paginated sweep below).
      .order('id', { ascending: true })
      .limit(500)
    if (error) throw new Error(`survivor lookup failed: ${error.message}`)
    out.push(...((data ?? []) as unknown as PhotoToDelete[]))
  }
  return out
}

export function withoutStillReferenced(
  targets: { r2Keys: Set<string>; streamUids: Set<string> },
  surviving: PhotoToDelete[],
): { r2Keys: Set<string>; streamUids: Set<string> } {
  const kept = collectDeletionTargets(surviving, null)
  return {
    r2Keys: new Set([...targets.r2Keys].filter((k) => !kept.r2Keys.has(k))),
    streamUids: new Set([...targets.streamUids].filter((u) => !kept.streamUids.has(u))),
  }
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
      // ORDERED, because .range() without it is not pagination — it is two independent queries.
      //
      // Postgres gives NO row-order guarantee without ORDER BY, so the planner is free to return
      // page two in a different order from page one. A row can then land in NEITHER page and be
      // skipped entirely. Here that means its R2 object and its Stream video are never collected
      // for deletion — and the album row is deleted moments later, so nothing is left that points
      // at the file. It is billed forever with no way to find it.
      //
      // id is the stable total order: it is the primary key, so it is unique and never ties.
      // Only bites on albums past PAGE_SIZE (1000) — the largest live album is 1,378, so this is
      // reachable today, not theoretical.
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
      .returns<PhotoToDelete[]>()

    if (photosError) {
      console.error('[album/delete] photo lookup failed:', photosError.message)
      return { ok: false, error: 'Could not prepare album deletion' }
    }

    // The decision itself lives in collectDeletionTargets, where it can be tested without a
    // database. Only the paging is here.
    const page = collectDeletionTargets(batch ?? [], null)
    for (const k of page.r2Keys) r2Keys.add(k)
    for (const u of page.streamUids) streamUids.add(u)

    if (!batch || batch.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  // The album's own design assets — background, logo, header, sponsor marks — collected once
  // rather than per page. Three of these four were never collected at all before.
  for (const k of albumAssetKeys(album)) r2Keys.add(k)

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
        await deleteR2KeysChunked(bucket, [...r2Keys], 'album/delete')
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
