import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendBillingReminderEmail } from '@/lib/email'
import { timingSafeEqual } from '@/lib/timing-safe'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'
// Raised from 50. Ordered soonest-first now, so the cap can only ever delay the least urgent
// reminder rather than drop an arbitrary customer's -- but with billing notices the right number is
// "all of them", and 200 covers the foreseeable book.
const BATCH_SIZE = 200

type UpcomingRenewal = {
  id: string
  last_reminder_at: string | null
  user_id: string
  tier: string
  current_period_end: string
}

export async function POST(req: Request) {
  const secret = process.env.ALBUM_RETIREMENT_SECRET
  if (!secret) {
    console.error('[notify-renewal] ALBUM_RETIREMENT_SECRET not set; refusing to run')
    return NextResponse.json({ error: 'Not configured' }, { status: 503, headers: NO_STORE })
  }
  if (secret.length < 32) {
    console.error('[notify-renewal] ALBUM_RETIREMENT_SECRET must be at least 32 characters')
    return NextResponse.json({ error: 'Not configured' }, { status: 503, headers: NO_STORE })
  }
  const auth = req.headers.get('authorization') ?? ''
  if (!timingSafeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  }

  // Window: subscriptions whose billing date falls between 24h and 48h from now.
  // Since this cron runs once a day, each subscription hits the window exactly once per cycle.
  const now = Date.now()
  // A reminder older than the notice window belongs to a PREVIOUS billing period, so it must not
  // suppress this period's. Anything newer than this is the reminder we already sent for this one.
  const remindedBefore = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
  const windowStart = new Date(now + 24 * 60 * 60 * 1000).toISOString()
  const windowEnd = new Date(now + 48 * 60 * 60 * 1000).toISOString()

  const admin = createAdminClient()
  const { data: upcoming, error } = await admin
    .from('subscriptions')
    .select('id, user_id, tier, current_period_end, last_reminder_at')
    .eq('status', 'active')
    .eq('cancel_at_period_end', false)
    .gt('current_period_end', windowStart)
    .lte('current_period_end', windowEnd)
    // Never remind twice for the same period. Cloudflare cron triggers are at-least-once, so the
    // "it runs once a day" assumption this relied on is not one the platform makes -- a duplicate
    // invocation emailed a second billing notice to everyone about to be charged.
    .or(`last_reminder_at.is.null,last_reminder_at.lt.${remindedBefore}`)
    // Soonest renewal first. Without an order, once more than BATCH_SIZE renewals fall inside the
    // same 24h window an ARBITRARY subset got no pre-billing notice at all -- which is a chargeback
    // and, in some places, a compliance problem. Ordered, the ones billing soonest always win.
    .order('current_period_end', { ascending: true })
    .limit(BATCH_SIZE)
    .returns<UpcomingRenewal[]>()

  if (error) {
    console.error('[notify-renewal] subscription lookup failed:', error.message)
    return NextResponse.json({ error: 'Could not scan subscriptions' }, { status: 500, headers: NO_STORE })
  }

  let notified = 0
  let failed = 0

  for (const sub of upcoming ?? []) {
    try {
      const { data: { user } } = await admin.auth.admin.getUserById(sub.user_id)
      const email = user?.email
      if (!email) continue

      const renewalDate = new Date(sub.current_period_end).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })

      await sendBillingReminderEmail(email, sub.tier, renewalDate, `${SITE_URL}/account`)
      // Marked AFTER the send, so a failed email is retried tomorrow rather than recorded as done.
      // The worst case in this order is a duplicate; the other order loses the notice entirely.
      await admin.from('subscriptions')
        .update({ last_reminder_at: new Date().toISOString() })
        .eq('id', sub.id)
      notified += 1
    } catch (err) {
      console.error('[notify-renewal] failed for user', sub.user_id, ':', err instanceof Error ? err.message : String(err))
      failed += 1
    }
  }

  return NextResponse.json(
    { ok: true, scanned: upcoming?.length ?? 0, notified, failed, windowStart, windowEnd },
    { headers: NO_STORE },
  )
}
