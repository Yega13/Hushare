import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { RETIRE_AFTER_DAYS, WARN_AFTER_DAYS } from '@/lib/retention'
import { getUserTierById, getPaidRetentionUntil } from '@/lib/subscriptions'
import { sendExpiryWarningEmail } from '@/lib/email'
import { timingSafeEqual } from '@/lib/timing-safe'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
// The clock is shared with retire-albums through lib/retention — the old "must mirror" comment
// was the only thing holding the two copies together, and a comment is not a mechanism.
// Raised from 50, and kept comfortably ahead of retire-albums' rate so the warning queue drains
// faster than the deletion queue consumes it -- otherwise the interlock turns into a permanent
// backlog rather than a safety net.
const BATCH_SIZE = 200
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
    // ANONYMOUS ALBUMS ARE INCLUDED, and they were the majority.
    //
    // This filtered them out because there is no address to email — which is true, and the
    // privacy policy says so in as many words. But last_notification_at is ALSO what starts the
    // retirement countdown, and nothing else ever sets it, so filtering them here made every
    // album created without an account permanently un-retirable. The policy promises those are
    // deleted after a year of being untouched; the code could not reach them at all.
    //
    // They now pass through and get stamped without an email, so the same countdown applies. A
    // stamp means "the clock started", not "somebody was told" — the two were the same thing
    // only while every candidate had an inbox.
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

  let startedAnonymous = 0

  for (const album of candidates ?? []) {
    // No account means no tier to look up, no paid grace to respect, and nobody to write to.
    // Start the clock and move on — the album is still protected by the same 30-day window
    // before retire-albums will touch it, which is a returning visitor's chance to bump it.
    if (!album.user_id) {
      const { error: stampErr } = await admin
        .from('albums').update({ last_notification_at: new Date().toISOString() }).eq('id', album.id)
      if (stampErr) {
        console.error('[notify-expiry] could not start the clock for anonymous album', album.id, ':', stampErr.message)
        failed += 1
      } else {
        startedAnonymous += 1
      }
      continue
    }

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
    // startedAnonymous counted separately from notified: one means an email went to a person,
    // the other means a clock started with nobody to tell. Merging them would hide which.
    { ok: true, scanned: candidates?.length ?? 0, notified, startedAnonymous, skippedPaid, failed },
    { headers: NO_STORE },
  )
}
