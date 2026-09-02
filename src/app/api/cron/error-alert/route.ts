import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { timingSafeEqual } from '@/lib/timing-safe'
import { sendErrorSpikeEmail } from '@/lib/email'
import {
  tallyByAlbum, tallyByMessage, totalOccurrences, alertVerdict, albumBlockFor, parseAlertState,
  THRESHOLD,
  ALERT_WINDOW_MINUTES,
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
// How many rows the ranking and the count are drawn from. Named rather than inline, because the
// email has to say when it hit this: a sample must not report itself as a total.
const SAMPLE_LIMIT = 200

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
  const since = new Date(Date.now() - ALERT_WINDOW_MINUTES * 60_000).toISOString()

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
    .limit(SAMPLE_LIMIT)
    .returns<{ album_id: string | null; message: string; source: string; ua: string | null; context: { repeats?: number } | null }[]>()
  if (error) {
    console.error('[cron/error-alert] query failed:', error.message)
    return NextResponse.json({ error: 'query failed' }, { status: 500, headers: NO_STORE })
  }

  const count = totalOccurrences(rows ?? [])
  // AND WHETHER THAT COUNT IS THE WHOLE TRUTH. totalOccurrences sums at most SAMPLE_LIMIT rows, so a
  // genuine incident bigger than the sample was reported UNDERSTATED - the operator reads "200
  // things failed" for something that was five thousand, and sizes their response to the smaller
  // number. It cannot suppress the alarm (200 rows is far past the threshold of 8); it just makes
  // the headline false, which is the one thing an alert may not be (rule 20).
  const truncated = (rows?.length ?? 0) >= SAMPLE_LIMIT
  // Weighted the same way, so the email names the message that is actually dominating rather than
  // whichever one happens to own the most rows. The top message is also the incident's SIGNATURE.
  const top = tallyByMessage(rows ?? [], 5)

  // WHETHER TO SEND AT ALL is one tested decision now. It was four comparisons in this handler, and
  // twelve mutations to them passed the whole suite — including setting the threshold to 100000,
  // after which the alarm can never fire again.
  //
  // AND A STATE ROW WE COULD NOT READ IS NOT AN EMPTY ONE. This destructured `data` alone, so a
  // failed read produced `parseAlertState(undefined)` → null → "no previous alert": no cooldown, no
  // signature, no hourly counter. EVERY bound this route has lives in that one row, so if reads
  // start failing while writes keep working, the alarm sends on every single tick with nothing left
  // to stop it — the same unbounded mail loop the claim check one screen below already guards, from
  // the other direction.
  //
  // Errs toward one missed alert, which the next successful tick sends, rather than toward a mailbox
  // nobody can read (rule 19). A permanent read failure therefore means permanent silence, and this
  // log line is the only signal of it.
  const { data: state, error: stateErr } = await admin
    .from('system_state').select('value').eq('key', STATE_KEY).maybeSingle<{ value: string }>()
  if (stateErr) {
    console.error('[cron/error-alert] could not read the alert state — not sending, because every '
      + 'cooldown and the hourly ceiling live in that row:', stateErr.message)
    return NextResponse.json({ ok: false, count, alerted: false, reason: 'state unreadable' }, { headers: NO_STORE })
  }
  const previous = parseAlertState(state?.value)
  const verdict = alertVerdict({
    count,
    signature: top[0]?.[0] ?? '',
    // EVERY message big enough to be an incident by itself. Suppression compares this set, so a
    // single loud message — which anyone can manufacture through the unauthenticated client-error
    // endpoint — can no longer hide a genuine failure behind it.
    notable: tallyByMessage(rows ?? [], 20).filter(([, n]) => n >= THRESHOLD).map(([m]) => m),
    previous,
    nowMs: Date.now(),
  })
  if (!verdict.send) {
    return NextResponse.json({ ok: true, count, alerted: false, reason: verdict.reason }, { headers: NO_STORE })
  }

  // Claim BEFORE sending. If the send then fails we lose one alert; if we sent first and the write
  // failed, every subsequent tick would send again — the failure that actually hurts.
  //
  // AND THE CLAIM HAS TO STICK. This was awaited and its result thrown away, which made the ordering
  // above decorative: supabase-js returns { error } for a failed write rather than throwing, so a
  // claim that did not land was indistinguishable from one that did, the email went, and NOTHING was
  // recorded — so the next tick sent again, and the one after that, for as long as the incident
  // lasted. The cooldown AND the hourly ceiling both live in this row, so neither bounds it. That is
  // an unbounded mail loop during an incident: the precise failure the comment above claims this
  // ordering prevents.
  //
  // Not sending errs toward one missed alert, which the next tick sends (rule 19) — the alternative
  // errs toward a mailbox nobody can read at the moment they most need to.
  const nowIso = new Date().toISOString()
  const claim = await admin.from('system_state').upsert({
    key: STATE_KEY, value: JSON.stringify(verdict.nextState), updated_at: nowIso,
  }).then(
    (r: { error: { message: string } | null }) => r?.error?.message ?? null,
    (e: unknown) => (e instanceof Error ? e.message : String(e)),
  )
  if (claim !== null) {
    console.error('[cron/error-alert] could not claim the cooldown — not sending, to avoid a mail loop:', claim)
    return NextResponse.json({ ok: false, count, alerted: false, reason: 'cooldown not claimed' }, { headers: NO_STORE })
  }

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
    // CLEARED WHEN THE RACE IS OVER. Without this the timer still fired on a run that had already
    // succeeded, printing "album enrichment timed out — sending without it" four seconds after an
    // enrichment that worked and an email that had gone. A log line describing something that did
    // not happen is worse than no line: it is what somebody reads at 3am while deciding whether the
    // alert can be trusted (rule 20).
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      enriched = await Promise.race([
        attachAlbumOwners(admin, albumTallies.map(t => ({ album_id: t.albumId, count: t.count })))
          .catch((e: unknown) => {
            console.error('[cron/error-alert] album enrichment failed:', e instanceof Error ? e.message : String(e))
            return unresolved
          }),
        new Promise<typeof unresolved>((resolve) => {
          timer = setTimeout(() => {
            console.error('[cron/error-alert] album enrichment timed out — sending without it')
            resolve(unresolved)
          }, ENRICH_TIMEOUT_MS)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  const { albums, moreAlbums, lookupFailed } = albumBlockFor(enriched, unlistedByCap)

  try {
    await sendErrorSpikeEmail(to, {
      count,
      truncated,
      // THE WINDOW THAT WAS ACTUALLY QUERIED. This said WINDOW_MINUTES (10) while `since` above
      // looked back fifteen, so every alert ever sent named a window nobody had measured.
      windowMinutes: ALERT_WINDOW_MINUTES,
      deviceCount: devices.size,
      top,
      albums,
      moreAlbums,
      lookupFailed,
    })
  } catch (e) {
    console.error('[cron/error-alert] send failed:', e instanceof Error ? e.message : String(e))
    // A SEND THAT NEVER LEFT IS NOT A SEND. The claim is written before the send on purpose — if we
    // wrote it after, a failed write would make every tick send again — so the whole claim has to be
    // undone when the send fails, not just part of it.
    //
    // It used to give back only the hourly counter and KEEP sentAt and the signature, which meant
    // one 500 from the mail API bought sixty minutes of silence about the incident that was
    // actually happening: the next fifty-nine ticks all answered 'same-incident' for an alert that
    // was never delivered. Restoring the previous state and marking lastFailedAt means nothing was
    // consumed, and the next tick tries again after a short wait
    // (RETRY_AFTER_FAILURE_MINUTES) — which is the only reason that marker exists: without it a mail
    // outage would mean one failing API call every single tick.
    //
    // Best effort: if this write fails too the worst case is the old behaviour, which is why it is
    // not awaited into the response path.
    await admin.from('system_state').upsert({
      key: STATE_KEY,
      value: JSON.stringify({ ...(previous ?? {}), lastFailedAt: new Date().toISOString() }),
      updated_at: new Date().toISOString(),
    // READ THE RESULT, for the same reason the claim above does. This was `.then(() => {}, …)`, so a
    // PostgREST-class failure — which RESOLVES with { error } rather than throwing — landed in the
    // empty success handler and the slot was silently not released, with no log line at all. That is
    // the identical defect that was fixed on the claim eighty lines up, still live down here.
    //
    // With Resend down and writes being rejected, four ticks would each claim a slot, each fail to
    // send, and each fail to release — and the fifth gets `hourly-cap` for the rest of the hour with
    // zero emails delivered and nothing in the log. Exactly what this rollback exists to prevent.
    }).then(
      (r: { error: { message: string } | null } | null) => r?.error?.message ?? null,
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    ).then((releaseErr: string | null) => {
      if (releaseErr) console.error('[cron/error-alert] could not release the hourly slot:', releaseErr)
    })
    return NextResponse.json({ ok: false, count, alerted: false, reason: 'send failed' }, { headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, count, alerted: true }, { headers: NO_STORE })
}
