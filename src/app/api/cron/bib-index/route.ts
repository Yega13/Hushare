import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { timingSafeEqual } from '@/lib/timing-safe'
import { indexAlbumBibsBatch, BIB_BATCH } from '@/lib/server/bib-index'
import { indexAlbumFacesBatch, FACE_BATCH } from '@/lib/server/face-sweep'
import { createSubrequestBudget } from '@/lib/server/index-budget'

export const runtime = 'nodejs'
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' }

// Wall-clock budget for one run. Work happens INSIDE the request (not waitUntil), because the
// post-response budget only covers ~11 photos — measured, and it stalled a 69-photo album at 12.
// Nothing is waiting on this response, so a long request is free; the cap just guarantees we
// finish well inside the Worker's limit and hand control back cleanly.
const TIME_BUDGET_MS = 25_000

// Subrequest accounting lives in lib/server/index-budget so the test can exercise the real
// thing rather than a copy of it. See that file for the arithmetic and why it is shaped this way.

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
  // ORDERED, because the read below is paged by the driver and an unordered result has no defined
  // sequence; the rotation underneath needs a stable list to rotate.
  const { data: albums } = await admin
    .from('albums')
    .select('id, bib_search_enabled, face_finder_enabled')
    .or('bib_search_enabled.eq.true,face_finder_enabled.eq.true')
    .is('retired_at', null)
    .order('id', { ascending: true })
    .returns<{ id: string; bib_search_enabled: boolean; face_finder_enabled: boolean }[]>()

  // WHOEVER IS FIRST GETS THE BUDGET, so nobody may be first every time.
  //
  // Once the budget can run out mid-loop, a fixed order means the album at the end of the list is
  // swept only with whatever the ones before it left over — and on a busy day, never. That is not
  // a slow album, it is an album whose runners are permanently told they are not in any photos.
  // Rotating the start by the minute gives every album its turn at the front within a few ticks.
  const list = albums ?? []
  const start = list.length > 0 ? Math.floor(Date.now() / 60_000) % list.length : 0
  const ordered = [...list.slice(start), ...list.slice(0, start)]

  const budget = createSubrequestBudget()
  const anythingAffordable = (): boolean => budget.affordable(Math.min(BIB_BATCH, FACE_BATCH)) > 0

  let bibBatches = 0
  let faceBatches = 0
  let albumsTouched = 0
  const errors: string[] = []
  let budgetExhausted = false
  for (const album of ordered) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    if (!anythingAffordable()) { budgetExhausted = true; break }
    let touched = false
    // Per-album isolation. Rekognition can fail for one album (missing collection, throttling, a
    // credential problem) and without this the throw escapes the whole handler, so a single bad
    // album silently stops indexing for EVERY album. Errors are collected and returned instead.
    try {

    // Bib and faces are INTERLEAVED, not run one after the other. Running bib to completion first
    // starved faces completely — measured on a 600-photo album, bib consumed every tick's budget
    // and faces sat at 0 indexed after 5 minutes. On a 3000-photo race album that ordering would
    // have left Face Finder empty for hours after the photos were up.
    //
    // Both also run CONCURRENTLY within a round: they are waiting on AWS, not competing for CPU,
    // so overlapping them roughly halves the wall-clock time for an album that uses both.
    // ONE batch of each per invocation, alternating ticks — not a loop, and not both at once.
    // Cloudflare's free plan allows 50 subrequests per Worker invocation and each photo costs
    // roughly three (fetch the image, call Rekognition, write the row). Looping until the time
    // budget ran out therefore never finished a tick's work: it blew the subrequest ceiling and
    // every remaining photo in that invocation failed. Running bib and face together doubled it.
    // Throughput is now bounded by that ceiling (~15 photos/invocation) rather than by time, which
    // is the honest limit until the account moves to the paid plan (50 -> 1000 subrequests).
    if (album.bib_search_enabled) {
      const cap = budget.affordable(BIB_BATCH)
      if (cap > 0) {
        budget.charge(cap)
        const left = await indexAlbumBibsBatch(album.id, cap)
        bibBatches++; touched = true
        void left
      } else budgetExhausted = true
    }
    if (album.face_finder_enabled && Date.now() - started < TIME_BUDGET_MS) {
      const cap = budget.affordable(FACE_BATCH)
      if (cap > 0) {
        budget.charge(cap)
        const left = await indexAlbumFacesBatch(album.id, cap)
        faceBatches++; touched = true
        void left
      } else budgetExhausted = true
    }

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[cron/index] album', album.id, 'failed:', msg)
      errors.push(`${album.id}: ${msg}`.slice(0, 200))
    }

    if (touched) albumsTouched++
  }

  return NextResponse.json(
    // budgetExhausted is worth seeing on /admin: it means albums went unswept this tick, which is
    // the signal that the ceiling — not the queue — is what is pacing indexing before an event.
    { ok: true, albums: albumsTouched, bibBatches, faceBatches, errors, budgetExhausted, subrequestsBudgeted: budget.spent(), ms: Date.now() - started },
    { headers: NO_STORE },
  )
}
