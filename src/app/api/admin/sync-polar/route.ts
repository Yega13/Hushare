import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAccountAdmin } from '@/lib/auth'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { reconcilePolarSubscriptions } from '@/lib/server/polar-reconcile'
import { reconcilePackageOrders, type PackageReconcileResult } from '@/lib/server/package-reconcile'

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

  // PACKAGES TOO, and this button is the only way to run it on demand.
  //
  // One-time package orders ($49 / $99) are repaired by a NIGHTLY cron and by nothing else, so when
  // a customer says "I paid and nothing happened" the honest answer used to be "wait until
  // tomorrow". Running it here makes the repair immediate — and it is the same shared function the
  // cron calls, never a second implementation of what somebody has paid for.
  //
  // It also exercises a DIFFERENT Polar permission from the subscription sync above: packages read
  // /v1/orders/, which needs orders:read, and subscriptions do not. That scope was missing for a
  // day and the nightly cron died on it every night — with only the subscription sync wired to this
  // button, pressing it reported a cheerful success while the package repair path was dead.
  //
  // Reported SEPARATELY rather than merged into the numbers above: two different things ran, and a
  // single combined count would hide one of them failing.
  let packages: PackageReconcileResult | null = null
  let packagesError: string | null = null
  try {
    packages = await reconcilePackageOrders(admin)
  } catch (err) {
    // NOT a 502. The subscription half already succeeded, and throwing that away because the
    // package half failed would lose work that was actually done. The error is reported instead,
    // which is what tells you a scope is missing (rule 20).
    packagesError = err instanceof Error ? err.message : String(err)
    console.error('[admin/sync-polar] package reconcile failed:', packagesError)
  }

  return NextResponse.json(
    {
      ok: true,
      ...result,
      notes: result.notes.slice(0, 20),
      packages: packages
        ? { ...packages, notes: packages.notes.slice(0, 20) }
        : { error: packagesError },
    },
    { headers: NO_STORE },
  )
}
