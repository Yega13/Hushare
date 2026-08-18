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
    const { data: albums } = await admin
      .from('albums')
      .select('id')
      .eq('face_finder_enabled', true)
      .is('retired_at', null)
      .limit(200)
      .returns<{ id: string }[]>()

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

      try {
        await deleteCollection(album.id)
        // Order matters: the flag goes down FIRST. If the process dies between these two writes,
        // stopping short leaves an album with no collection and no indexing, which self-heals on
        // the next run. The reverse order would leave the flag up and re-enroll everything.
        await admin.from('albums').update({ face_finder_enabled: false }).eq('id', album.id)
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
