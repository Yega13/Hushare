import { NextResponse } from 'next/server'
import { timingSafeEqual } from '@/lib/timing-safe'
import { queueBibIndex } from '@/lib/server/bib-index'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// INTERNAL ONLY. One link in the bib-indexing chain: a Worker's post-response budget only covers
// about a dozen photos, so each sweep asks a fresh invocation (this route) to run the next batch.
// Not reachable by users: it requires the server-side service-role secret, which never reaches a
// browser. Deliberately NOT cross-site protected the way user routes are, because the caller is
// our own Worker rather than a browser — the secret is what authorises it.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { albumId?: unknown; depth?: unknown; secret?: unknown } | null
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

  if (!expected || typeof body?.secret !== 'string' || !timingSafeEqual(body.secret, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  }
  if (typeof body.albumId !== 'string' || !UUID_RE.test(body.albumId)) {
    return NextResponse.json({ error: 'Invalid albumId' }, { status: 400, headers: NO_STORE })
  }
  const depth = typeof body.depth === 'number' && Number.isFinite(body.depth) ? Math.max(0, Math.trunc(body.depth)) : 0

  // Respond immediately; the batch (and the next link) run after the response.
  queueBibIndex(body.albumId, depth)
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
