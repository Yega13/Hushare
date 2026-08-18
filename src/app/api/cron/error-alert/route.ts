import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { timingSafeEqual } from '@/lib/timing-safe'
import { sendErrorSpikeEmail } from '@/lib/email'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Everything on /admin is a number you have to go and look at. On a race morning nobody is looking
// — the phone is in a pocket and 3000 photos are arriving from a field. This turns the dashboard
// into an alarm: if real failures start stacking up, it comes to you.
//
// Deliberately narrow. It watches level='error' only, so the free-cap and too-large warnings that
// make up most of a normal day cannot trigger it, and it needs a CLUSTER rather than a single
// event, because one guest on a dying connection is not an incident.
const WINDOW_MINUTES = 10
const THRESHOLD = 8
// One message per incident, not one per minute for as long as it lasts. An alert that arrives 40
// times gets muted by its reader, which is worse than no alert at all.
const COOLDOWN_MINUTES = 60
const STATE_KEY = 'error_alert_last_sent'

export async function POST(req: Request) {
  const secret = process.env.ALBUM_RETIREMENT_SECRET ?? ''
  const auth = req.headers.get('Authorization') ?? ''
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!secret || !timingSafeEqual(provided, secret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  }

  const to = process.env.ERROR_ALERT_EMAIL
  if (!to) return NextResponse.json({ ok: true, skipped: 'ERROR_ALERT_EMAIL not set' }, { headers: NO_STORE })

  const admin = createAdminClient()
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString()

  const { data: rows, error } = await admin
    .from('error_events')
    .select('message, source, ua')
    .eq('level', 'error')
    .gte('created_at', since)
    .limit(200)
    .returns<{ message: string; source: string; ua: string | null }[]>()
  if (error) {
    console.error('[cron/error-alert] query failed:', error.message)
    return NextResponse.json({ error: 'query failed' }, { status: 500, headers: NO_STORE })
  }

  const count = rows?.length ?? 0
  if (count < THRESHOLD) return NextResponse.json({ ok: true, count, alerted: false }, { headers: NO_STORE })

  // Cooldown is checked AFTER the threshold so a quiet period does not consume it, and read from
  // the database rather than memory because each cron tick is a fresh isolate with no recollection
  // of the previous one.
  const { data: state } = await admin
    .from('system_state').select('value').eq('key', STATE_KEY).maybeSingle<{ value: string }>()
  const last = state?.value ? Date.parse(state.value) : 0
  if (Number.isFinite(last) && Date.now() - last < COOLDOWN_MINUTES * 60_000) {
    return NextResponse.json({ ok: true, count, alerted: false, reason: 'cooldown' }, { headers: NO_STORE })
  }

  // Claim the cooldown BEFORE sending. If the send then fails we lose one alert; if we sent first
  // and the write failed, every subsequent tick would send again — the failure that actually hurts.
  const nowIso = new Date().toISOString()
  await admin.from('system_state').upsert({ key: STATE_KEY, value: nowIso, updated_at: nowIso })

  const tally = new Map<string, number>()
  for (const r of rows ?? []) tally.set(r.message, (tally.get(r.message) ?? 0) + 1)
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const devices = new Set((rows ?? []).map(r => (r.ua ?? '').match(/\((.*?)\)/)?.[1] ?? 'unknown'))

  try {
    await sendErrorSpikeEmail(to, {
      count,
      windowMinutes: WINDOW_MINUTES,
      deviceCount: devices.size,
      top,
    })
  } catch (e) {
    console.error('[cron/error-alert] send failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ ok: false, count, alerted: false, reason: 'send failed' }, { headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, count, alerted: true }, { headers: NO_STORE })
}
