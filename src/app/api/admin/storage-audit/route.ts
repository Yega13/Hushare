import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAccountAdmin } from '@/lib/auth'
import { r2KeyFromUrl, albumAssetKeys, ALBUM_ASSET_COLUMNS } from '@/lib/album-delete'

export const runtime = 'nodejs'
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' }

// WHAT IS IN THE BUCKET THAT NOTHING POINTS AT.
//
// Every deletion path in this app works from database rows: delete a photo, it looks up that row's
// storage_path and thumbnail and removes them. Which means an object with NO row is unreachable —
// nothing will ever find it, nothing will ever delete it, and it is paid for every month forever.
//
// They are created by ordinary failure, not by bugs alone: an upload that presigned and finished
// writing to R2 but never got its row in (tab closed, network dropped at exactly the wrong moment),
// and any delete where the R2 binding was unavailable, which the delete path logs as "orphaning
// keys" because there is nothing better it can do at that moment.
//
// Counting rows against the bucket suggested ~3,200 unaccounted objects out of 30,481 — around 12%
// — but that was arithmetic on two numbers, not a measurement, and the gap could equally have been
// something legitimate nobody thought to count. This measures it: list the bucket, build the set of
// keys the database can account for, and report the difference.
//
// IT DELETES NOTHING. Storage is cheap and a wrong deletion is somebody's wedding, so the numbers
// come first and any sweeper is a separate decision made with them in hand.
type Audit = {
  scannedObjects: number
  scannedBytes: number
  referencedObjects: number
  orphanObjects: number
  orphanBytes: number
  truncated: boolean
  byPrefix: { prefix: string; objects: number; bytes: number }[]
  sample: string[]
}

// A Worker has a wall-clock budget and the listing is the slow part, so a very large bucket stops
// early and says so rather than dying halfway and reporting nothing. 200 pages is 200,000 objects.
const MAX_PAGES = 200

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAccountAdmin(user)) {
    // 404, not 403: an admin-only endpoint should not confirm it exists to anyone else.
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  }

  const ctx = getCloudflareContext()
  const bucket = (ctx?.env as { R2_BUCKET?: R2BucketLike } | undefined)?.R2_BUCKET
  if (!bucket) {
    return NextResponse.json({ error: 'R2 binding unavailable' }, { status: 503, headers: NO_STORE })
  }

  // EVERY KEY THE DATABASE CAN ACCOUNT FOR.
  //
  // Paged deliberately: this is the set an orphan is defined against, so a page silently missing
  // from it turns real, referenced files into "orphans". Ordered by id — an unordered .range() is
  // not pagination and can skip rows entirely, which here would mean reporting somebody's photos as
  // safe to delete. (See tests/source-hygiene.test.ts; it cost an album's files once already.)
  const admin = createAdminClient()
  const referenced = new Set<string>()
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from('photos')
      .select('storage_path, thumb_url, poster_url, mirror_url')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) {
      console.error('[admin/storage-audit] photo page failed:', error.message)
      return NextResponse.json({ error: 'Could not read photos' }, { status: 500, headers: NO_STORE })
    }
    for (const p of data ?? []) {
      if (p.storage_path) referenced.add(p.storage_path)
      for (const url of [p.thumb_url, p.poster_url, p.mirror_url]) {
        const key = r2KeyFromUrl(url)
        if (key) referenced.add(key)
      }
    }
    if (!data || data.length < PAGE) break
  }

  // ALBUM-LEVEL ASSETS, ALL OF THEM.
  //
  // This read logo_url and nothing else, so every uploaded background, header image and sponsor
  // mark on the site was counted as an orphan — an object nothing points at. This endpoint exists
  // to inform a decision about deleting orphans, and its sample of keys is printed specifically to
  // be checked by hand, so those were real customer files offered up for deletion. A sponsor logo
  // is contractual; a header image is something a Max customer uploaded on purpose.
  //
  // albumAssetKeys is the same function album deletion uses, so the two cannot disagree again about
  // what an album owns.
  const { data: albums } = await admin.from('albums').select(ALBUM_ASSET_COLUMNS)
  for (const a of albums ?? []) {
    for (const key of albumAssetKeys(a as Parameters<typeof albumAssetKeys>[0])) referenced.add(key)
  }

  // Profile pictures are not album assets at all — nothing in the album tables points at them, so
  // without this every avatar on the site reads as an orphan too.
  const { data: profiles } = await admin.from('profiles').select('avatar_url')
  for (const pr of profiles ?? []) {
    const key = r2KeyFromUrl((pr as { avatar_url: string | null }).avatar_url)
    if (key) referenced.add(key)
  }

  let scannedObjects = 0
  let scannedBytes = 0
  let orphanObjects = 0
  let orphanBytes = 0
  let truncated = false
  const prefixes = new Map<string, { objects: number; bytes: number }>()
  const sample: string[] = []

  let cursor: string | undefined
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) { truncated = true; break }
    const listed = await bucket.list({ limit: 1000, cursor })
    for (const obj of listed.objects) {
      scannedObjects++
      scannedBytes += obj.size
      const prefix = obj.key.split('/')[0] || '(root)'
      const bucketRow = prefixes.get(prefix) ?? { objects: 0, bytes: 0 }
      bucketRow.objects++; bucketRow.bytes += obj.size
      prefixes.set(prefix, bucketRow)
      if (!referenced.has(obj.key)) {
        orphanObjects++
        orphanBytes += obj.size
        // A handful of real keys, so the number can be checked by hand before anyone acts on it.
        if (sample.length < 20) sample.push(obj.key)
      }
    }
    if (!listed.truncated) break
    cursor = listed.cursor
  }

  const audit: Audit = {
    scannedObjects,
    scannedBytes,
    referencedObjects: referenced.size,
    orphanObjects,
    orphanBytes,
    truncated,
    byPrefix: [...prefixes.entries()]
      .map(([prefix, v]) => ({ prefix, ...v }))
      .sort((a, b) => b.bytes - a.bytes),
    sample,
  }
  return NextResponse.json(audit, { headers: NO_STORE })
}

type R2BucketLike = {
  list(opts: { limit?: number; cursor?: string }): Promise<{
    objects: { key: string; size: number }[]
    truncated: boolean
    cursor?: string
  }>
}
