import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserTierById, getPaidRetentionUntil } from '@/lib/subscriptions'
import { sendExpiryWarningEmail } from '@/lib/email'
import { timingSafeEqual } from '@/lib/timing-safe'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
// Must mirror retire-albums: FREE albums expire after 365 days (1 year) of inactivity. Owners are
// warned 30 days before (i.e. once the album has been inactive 335–365 days) so they can download first.
const RETIRE_AFTER_DAYS = 365
const WARN_BEFORE_DAYS = 30
const WARN_AFTER_DAYS = RETIRE_AFTER_DAYS - WARN_BEFORE_DAYS  // 335
const BATCH_SIZE = 50
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'

type ExpiryCandidate = {
  id: string
  user_id: string | null
  title: string
  slug: string
  custom_slug: string | null
  last_activity_at: string
  last_notification_at: string | null
}

export async function POST(req: Request) {
  const secret = process.env.ALBUM_RETIREMENT_SECRET
  if (!secret) {
    console.error('[notify-expiry] ALBUM_RETIREMENT_SECRET not set; refusing to run')
    return NextResponse.json({ error: 'Not configured' }, { status: 503, headers: NO_STORE })
  }
  if (secret.length < 32) {
    console.error('[notify-expiry] ALBUM_RETIREMENT_SECRET must be at least 32 characters')
    return NextResponse.json({ error: 'Not configured' }, { status: 503, headers: NO_STORE })
  }
  const auth = req.headers.get('authorization') ?? ''
  if (!timingSafeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const now = Date.now()
  const warnCutoffNew = new Date(now - WARN_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const admin = createAdminClient()
  const { data: candidates, error } = await admin
    .from('albums')
    .select('id, user_id, title, slug, custom_slug, last_activity_at, last_notification_at')
    .is('retired_at', null)
    .is('last_notification_at', null)  // only notify once
    .not('user_id', 'is', null)
    .lt('last_activity_at', warnCutoffNew)
    // NO lower bound. It used to require last_activity_at > (now - 365d), so once inflow exceeded
    // BATCH_SIZE per day the backlog grew and an album that waited past 365 days of inactivity
    // dropped out of this query FOREVER -- and retire-albums, which only checked the 365-day
    // cutoff, then deleted it having warned nobody. 50 free albums going quiet in a day is an
    // ordinary number at this growth rate, so that was reachable, not theoretical.
    //
    // Ordering oldest-first (below) means the most at-risk albums are always warned first, and
    // retire-albums now refuses to delete anything unwarned, so a backlog delays deletion instead
    // of skipping the warning.
    .order('last_activity_at', { ascending: true })
    .limit(BATCH_SIZE)
    .returns<ExpiryCandidate[]>()

  if (error) {
    console.error('[notify-expiry] candidate lookup failed:', error.message)
    return NextResponse.json({ error: 'Could not scan albums' }, { status: 500, headers: NO_STORE })
  }

  let notified = 0
  let skippedPaid = 0
  let failed = 0

  for (const album of candidates ?? []) {
    let tier: Awaited<ReturnType<typeof getUserTierById>>
    try {
      tier = await getUserTierById(album.user_id)
    } catch (err) {
      console.error('[notify-expiry] tier check failed for album', album.id, ':', err instanceof Error ? err.message : String(err))
      failed += 1
      continue
    }
    if (tier !== 'free') {
      skippedPaid += 1
      continue
    }

    // Don't warn owners still covered by the 1-year paid-grace window (their album isn't
    // expiring yet). Mirror the same check retire-albums uses.
    try {
      const paidUntil = await getPaidRetentionUntil(album.user_id)
      if (paidUntil && paidUntil > new Date()) {
        skippedPaid += 1
        continue
      }
    } catch (err) {
      console.error('[notify-expiry] paid-grace check failed for album', album.id, ':', err instanceof Error ? err.message : String(err))
      failed += 1
      continue
    }

    try {
      const { data: { user } } = await admin.auth.admin.getUserById(album.user_id!)
      const email = user?.email
      if (!email) continue

      const publicSlug = album.custom_slug || album.slug
      const albumUrl = `${SITE_URL}/${publicSlug}`
      const daysLeft = Math.max(
        1,
        Math.round((new Date(album.last_activity_at).getTime() + RETIRE_AFTER_DAYS * 24 * 60 * 60 * 1000 - now) / (24 * 60 * 60 * 1000)),
      )

      // SEND FIRST, then mark. The order matters more than it looks.
      //
      // Marking first was chosen to avoid duplicate emails, but it trades a nuisance for permanent
      // data loss: the query only ever considers albums where last_notification_at IS NULL, so if
      // the send then failed -- Resend down, rate-limited, the isolate dying between two awaits --
      // the album was flagged as warned, was never retried, and retire-albums deleted it and every
      // photo in it thirty days later having told nobody. The worst case in this order is that
      // somebody receives the same warning twice.
      await sendExpiryWarningEmail(email, album.title, albumUrl, daysLeft)
      await admin.from('albums').update({ last_notification_at: new Date().toISOString() }).eq('id', album.id)
      notified += 1
    } catch (err) {
      console.error('[notify-expiry] failed for album', album.id, ':', err instanceof Error ? err.message : String(err))
      failed += 1
    }
  }

  return NextResponse.json(
    { ok: true, scanned: candidates?.length ?? 0, notified, skippedPaid, failed },
    { headers: NO_STORE },
  )
}
