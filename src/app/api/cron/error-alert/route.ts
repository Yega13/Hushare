import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { timingSafeEqual } from '@/lib/timing-safe'
import { sendErrorSpikeEmail } from '@/lib/email'
import { tallyByAlbum, tallyByMessage, totalOccurrences } from '@/lib/error-alert-grouping'
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

  // WHICH ALBUMS, AND WHOSE THEY ARE — through attachAlbumOwners, which already answers exactly
  // this question for the admin errors tab and the live-stats poll.
  //
  // This was hand-rolled here: the same albums query, the same getUserById, forty lines from a
  // tested module that does it better. Two things came free from deleting it. It keeps THREE states
  // apart where the copy kept two — a lookup that merely failed now reads '(unknown user)' rather
  // than '(no account)', so a transient GoTrue blip can no longer tell the operator that a paying
  // customer is uncontactable. And the admin page and this email can no longer disagree about the
  // same album in the same incident, which they would have (rule 13).
  // WRAPPED, BECAUSE THE COOLDOWN IS ALREADY CLAIMED. Everything above this point is arithmetic;
  // this is a database query plus up to five GoTrue round trips, none of them with a timeout, and
  // they run AFTER the hour has been spent at the upsert above. If any of them hangs or the isolate
  // dies, the incident is silenced for a full hour and no email is sent at all.
  //
  // So the enrichment is allowed to fail and the alert still goes out — with the count, the
  // messages, and no album block. A number-only alert is the one this replaced and is far better
  // than silence (rule 19: the uncertain branch must not be the one that loses the alarm).
  const { albums: albumTallies, moreAlbums: unlistedByCap } = tallyByAlbum(rows ?? [], 5)
  let enriched: Array<{ album_id: string | null; count: number; album?: { title: string; slug: string; email: string } | null }> = []
  try {
    enriched = albumTallies.length > 0
      ? await attachAlbumOwners(admin, albumTallies.map(t => ({ album_id: t.albumId, count: t.count })))
      : []
  } catch (e) {
    console.error('[cron/error-alert] album enrichment failed:', e instanceof Error ? e.message : String(e))
    enriched = albumTallies.map(t => ({ album_id: t.albumId, count: t.count, album: undefined }))
  }

  // `album: undefined` means the lookup itself failed; `null` means that album is gone. Only the
  // second is a reason to drop a row. Reporting an album we could not name still tells the operator
  // where to look, and silently dropping it would shrink the list for a reason that has nothing to
  // do with the incident (rule 20).
  const lookupFailed = enriched.length > 0 && enriched.every(r => r.album === undefined)
  const albums = enriched
    .filter(r => r.album !== null)
    .map(r => ({
      slug: r.album?.slug ?? '',
      title: r.album?.title ?? '(could not read this album)',
      count: r.count,
      owner: r.album?.email ?? '(unknown user)',
    }))

  // RECOMPUTED AFTER RESOLUTION, not before. tallyByAlbum only knows how many albums the cap left
  // out; albums deleted between the failure and this tick are dropped above, and counting only the
  // first number told the reader "and 3 more" while 5 were unlisted. In the degenerate case — every
  // album dropped — the HTML omitted the block entirely while the plain text still printed a bare
  // "and 2 more albums" pointing at nothing, in the lock-screen preview.
  const moreAlbums = unlistedByCap + (albumTallies.length - albums.length)

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
