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
  // Only albums that still have the feature on are considered: switching it off already deletes
  // the collection, and an album with it off has nothing left to expire.
  {
    const cutoff = iso(FACE_IDLE_DAYS)
    const { data: albums } = await admin
      .from('albums')
      .select('id')
      .eq('face_finder_enabled', true)
      .is('retired_at', null)
      .lt('last_activity_at', cutoff)
      .limit(25)
      .returns<{ id: string }[]>()

    let expired = 0
    for (const album of albums ?? []) {
      // Belt and braces: last_activity_at moves on any view, so confirm against the photos
      // themselves that nothing has actually been ADDED inside the window before deleting
      // biometric data.
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
        // face_ids back to NULL means "never looked at". If the owner ever switches the feature
        // back on, the sweep re-indexes from scratch rather than trusting ids AWS no longer has.
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
