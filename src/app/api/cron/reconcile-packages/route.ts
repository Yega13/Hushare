import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { timingSafeEqual } from '@/lib/timing-safe'
import { reportServerError } from '@/lib/report-server-error'
import { reconcilePackageOrders } from '@/lib/server/package-reconcile'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// A PAID PACKAGE MUST NOT VANISH BECAUSE A WEBHOOK WENT MISSING.
//
// The sibling route next door does this for subscriptions, and its comment explains why: a webhook
// can simply never arrive. One-time orders had no such repair — Polar collects the $49, the retries
// run out, the album never becomes a package, and the first person to notice is the customer,
// usually at their event, saying "I paid and nothing happened".
//
// The webhook's compare-and-swap makes one case worse without this: on a lost race it deliberately
// answers 500 and leans on Polar's retry budget to reapply the year. Exhaust the retries and the
// paid year is gone, with one reportServerError line as its only trace. This turns that from
// unrecoverable into fixed-by-morning.
//
// Idempotent: every album carries package_last_order_id, so an order that already landed is
// skipped, and the write is conditional on that same id. A normal night changes nothing.
export async function POST(req: Request) {
  const secret = process.env.ALBUM_RETIREMENT_SECRET ?? ''
  const auth = req.headers.get('Authorization') ?? ''
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!secret || !timingSafeEqual(provided, secret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  }

  const admin = createAdminClient()
  try {
    const result = await reconcilePackageOrders(admin)
    // APPLYING ANYTHING HERE MEANS A WEBHOOK WAS LOST — money had been taken and the customer had
    // nothing to show for it. That is worth an alert even though the repair succeeded: it is the
    // only signal that the primary path is dropping payments.
    if (result.applied > 0) {
      console.log('[cron/reconcile-packages] repaired', result.applied, 'lost package orders')
      reportServerError('cron:reconcile-packages', 'A paid package had to be repaired — its webhook never arrived', {
        context: { applied: result.applied, scanned: result.scanned, notes: result.notes.slice(0, 5) },
      })
    }
    return NextResponse.json({ ok: true, ...result, notes: result.notes.slice(0, 20) }, { headers: NO_STORE })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[cron/reconcile-packages] failed:', detail)
    // A repair job that has stopped running looks exactly like one with nothing to repair.
    reportServerError('cron:reconcile-packages', 'Package reconciliation failed', {
      context: { reason: detail.slice(0, 250) },
    })
    return NextResponse.json({ error: 'Reconciliation failed' }, { status: 502, headers: NO_STORE })
  }
}
