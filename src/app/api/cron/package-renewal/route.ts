import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { timingSafeEqual } from '@/lib/timing-safe'
import { renewalReminderDue, daysUntil, RENEWAL_WARN_FIRST_DAYS } from '@/lib/package-renewal'
import { PACKAGE_CATALOGUE, RENEWAL_CATALOGUE } from '@/lib/package-catalogue'
import { formatPrice } from '@/lib/plan-catalogue'
import { sendPackageRenewalEmail } from '@/lib/email'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'
const BATCH_SIZE = 100

// THE RENEWAL EMAILS FOR PACKAGE ALBUMS — 30 days before lapse, and again at 7.
//
// Renewals are one-time payments made from the link in these emails. There is no stored card and
// nothing renews itself, so this cron is the renewal mechanism: an album whose owner never sees
// these two emails loses its paid features at lapse and, eventually, falls to the ordinary
// retention machinery. Which reminder is due is decided in lib/package-renewal, where it is
// tested; this route only finds candidates, sends, and stamps.
//
// Runs in the daily 02:00 batch (worker.ts). Dormant until the first package is sold — the
// candidate query matches nothing while no album has package_expires_at.
export async function POST(req: Request) {
  const secret = process.env.ALBUM_RETIREMENT_SECRET
  if (!secret) {
    console.error('[package-renewal] ALBUM_RETIREMENT_SECRET not set; refusing to run')
    return NextResponse.json({ error: 'Not configured' }, { status: 503, headers: NO_STORE })
  }
  if (secret.length < 32) {
    console.error('[package-renewal] ALBUM_RETIREMENT_SECRET must be at least 32 characters')
    return NextResponse.json({ error: 'Not configured' }, { status: 503, headers: NO_STORE })
  }
  const auth = req.headers.get('authorization') ?? ''
  if (!timingSafeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const now = new Date()
  const horizon = new Date(now.getTime() + RENEWAL_WARN_FIRST_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const admin = createAdminClient()
  // Everything expiring inside the first-warning horizon; lib decides which window each is in.
  // The partial index from the packages migration keeps this a handful of rows.
  const { data: candidates, error } = await admin
    .from('albums')
    .select('id, user_id, title, slug, custom_slug, package_tier, package_expires_at, package_reminder_at')
    .is('retired_at', null)
    .not('package_tier', 'is', null)
    .gt('package_expires_at', now.toISOString())
    .lte('package_expires_at', horizon)
    .order('package_expires_at', { ascending: true })
    .limit(BATCH_SIZE)
    .returns<Array<{
      id: string
      user_id: string | null
      title: string
      slug: string
      custom_slug: string | null
      package_tier: 'pro' | 'studio'
      package_expires_at: string
      package_reminder_at: string | null
    }>>()

  if (error) {
    console.error('[package-renewal] candidate lookup failed:', error.message)
    return NextResponse.json({ error: 'Could not scan albums' }, { status: 500, headers: NO_STORE })
  }

  let sent = 0
  let quiet = 0
  let failed = 0

  for (const album of candidates ?? []) {
    const due = renewalReminderDue(
      new Date(album.package_expires_at),
      album.package_reminder_at ? new Date(album.package_reminder_at) : null,
      now,
    )
    if (!due) {
      quiet += 1
      continue
    }

    // Checkout requires an account and payment claims the album, so user_id should always be
    // set on a packaged album. If it somehow is not, there is nobody to write to — skip WITHOUT
    // stamping, so the day the album gains an owner the reminder goes out rather than having
    // been silently spent on nobody.
    if (!album.user_id) {
      console.error('[package-renewal] packaged album has no owner to remind:', album.id)
      failed += 1
      continue
    }

    try {
      const { data: { user } } = await admin.auth.admin.getUserById(album.user_id)
      const email = user?.email
      if (!email) {
        failed += 1
        continue
      }

      const renewalSpec = RENEWAL_CATALOGUE[
        album.package_tier === 'studio' ? PACKAGE_CATALOGUE.package_max.renewal : PACKAGE_CATALOGUE.package_pro.renewal
      ]
      const albumUrl = `${SITE_URL}/${album.custom_slug || album.slug}`

      // SEND FIRST, then stamp — same order notify-expiry uses, for the same reason: a stamp
      // written before a failed send silences the window with nobody warned, and these two emails
      // are the only thing standing between a customer and their package lapsing unnoticed.
      // The worst case this way round is a duplicate email.
      await sendPackageRenewalEmail(
        email,
        album.title,
        albumUrl,
        daysUntil(new Date(album.package_expires_at), now),
        formatPrice(renewalSpec.amountCents),
      )
      await admin.from('albums').update({ package_reminder_at: now.toISOString() }).eq('id', album.id)
      sent += 1
    } catch (err) {
      console.error('[package-renewal] failed for album', album.id, ':', err instanceof Error ? err.message : String(err))
      failed += 1
    }
  }

  return NextResponse.json(
    { ok: true, scanned: candidates?.length ?? 0, sent, quiet, failed },
    { headers: NO_STORE },
  )
}
