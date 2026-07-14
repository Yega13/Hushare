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
  const { error } = await admin.from('error_events').insert({ level, source, message, album_id: albumId, context, ua })
  if (error) console.error('[client-error] insert failed:', error.message)

  // Probabilistic prune (1%) so the table self-bounds without a dedicated cron dependency.
  if (Math.random() < 0.01) void admin.rpc('prune_error_events')

  return new NextResponse(null, { status: 204, headers: NO_STORE })
}
