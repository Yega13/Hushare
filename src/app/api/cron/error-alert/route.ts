import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { timingSafeEqual } from '@/lib/timing-safe'
import { sendErrorSpikeEmail } from '@/lib/email'
import {
  tallyByAlbum, tallyByMessage, totalOccurrences, alertVerdict, albumBlockFor, parseAlertState,
  WINDOW_MINUTES, COALESCE_WINDOW_MINUTES,
} from '@/lib/error-alert-grouping'
import { attachAlbumOwners } from '@/lib/server/error-attribution'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Everything on /admin is a number you have to go and look at. On a race morning nobody is looking
// — the phone is in a pocket and 3000 photos are arriving from a field. This turns the dashboard
// into an alarm: if real failures start stacking up, it comes to you.
//
// Deliberately narrow. It watches level='error' only, so the free-cap and too-large warnings that
// make up most of a normal day cannot trigger it, and it needs a CLUSTER rather than a single
// event, because one guest on a dying connection is not an incident.
const STATE_KEY = 'error_alert_last_sent'
// Matches the 4s bound api/admin/stats uses for a comparable admin lookup.
const ENRICH_TIMEOUT_MS = 4000

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
    // ORDERED, because the 200 below is a sample and the email ranks "worst albums first" from it.
    // Without an order Postgres may return any 200 of the matching rows, so in the incident this
    // exists for — more than 200 coalesced rows in fifteen minutes — the ranking and the
    // and-N-more count were both drawn from an arbitrary subset. Newest first, so a truncated
    // sample is at least the most recent part of what is happening right now.
    .order('created_at', { ascending: false })
    .limit(200)
    .returns<{ album_id: string | null; message: string; source: string; ua: string | null; context: { repeats?: number } | null }[]>()
  if (error) {
    console.error('[cron/error-alert] query failed:', error.message)
    return NextResponse.json({ error: 'query failed' }, { status: 500, headers: NO_STORE })
  }

  const count = totalOccurrences(rows ?? [])
  // Weighted the same way, so the email names the message that is actually dominating rather than
  // whichever one happens to own the most rows. The top message is also the incident's SIGNATURE.
  const top = tallyByMessage(rows ?? [], 5)

  // WHETHER TO SEND AT ALL is one tested decision now. It was four comparisons in this handler, and
  // twelve mutations to them passed the whole suite — including setting the threshold to 100000,
  // after which the alarm can never fire again.
  const { data: state } = await admin
    .from('system_state').select('value').eq('key', STATE_KEY).maybeSingle<{ value: string }>()
  const verdict = alertVerdict({
    count,
    signature: top[0]?.[0] ?? '',
    previous: parseAlertState(state?.value),
    nowMs: Date.now(),
  })
  if (!verdict.send) {
    return NextResponse.json({ ok: true, count, alerted: false, reason: verdict.reason }, { headers: NO_STORE })
  }

  // Claim BEFORE sending. If the send then fails we lose one alert; if we sent first and the write
  // failed, every subsequent tick would send again — the failure that actually hurts.
  const nowIso = new Date().toISOString()
  await admin.from('system_state').upsert({
    key: STATE_KEY, value: JSON.stringify(verdict.nextState), updated_at: nowIso,
  })

  const devices = new Set((rows ?? []).map(r => (r.ua ?? '').match(/\((.*?)\)/)?.[1] ?? 'unknown'))

  // WHICH ALBUMS, AND WHOSE THEY ARE — through attachAlbumOwners, which already answers exactly
  // this question for the admin errors tab and the live-stats poll, and keeps three states apart
  // where the hand-rolled copy kept two (rule 13).
  //
  // BOUNDED BY A RACE, NOT BY try/catch. The cooldown is already claimed at this point, and this is
  // a query plus up to five GoTrue round trips with no timeout of their own. try/catch was the
  // first attempt and it does not bound a HANG — which is precisely the failure that costs the
  // hour: the tick claims the cooldown, waits forever, sends nothing, and the next 59 ticks are
  // suppressed. getUserById takes no AbortSignal, so the race is the only real bound available.
  //
  // Losing the album block is a small loss; losing the alarm is the one that matters (rule 19).
  const { albums: albumTallies, moreAlbums: unlistedByCap } = tallyByAlbum(rows ?? [], 5)
  const unresolved = albumTallies.map(t => ({ album_id: t.albumId, count: t.count, album: undefined }))
  let enriched: Array<{ album_id: string | null; count: number; album?: { title: string; slug: string; email: string } | null }> = []
  if (albumTallies.length > 0) {
    enriched = await Promise.race([
      attachAlbumOwners(admin, albumTallies.map(t => ({ album_id: t.albumId, count: t.count })))
        .catch((e: unknown) => {
          console.error('[cron/error-alert] album enrichment failed:', e instanceof Error ? e.message : String(e))
          return unresolved
        }),
      new Promise<typeof unresolved>((resolve) =>
        setTimeout(() => {
          console.error('[cron/error-alert] album enrichment timed out — sending without it')
          resolve(unresolved)
        }, ENRICH_TIMEOUT_MS)),
    ])
  }

  const { albums, moreAlbums, lookupFailed } = albumBlockFor(enriched, unlistedByCap)

  try {
    await sendErrorSpikeEmail(to, {
      count,
      windowMinutes: WINDOW_MINUTES,
      deviceCount: devices.size,
      top,
      albums,
      moreAlbums,
      lookupFailed,
    })
  } catch (e) {
    console.error('[cron/error-alert] send failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ ok: false, count, alerted: false, reason: 'send failed' }, { headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, count, alerted: true }, { headers: NO_STORE })
}
