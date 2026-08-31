import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAccountAdmin } from '@/lib/auth'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { reconcilePolarSubscriptions } from '@/lib/server/polar-reconcile'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Admin-only: pull every subscription from Polar and reconcile it into our DB — provisioning an
// account by the customer's email when needed. This backfills payments the webhook never persisted
// (e.g. the 500-on-write era, or purchases made outside the in-app flow) and does not depend on
// webhook delivery at all. Idempotent: safe to run repeatedly.
export async function POST(req: Request) {
  const csrf = forbidCrossSiteRequest(req)
  if (csrf) return csrf

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!isAccountAdmin(user)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  }

  const admin = createAdminClient()

  // The reconciliation itself lives in lib/server/polar-reconcile, shared with the nightly cron.
  // Two implementations of "what has this customer actually paid for" is the shape that ends with
  // them disagreeing, and this one decides whether somebody gets what they paid for.
  let result
  try {
    result = await reconcilePolarSubscriptions(admin)
  } catch (err) {
    // Admin-only route — surface the real Polar error (status + body) so the exact cause
    // (wrong key, sandbox/prod mismatch, missing scope, endpoint shape) is visible, not hidden.
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[admin/sync-polar] reconcile failed:', detail)
    return NextResponse.json(
      { error: `Could not reach Polar — ${detail}` },
      { status: 502, headers: NO_STORE },
    )
  }

  return NextResponse.json(
    { ok: true, ...result, notes: result.notes.slice(0, 20) },
    { headers: NO_STORE },
  )
}
