import { NextResponse } from 'next/server'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Live-presence heartbeat. Every open tab pings this ~every 30s (see PresenceBeacon). We upsert one
// throwaway row keyed by a per-tab id so the admin dashboard can show a real-time active-user count,
// and occasionally prune long-dead rows. Same-origin only; no auth (any visitor is a "user").
export async function POST(req: Request) {
  const csrf = forbidCrossSiteRequest(req)
  if (csrf) return csrf

  // forbidCrossSiteRequest above is CSRF protection, not authentication — Origin is trivially set
  // by anything that is not a browser. Every request upserts a row keyed by a CLIENT-CHOSEN id, and
  // cleanup only removes rows older than 10 minutes, so an unlimited caller could hold tens of
  // thousands of rows in active_sessions and inflate the live-user counter at the same time.
  // failOpen: presence is cosmetic, and a limiter blip must not break the page it decorates.
  // SIZED FOR A ROOM, NOT FOR ONE CLIENT. Every per-IP limit in this product is fighting its own
  // use case: the entire point is many people at one venue, and cf-connecting-ip gives all of them
  // ONE bucket. 300 guests pinging once a minute is 300/min; 120 refused four fifths of them.
  // 3000 covers about 500 guests with headroom and still stops a runaway loop.
  const rl = await checkRateLimit(clientIpKey(req, 'presence'), 60, 3000, { failOpen: true })
  if (!rl.ok) return NextResponse.json({ ok: true, throttled: true }, { headers: NO_STORE })

  const body = await req.json().catch(() => null) as { id?: unknown; path?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id.slice(0, 64) : ''
  if (!id) return NextResponse.json({ error: 'bad id' }, { status: 400, headers: NO_STORE })
  const path = typeof body?.path === 'string' ? body.path.slice(0, 200) : null

  const admin = createAdminClient()
  await admin.from('active_sessions').upsert(
    { id, last_seen: new Date().toISOString(), path },
    { onConflict: 'id' },
  )

  // Opportunistic cleanup (~2% of pings) so dead rows can't accumulate forever.
  if (Math.random() < 0.02) {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    await admin.from('active_sessions').delete().lt('last_seen', cutoff)
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
