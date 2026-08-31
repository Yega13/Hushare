import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { timingSafeEqual } from '@/lib/timing-safe'
import { reportServerError } from '@/lib/report-server-error'
import { reconcilePolarSubscriptions } from '@/lib/server/polar-reconcile'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// A PAYING CUSTOMER MUST NOT LOSE THEIR PLAN BECAUSE A WEBHOOK WENT MISSING.
//
// Entitlements are driven by Polar webhooks, and a webhook can simply never arrive — Polar
// retries, the retries run out, and nothing else notices. A subscription row carries a 7-day
// grace past current_period_end, so a renewal whose webhook was lost drops the customer to free
// on day eight while Polar keeps charging them. Until now the only repair was an admin noticing
// and pressing Sync, which means the customer finds out first: usually at their event, with Face
// Finder and bib search suddenly gone and no error naming the real cause.
//
// This asks Polar what is true and writes it down, nightly. Idempotent — every write is keyed on
// polar_subscription_id, so it converges rather than duplicating, and a normal night changes
// nothing at all.
export async function POST(req: Request) {
  const secret = process.env.ALBUM_RETIREMENT_SECRET ?? ''
  const auth = req.headers.get('Authorization') ?? ''
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!secret || !timingSafeEqual(provided, secret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  }

  const admin = createAdminClient()
  try {
    const result = await reconcilePolarSubscriptions(admin)
    // A run that CHANGED something means a webhook was missed — the reconciliation worked, and
    // the thing it repaired should still be visible rather than silently absorbed. A quiet night
    // writes nothing and says nothing.
    if (result.created > 0 || result.updated > 0) {
      console.log('[cron/reconcile-subscriptions] repaired', result.created, 'created,', result.updated, 'updated')
    }
    if (result.skipped > 0) {
      reportServerError('cron:reconcile-subscriptions', 'Some Polar subscriptions could not be reconciled', {
        context: { skipped: result.skipped, total: result.total, notes: result.notes.slice(0, 5) },
      })
    }
    return NextResponse.json({ ok: true, ...result, notes: result.notes.slice(0, 20) }, { headers: NO_STORE })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[cron/reconcile-subscriptions] failed:', detail)
    // Reported, because a reconciliation that has stopped running looks exactly like one with
    // nothing to do — and the failure it exists to catch is invisible by nature.
    reportServerError('cron:reconcile-subscriptions', 'Subscription reconciliation failed', {
      context: { reason: detail.slice(0, 250) },
    })
    return NextResponse.json({ error: 'Reconciliation failed' }, { status: 502, headers: NO_STORE })
  }
}
