import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendBillingReminderEmail } from '@/lib/email'
import { timingSafeEqual } from '@/lib/timing-safe'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'
const BATCH_SIZE = 50

type UpcomingRenewal = {
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
  const windowStart = new Date(now + 24 * 60 * 60 * 1000).toISOString()
  const windowEnd = new Date(now + 48 * 60 * 60 * 1000).toISOString()

  const admin = createAdminClient()
  const { data: upcoming, error } = await admin
    .from('subscriptions')
    .select('user_id, tier, current_period_end')
    .eq('status', 'active')
    .eq('cancel_at_period_end', false)
    .gt('current_period_end', windowStart)
    .lte('current_period_end', windowEnd)
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
