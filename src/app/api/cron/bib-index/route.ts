import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { timingSafeEqual } from '@/lib/timing-safe'
import { indexAlbumBibsBatch } from '@/lib/server/bib-index'
import { indexAlbumFacesBatch } from '@/lib/server/face-sweep'

export const runtime = 'nodejs'
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' }

// Wall-clock budget for one run. Work happens INSIDE the request (not waitUntil), because the
// post-response budget only covers ~11 photos — measured, and it stalled a 69-photo album at 12.
// Nothing is waiting on this response, so a long request is free; the cap just guarantees we
// finish well inside the Worker's limit and hand control back cleanly.
const TIME_BUDGET_MS = 25_000

// Sweeps bib indexing for every album that has it switched on and still has unread photos.
// Called once a minute by the scheduled handler (see worker.ts). This is the RELIABLE path:
// uploads also kick off an immediate sweep so the first photos are searchable within seconds,
// but that one is best-effort and gets cut short — this is what guarantees an album finishes.
export async function POST(req: Request) {
  const secret = process.env.ALBUM_RETIREMENT_SECRET ?? ''
  const auth = req.headers.get('Authorization') ?? ''
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!secret || !timingSafeEqual(provided, secret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  }

  const started = Date.now()
  const admin = createAdminClient()

  // Albums that opted in. Small list in practice — only race albums ever turn this on.
  const { data: albums } = await admin
    .from('albums')
    .select('id, bib_search_enabled, face_finder_enabled')
    .or('bib_search_enabled.eq.true,face_finder_enabled.eq.true')
    .is('retired_at', null)
    .returns<{ id: string; bib_search_enabled: boolean; face_finder_enabled: boolean }[]>()

  let bibBatches = 0
  let faceBatches = 0
  let albumsTouched = 0
  const errors: string[] = []
  for (const album of albums ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    let touched = false
    // Per-album isolation. Rekognition can fail for one album (missing collection, throttling, a
    // credential problem) and without this the throw escapes the whole handler, so a single bad
    // album silently stops indexing for EVERY album. Errors are collected and returned instead.
    try {

    // Bib numbers first: on a race album the number is what a runner actually types, and it is the
    // cheaper of the two to read.
    if (album.bib_search_enabled) {
      let remaining = 1
      while (remaining > 0 && Date.now() - started < TIME_BUDGET_MS) {
        remaining = await indexAlbumBibsBatch(album.id)
        bibBatches++
        touched = true
      }
    }

    // Faces used to be indexed one photo per HTTP request, driven by whichever guest happened to
    // open Face Finder first — unusable on an album of a couple of thousand photos. Sweeping it
    // here means photos are searchable within minutes of upload instead of on first demand.
    if (album.face_finder_enabled) {
      let remaining = 1
      while (remaining > 0 && Date.now() - started < TIME_BUDGET_MS) {
        remaining = await indexAlbumFacesBatch(album.id)
        faceBatches++
        touched = true
      }
    }

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[cron/index] album', album.id, 'failed:', msg)
      errors.push(`${album.id}: ${msg}`.slice(0, 200))
    }

    if (touched) albumsTouched++
  }

  return NextResponse.json(
    { ok: true, albums: albumsTouched, bibBatches, faceBatches, errors, ms: Date.now() - started },
    { headers: NO_STORE },
  )
}
