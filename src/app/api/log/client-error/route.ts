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

  // 5,000/hour, not 500, and the reason the higher number is safe is coalescing.
  //
  // 500 guests behind one venue IP share this bucket, and a widespread failure — a bad deploy
  // producing chunk errors, a network the whole room is on — is exactly when they all report at
  // once. At 500/hour the panel stopped listening partway through the incident it exists to
  // show, and everything after that vanished with no trace. That is rule 20 aimed at the operator
  // instead of a guest: an empty panel meant "nothing is wrong" when it meant "we stopped
  // counting".
  //
  // What the old limit was really protecting was table growth, and that is bounded by something
  // else entirely: coalesce_error_event merges a repeat into the EXISTING row and increments a
  // counter, so a thousand identical reports are one row. The cost scales with distinct messages,
  // not with requests, and a hostile client sending garbage is capped by the same coalescing.
  const rl = await checkRateLimit(clientIpKey(req, 'client_error_log'), 3600, 5000, { failOpen: true })
  if (!rl.ok) {
    // SAY THAT WE STOPPED LISTENING, once per hour, in the panel itself. Silence and "nothing
    // went wrong" must not look the same on the one screen used to answer that question. This
    // rides the same coalescing, so a flood adds a counter to a single row rather than rows.
    void createAdminClient().rpc('coalesce_error_event', {
      p_level: 'warn',
      p_source: 'log:rate-limited',
      p_message: 'Client error reports were rate-limited — some reports from this network were not recorded',
      p_album_id: null,
      p_context: { limit_per_hour: 5000 },
      p_ua: null,
    })
    return new NextResponse(null, { status: 204, headers: NO_STORE })
  }

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

  // One atomic statement: find the matching recent row and increment it, or insert.
  //
  // The uploader already groups a batch's failures into one report per reason. What it cannot group
  // is across batches, and the recovery path produces a great many tiny ones -- a file parks,
  // auto-resume retries it alone, that batch of one fails and reports on its own. One photographer
  // having one bad evening produced over a hundred rows, which made a single recurring problem look
  // like a hundred separate disasters and buried the two rows that mattered.
  //
  // Done in the database rather than as SELECT-then-UPDATE here, because that pattern loses
  // increments: at an event many guests in one album hit the same failure within milliseconds, both
  // read the same counter, and both write the same value. Since the count is now the only surviving
  // record of an incident's size, undercounting it is not cosmetic. See
  // 20260824_coalesce_error_event.sql for the merge rules.
  const { error } = await admin.rpc('coalesce_error_event', {
    p_level: level,
    p_source: source,
    p_message: message,
    p_album_id: albumId,
    p_context: context ?? {},
    p_ua: ua,
  })
  if (error) {
    // Never lose the report because the coalescing failed -- fall back to a plain insert.
    console.error('[client-error] coalesce rpc failed, inserting directly:', error.message)
    const { error: insErr } = await admin.from('error_events')
      .insert({ level, source, message, album_id: albumId, context, ua })
    if (insErr) console.error('[client-error] insert failed:', insErr.message)
  }

  // Probabilistic prune (1%) so the table self-bounds without a dedicated cron dependency.
  if (Math.random() < 0.01) void admin.rpc('prune_error_events')

  return new NextResponse(null, { status: 204, headers: NO_STORE })
}
