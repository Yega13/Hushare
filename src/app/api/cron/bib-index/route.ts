import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { timingSafeEqual } from '@/lib/timing-safe'
import { indexAlbumBibsBatch } from '@/lib/server/bib-index'

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
    .select('id')
    .eq('bib_search_enabled', true)
    .is('retired_at', null)
    .returns<{ id: string }[]>()

  let batches = 0
  let albumsTouched = 0
  for (const album of albums ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    let remaining = 1
    let touched = false
    // Keep batching this album until it's done or the budget runs out, then move on. Next run
    // picks up wherever this one stopped — indexing is idempotent, so nothing is redone.
    while (remaining > 0 && Date.now() - started < TIME_BUDGET_MS) {
      remaining = await indexAlbumBibsBatch(album.id)
      batches++
      touched = true
    }
    if (touched) albumsTouched++
  }

  return NextResponse.json(
    { ok: true, albums: albumsTouched, batches, ms: Date.now() - started },
    { headers: NO_STORE },
  )
}
