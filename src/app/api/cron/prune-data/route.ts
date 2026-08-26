import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { timingSafeEqual } from '@/lib/timing-safe'
import { deleteCollection } from '@/lib/rekognition'

export const runtime = 'nodejs'
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' }

// Enforces the retention periods the privacy policy states. Every number here is published, so if
// one changes it changes in both places or the policy becomes untrue again — which is exactly how
// this file came to exist.
//
// Before it, "IP address (kept briefly)" was a claim nothing implemented: rate_limit_events had a
// probabilistic sweep scoped to the SAME key, so a key that never recurred was never swept. On
// 2026-08-17 the table held 28,663 rows going back seven weeks.
const IP_LOG_DAYS = 30
const ERROR_LOG_DAYS = 30
// Matches the 24-hour cutoff api/upload/stream already intended for these — this route just makes
// it actually happen. Long enough that a genuinely slow upload finishing overnight still redeems.
const PENDING_UPLOAD_HOURS = 24
// Face templates are biometric data and cannot sit around indefinitely waiting for someone to
// delete an album. The clock runs from the last photo added, so an album that finished its event
// stops holding face data three months later whether or not anyone remembers to act.
const FACE_IDLE_DAYS = 90

export async function POST(req: Request) {
  const secret = process.env.ALBUM_RETIREMENT_SECRET ?? ''
  const auth = req.headers.get('Authorization') ?? ''
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!secret || !timingSafeEqual(provided, secret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const iso = (days: number) => new Date(Date.now() - days * 864e5).toISOString()
  const result: Record<string, unknown> = {}

  // Presence rows say which page someone has open, so the policy promises they are gone within 10
  // minutes of a visitor leaving. That promise used to rest on a Math.random() < 0.02 sweep during
  // INCOMING pings: expected closer to 25 minutes with one visitor, and unbounded once traffic
  // stopped, because the thing that cleans up only ran when there was something to clean up after.
  // Exactly the pattern the rate-limit note below complains about. This mode runs every minute
  // whether or not anyone is on the site, which is what makes the published number true.
  {
    const { error, count } = await admin
      .from('active_sessions')
      .delete({ count: 'exact' })
      .lt('last_seen', new Date(Date.now() - 10 * 60 * 1000).toISOString())
    result.presenceDeleted = error ? `error: ${error.message}` : (count ?? 0)
  }
  if (new URL(req.url).searchParams.get('mode') === 'presence') {
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE })
  }

  // ── Abuse / rate-limit records (contain raw IPs) ───────────────────────────
  {
    const { error, count } = await admin
      .from('rate_limit_events')
      .delete({ count: 'exact' })
      .lt('created_at', iso(IP_LOG_DAYS))
    result.rateLimitDeleted = error ? `error: ${error.message}` : (count ?? 0)
  }

  // ── Abandoned video-upload tokens ─────────────────────────────────────────
  //
  // A pending_stream_uploads row is a LIVE CREDENTIAL, not bookkeeping: api/album/photos/create
  // consumes one to accept a Cloudflare Stream uid onto an album. It is meant to last 24 hours.
  //
  // The only thing deleting them was `Math.random() < 0.01` inside api/upload/stream — a one-in-a
  // -hundred sweep that runs only when somebody starts ANOTHER video upload. Video is 1.5% of all
  // media here, so across the product's entire history that dice roll came up perhaps twice: on
  // 2026-08-26 the table still held rows from 13 July, six weeks past a 24-hour expiry, every one
  // of them still redeemable. Precisely the pattern the presence note above was written about —
  // cleanup that only runs when there is something to clean up after cannot keep a promise.
  //
  // On the daily pass, on a clock, whether or not anyone uploads anything.
  {
    const { error, count } = await admin
      .from('pending_stream_uploads')
      .delete({ count: 'exact' })
      .lt('created_at', new Date(Date.now() - PENDING_UPLOAD_HOURS * 3600e3).toISOString())
    result.pendingUploadsDeleted = error ? `error: ${error.message}` : (count ?? 0)
  }

  // ── Rate-limit counters ───────────────────────────────────────────────────
  //
  // One row per key per window, so this stays small by construction — but "small by construction"
  // is how rate_limit_events was described too, and it reached 62,846 rows. Windows are at most an
  // hour, so anything older than a day is finished and cannot affect a decision.
  {
    const { error, count } = await admin
      .from('rate_limit_counters')
      .delete({ count: 'exact' })
      .lt('window_start', iso(1))
    result.rateLimitCountersDeleted = error ? `error: ${error.message}` : (count ?? 0)
  }

  // ── Client error reports (carry user-agent and the page they happened on) ──
  {
    const { error, count } = await admin
      .from('error_events')
      .delete({ count: 'exact' })
      .lt('created_at', iso(ERROR_LOG_DAYS))
    result.errorEventsDeleted = error ? `error: ${error.message}` : (count ?? 0)
  }

  // ── Face collections for albums that have gone quiet ──────────────────────
  // Two things were wrong here and both defeated the published 90-day promise entirely.
  //
  // 1. The candidate filter was last_activity_at, which touchActivity() bumps on ANY album VIEW.
  //    The policy says "90 days with no new photo added". An album someone glances at once a month
  //    never became a candidate at all, so its face templates were kept forever. The photo check
  //    below was described as "belt and braces" but it only ever ran on albums that had already
  //    passed the wrong filter, so it could not save it. The clock now runs off the newest photo,
  //    which is the thing the policy actually names.
  //
  // 2. Deleting the collection was not enough. face_finder_enabled stayed true, and the every-minute
  //    bib-index cron selects purely on that flag with no activity filter of its own. It called
  //    ensureCollection() and re-enrolled every face within sixty seconds of the deletion, then did
  //    it again the next night, forever — so the most sensitive retention promise on the site was
  //    not just unenforced, it was actively undone, at full IndexFaces price every single day.
  //    Turning the flag off is what actually ends it. The owner can switch it back on, which
  //    re-indexes from scratch — a deliberate act by the person allowed to make it.
  {
    const cutoff = iso(FACE_IDLE_DAYS)
    // ORDER BY is not cosmetic here. LIMIT without it returns rows in whatever order Postgres
    // finds convenient, which can be the SAME 200 albums every night — leaving the rest holding
    // biometric templates indefinitely, past the 90 days the privacy policy publishes. Ordering by
    // id makes the set deterministic; once more than 200 albums use Face Finder this needs a
    // cursor, but a stable window is strictly better than an arbitrary one.
    const { data: albums } = await admin
      .from('albums')
      .select('id, created_at')
      .eq('face_finder_enabled', true)
      .is('retired_at', null)
      .order('id', { ascending: true })
      .limit(200)
      .returns<{ id: string; created_at: string }[]>()

    let expired = 0
    for (const album of albums ?? []) {
      const { data: recent } = await admin
        .from('photos')
        .select('id')
        .eq('album_id', album.id)
        .gt('created_at', cutoff)
        .limit(1)
        .returns<{ id: string }[]>()
      if (recent && recent.length > 0) continue

      // "No photo in 90 days" and "no photos yet" are the same query result and completely
      // different situations. An owner who sets up a race album the night before, switches Face
      // Finder on, and uploads nothing until the morning would have had the feature silently
      // turned off overnight and the collection deleted — the paid feature dead all race day, with
      // nobody told. An album created INSIDE the window has not finished an event, so there is
      // nothing to expire yet.
      //
      // Deliberately keyed on the album's own age, not on "has zero photos": an album that DID
      // hold photos and had them all deleted is genuinely finished, and its face data must still
      // expire on schedule. That is the promise this block exists to keep.
      if (album.created_at > cutoff) continue

      try {
        // The flag goes down FIRST, before the collection is deleted. If the isolate dies between
        // these two writes, the album is left with the flag down and its collection still present
        // — no re-enrolment, and the next run finishes the job. The reverse order leaves the flag
        // UP with the collection gone, and the every-minute indexer immediately re-enrols every
        // face at full IndexFaces price, which is the exact failure this block exists to prevent.
        // (The code previously deleted first while this comment claimed otherwise.)
        await admin.from('albums').update({ face_finder_enabled: false }).eq('id', album.id)
        await deleteCollection(album.id)
        // face_ids back to NULL means "never looked at", so a re-enable indexes from scratch
        // rather than trusting ids AWS no longer has.
        await admin.from('photos').update({ face_ids: null }).eq('album_id', album.id)
        expired++
      } catch (e) {
        console.error('[cron/prune-data] face collection expiry failed:', album.id, e instanceof Error ? e.message : String(e))
      }
    }
    result.faceCollectionsExpired = expired
  }

  return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE })
}
