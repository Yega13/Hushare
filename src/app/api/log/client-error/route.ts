import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Body = {
  source?: unknown
  message?: unknown
  level?: unknown
  albumId?: unknown
  context?: unknown
}

// Best-effort telemetry sink: the client reports real upload failures and recovered-after-retry
// near-misses here so they show up in /admin. Never blocks the user; returns 204 regardless.
export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  // Bound table growth from a single (possibly shared-NAT) IP. failOpen: keep the signal on a
  // limiter blip — losing an error log is worse than the tiny risk of a few extra rows.
  const rl = await checkRateLimit(clientIpKey(req, 'client_error_log'), 3600, 500, { failOpen: true })
  if (!rl.ok) return new NextResponse(null, { status: 204, headers: NO_STORE })

  const body = await req.json().catch(() => null) as Body | null
  if (!body) return new NextResponse(null, { status: 204, headers: NO_STORE })

  const source = typeof body.source === 'string' ? body.source.slice(0, 60) : ''
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 500) : ''
  if (!source || !message) return new NextResponse(null, { status: 204, headers: NO_STORE })

  const level = body.level === 'warn' ? 'warn' : 'error'
  const albumId = typeof body.albumId === 'string' && UUID_RE.test(body.albumId) ? body.albumId : null
  // Keep context tiny — cap the serialized size so a hostile client can't bloat the row.
  let context: unknown = null
  if (body.context && typeof body.context === 'object') {
    const s = JSON.stringify(body.context)
    if (s.length <= 800) context = body.context
  }
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 300) || null

  const admin = createAdminClient()

  // Coalesce a repeat of the SAME incident instead of writing another row.
  //
  // The uploader already groups a batch's failures into one report per reason. What it cannot group
  // is across batches, and the recovery path produces a great many tiny ones: a file parks, the
  // auto-resume retries it alone, that batch of one fails and reports on its own. One photographer
  // having one bad evening on 2026-08-22 produced over a hundred rows this way, which made a single
  // recurring problem look like a hundred separate disasters and buried the two rows that mattered.
  //
  // Same level, source, message and album inside a five-minute window is the same story. The first
  // row stands and its `repeats` counter goes up, so nothing is lost -- the count is visible, the
  // timeline is not shredded, and the table stops growing linearly with how badly one upload went.
  //
  // Deliberately keyed on the MESSAGE, which is why every message in the upload path is written to
  // be stable: per-file numbers live in context precisely so they cannot fragment this.
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  let q = admin
    .from('error_events')
    .select('id, context')
    .eq('level', level)
    .eq('source', source)
    .eq('message', message)
    .is('resolved_at', null)
    .gte('created_at', since)
  // Matched on album too, so two different albums hitting the same problem stay two stories. `.eq`
  // cannot express NULL in PostgREST, hence the branch rather than a ternary inside the filter.
  q = albumId ? q.eq('album_id', albumId) : q.is('album_id', null)

  const { data: recent } = await q
    .order('created_at', { ascending: false })
    .limit(1)
    .returns<{ id: string; context: Record<string, unknown> | null }[]>()

  const prior = recent?.[0]
  if (prior) {
    const priorCtx = (prior.context ?? {}) as Record<string, unknown>
    const repeats = typeof priorCtx.repeats === 'number' ? priorCtx.repeats : 1
    const incoming = (context ?? {}) as Record<string, unknown>

    // Merge rather than discard. The first version of this kept only the FIRST report's context,
    // which quietly threw away every later one -- including directCause/relayCause, the fields
    // added the day before precisely to explain a failure that is stable by design and therefore
    // coalesces every single time. One sample and a count is not the same as knowing.
    //
    // Only keys the stored row is MISSING are adopted, so the first occurrence stays the sample
    // and a later report cannot rewrite history; but a diagnostic that only some occurrences carry
    // still survives instead of being lost to whichever one happened to arrive first.
    const merged: Record<string, unknown> = { ...priorCtx }
    for (const [k, v] of Object.entries(incoming)) {
      if (merged[k] === undefined && v !== undefined && v !== null) merged[k] = v
    }
    merged.repeats = repeats + 1
    // The row keeps its original created_at so the timeline is not shredded, which means nothing
    // otherwise says an old-looking row is still happening RIGHT NOW.
    merged.lastSeen = new Date().toISOString()
    // One incident across several devices is a different problem from one device failing
    // repeatedly, and collapsing rows hides the difference. A flag is enough to tell them apart
    // without letting context grow with every reporter.
    if (ua && typeof priorCtx.firstUa === 'string' && priorCtx.firstUa !== ua) merged.multiDevice = true
    else if (ua && priorCtx.firstUa === undefined) merged.firstUa = ua.slice(0, 80)

    const { error } = await admin
      .from('error_events')
      .update({ context: merged })
      .eq('id', prior.id)
    if (error) console.error('[client-error] repeat update failed:', error.message)
    return new NextResponse(null, { status: 204, headers: NO_STORE })
  }

  const { error } = await admin.from('error_events').insert({ level, source, message, album_id: albumId, context, ua })
  if (error) console.error('[client-error] insert failed:', error.message)

  // Probabilistic prune (1%) so the table self-bounds without a dedicated cron dependency.
  if (Math.random() < 0.01) void admin.rpc('prune_error_events')

  return new NextResponse(null, { status: 204, headers: NO_STORE })
}
