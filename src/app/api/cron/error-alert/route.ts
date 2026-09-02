import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { timingSafeEqual } from '@/lib/timing-safe'
import { sendErrorSpikeEmail } from '@/lib/email'
import { tallyByAlbum, tallyByMessage, totalOccurrences } from '@/lib/error-alert-grouping'

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
// Must match the coalescing window in api/log/client-error.
const COALESCE_WINDOW_MINUTES = 5
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
  // Widened by the coalescing window, and counted by REPEATS rather than by rows.
  //
  // api/log/client-error merges a repeat of the same (level, source, message, album) into the
  // existing row within five minutes and increments context.repeats. Counting rows after that
  // change silently disarmed this alarm: one message failing a hundred times in one album -- the
  // exact incident this exists to catch -- becomes at most two rows in a ten-minute window, which
  // never reaches a threshold of eight. It would have required eight DISTINCT messages, and one
  // widespread problem by definition does not produce those.
  //
  // The window is widened by the same five minutes because a row that is actively absorbing
  // repeats keeps its ORIGINAL created_at, so it can sit just outside a ten-minute window while
  // still being the thing going wrong right now.
  const since = new Date(Date.now() - (WINDOW_MINUTES + COALESCE_WINDOW_MINUTES) * 60_000).toISOString()

  const { data: rows, error } = await admin
    .from('error_events')
    // album_id is what turns "23 things failed" into something anyone can act on. It was always in
    // the table and simply never selected, so every alert sent the reader to /admin to work out by
    // hand which album was on fire.
    .select('album_id, message, source, ua, context')
    .eq('level', 'error')
    .gte('created_at', since)
    .limit(200)
    .returns<{ album_id: string | null; message: string; source: string; ua: string | null; context: { repeats?: number } | null }[]>()
  if (error) {
    console.error('[cron/error-alert] query failed:', error.message)
    return NextResponse.json({ error: 'query failed' }, { status: 500, headers: NO_STORE })
  }

  const count = totalOccurrences(rows ?? [])
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

  // Weighted the same way, so the email names the message that is actually dominating rather than
  // whichever one happens to own the most rows.
  const top = tallyByMessage(rows ?? [], 5)
  const devices = new Set((rows ?? []).map(r => (r.ua ?? '').match(/\((.*?)\)/)?.[1] ?? 'unknown'))

  // WHICH ALBUMS, AND WHOSE THEY ARE.
  //
  // Resolved here rather than in the email so the template stays a template. Anonymous albums are
  // reported as anonymous on purpose: two thirds of albums have no account, and "we cannot contact
  // this owner" is exactly the fact worth seeing at the moment something is failing for them —
  // silently omitting the line would read as "no problem here".
  const { albums: albumTallies, moreAlbums } = tallyByAlbum(rows ?? [], 5)
  const albums: { slug: string; title: string; count: number; ownerEmail: string | null }[] = []
  if (albumTallies.length > 0) {
    const { data: albumRows } = await admin
      .from('albums')
      .select('id, slug, custom_slug, title, user_id')
      .in('id', albumTallies.map(a => a.albumId))
      .returns<{ id: string; slug: string; custom_slug: string | null; title: string | null; user_id: string | null }[]>()
    const byId = new Map((albumRows ?? []).map(a => [a.id, a]))
    for (const t of albumTallies) {
      const a = byId.get(t.albumId)
      if (!a) continue                       // deleted between the failure and this tick
      let ownerEmail: string | null = null
      if (a.user_id) {
        // One lookup per named album, at most five, once an hour behind a cooldown.
        const { data: au } = await admin.auth.admin.getUserById(a.user_id)
        ownerEmail = au?.user?.email ?? null
      }
      albums.push({
        slug: a.custom_slug ?? a.slug,
        title: a.title ?? 'Untitled album',
        count: t.count,
        ownerEmail,
      })
    }
  }

  try {
    await sendErrorSpikeEmail(to, {
      count,
      windowMinutes: WINDOW_MINUTES,
      deviceCount: devices.size,
      top,
      albums,
      moreAlbums,
    })
  } catch (e) {
    console.error('[cron/error-alert] send failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ ok: false, count, alerted: false, reason: 'send failed' }, { headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, count, alerted: true }, { headers: NO_STORE })
}
