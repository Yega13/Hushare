import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deleteAlbumAssetsAndRows } from '@/lib/album-delete'
import { getUserTierById, getPaidRetentionUntil } from '@/lib/subscriptions'
import { timingSafeEqual } from '@/lib/timing-safe'
import { track } from '@/lib/analytics'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
// Retention policy: FREE albums auto-retire after 1 YEAR (365 days) of INACTIVITY — changed
// 2026-08-11 from 3 months, which was too aggressive and scared off new users. Truly abandoned
// albums still get cleaned up, just a full year out. Paid albums are kept while the subscription
// is active (tier check below) and for 1 year after it lapses (paid-grace check). See
// getPaidRetentionUntil.
//
// The published copy now matches: privacy policy, the site-wide JSON-LD FAQ in layout.tsx, the
// pricing and landing pages, and the support bot's system prompt all say 1 year (2026-08-16). They
// said 3 months for five days after this constant changed, which meant the privacy policy stated a
// retention period four times shorter than the one actually enforced. If this number ever changes
// again, grep for "1 year of inactivity" and change all of them in the same commit.
const RETIRE_AFTER_DAYS = 365
// Must mirror notify-expiry. The owner is warned this many days before the album expires, and it is
// not eligible for deletion until that long has actually passed since the warning was sent —
// otherwise "30 days' notice" would mean "a warning, then possibly deletion the same night".
const WARN_BEFORE_DAYS = 30
const BATCH_SIZE = 25

type RetirementCandidate = {
  id: string
  slug: string
  user_id: string | null
  background_theme: string | null
  last_activity_at: string
}

export async function POST(req: Request) {
  // Fail-closed: a missing secret in production means anyone could trigger
  // mass deletion of inactive free albums. Refuse to run unless set.
  const secret = process.env.ALBUM_RETIREMENT_SECRET
  if (!secret) {
    console.error('[retire-albums] ALBUM_RETIREMENT_SECRET not set; refusing to run')
    return NextResponse.json({ error: 'Not configured' }, { status: 503, headers: NO_STORE })
  }
  if (secret.length < 32) {
    console.error('[retire-albums] ALBUM_RETIREMENT_SECRET must be at least 32 characters')
    return NextResponse.json({ error: 'Not configured' }, { status: 503, headers: NO_STORE })
  }
  const auth = req.headers.get('authorization') ?? ''
  if (!timingSafeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const cutoff = new Date(Date.now() - RETIRE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const admin = createAdminClient()

  // Piggyback the daily run to prune the admin error log (keeps 30 days). Best-effort.
  void admin.rpc('prune_error_events')

  // A WARNING MUST HAVE BEEN SENT, and it must have had time to be acted on.
  //
  // This is the guarantee the privacy policy makes -- 30 days' notice before an inactive album is
  // removed -- and nothing enforced it. The query only checked the 365-day cutoff, so any album the
  // warning cron had missed (a failed send, or a backlog that pushed it out of its window) was
  // deleted with every photo in it having told the owner nothing.
  //
  // Requiring last_notification_at makes the two crons interlock: an album cannot be deleted until
  // it has been warned, so the worst a warning backlog can now do is DELAY a deletion. That is the
  // right direction to fail in.
  const warnedBefore = new Date(Date.now() - WARN_BEFORE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data: candidates, error } = await admin
    .from('albums')
    .select('id, slug, user_id, background_theme, last_activity_at')
    .is('retired_at', null)
    .lt('last_activity_at', cutoff)
    .not('last_notification_at', 'is', null)
    .lt('last_notification_at', warnedBefore)
    .order('last_activity_at', { ascending: true })
    .limit(BATCH_SIZE)
    .returns<RetirementCandidate[]>()

  if (error) {
    console.error('[retire-albums] candidate lookup failed:', error.message)
    return NextResponse.json({ error: 'Could not scan albums' }, { status: 500, headers: NO_STORE })
  }

  let retired = 0
  let skippedPaid = 0
  let failed = 0

  for (const album of candidates ?? []) {
    let tier: Awaited<ReturnType<typeof getUserTierById>>
    try {
      tier = await getUserTierById(album.user_id)
    } catch (err) {
      // If tier check fails for any reason, skip — never delete on uncertainty.
      console.error('[retire-albums] tier check failed for album', album.slug, ':', err instanceof Error ? err.message : String(err))
      failed += 1
      continue
    }

    if (tier !== 'free') {
      skippedPaid += 1
      // Reset activity so it doesn't show up in the next scan.
      await admin.from('albums').update({ last_activity_at: new Date().toISOString() }).eq('id', album.id)
      continue
    }

    // Paid-grace: a currently-free owner who USED to pay keeps their albums for 1 year after
    // their subscription lapsed. Skip (without resetting activity) so that once grace expires the
    // 90-day inactivity rule applies from the real last-activity date on a later scan.
    try {
      const paidUntil = await getPaidRetentionUntil(album.user_id)
      if (paidUntil && paidUntil > new Date()) {
        skippedPaid += 1
        continue
      }
    } catch (err) {
      // Never delete on an uncertain grace check.
      console.error('[retire-albums] paid-grace check failed for album', album.slug, ':', err instanceof Error ? err.message : String(err))
      failed += 1
      continue
    }

    // Mark retired atomically — if another cron run already claimed this album, skip it.
    const { count: claimCount } = await admin
      .from('albums')
      .update({ retired_at: new Date().toISOString() }, { count: 'exact' })
      .eq('id', album.id)
      .is('retired_at', null)
    if (!claimCount) continue

    const result = await deleteAlbumAssetsAndRows(admin, album)
    if (result.ok) {
      retired += 1
      track({ name: 'album_retired', albumId: album.id })
    } else {
      // Deletion failed — clear retired_at so the next cron run can retry.
      console.error('[retire-albums] deletion failed for album', album.slug, '— resetting retired_at for retry')
      await admin.from('albums').update({ retired_at: null }).eq('id', album.id)
      failed += 1
    }
  }

  return NextResponse.json(
    { ok: true, scanned: candidates?.length ?? 0, retired, skippedPaid, failed, cutoff },
    { headers: NO_STORE },
  )
}
