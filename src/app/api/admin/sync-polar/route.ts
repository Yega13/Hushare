import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAccountAdmin } from '@/lib/auth'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { listAllSubscriptions, getCustomerEmail, tierFromProduct, subProductId, subCustomerId } from '@/lib/polar'
import { findOrCreateUserByEmail } from '@/lib/provision-user'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

  let subs
  try {
    subs = await listAllSubscriptions()
  } catch (err) {
    // Admin-only route — surface the real Polar error (status + body) so the exact cause
    // (wrong key, sandbox/prod mismatch, missing scope, endpoint shape) is visible, not hidden.
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[admin/sync-polar] list failed:', detail)
    return NextResponse.json(
      { error: `Could not reach Polar — ${detail}` },
      { status: 502, headers: NO_STORE },
    )
  }

  let created = 0, updated = 0, skipped = 0
  const notes: string[] = []

  for (const sub of subs) {
    const productId = subProductId(sub)
    const customerId = subCustomerId(sub)
    const tierMatch = productId ? tierFromProduct(productId) : null
    if (!tierMatch) { skipped++; notes.push(`skip ${sub.id}: unknown product ${productId ?? '(none)'}`); continue }

    // Resolve the account: in-app userId metadata first, else provision/find by customer email.
    let userId = sub.metadata?.userId
    if (!userId || !UUID_RE.test(userId)) {
      const email = sub.customer?.email ?? (customerId ? await getCustomerEmail(customerId) : null)
      userId = email ? (await findOrCreateUserByEmail(email)) ?? undefined : undefined
      if (!userId) { skipped++; notes.push(`skip ${sub.id}: no email (customer ${customerId ?? '(none)'})`); continue }
    }

    const fields = {
      user_id: userId,
      polar_subscription_id: sub.id,
      polar_customer_id: customerId ?? '',
      polar_product_id: productId,
      tier: tierMatch.tier,
      status: sub.status,
      current_period_end: sub.current_period_end,
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
      updated_at: new Date().toISOString(),
    }

    const { data: existing } = await admin
      .from('subscriptions').select('id').eq('polar_subscription_id', sub.id).maybeSingle<{ id: string }>()

    const { error } = existing
      ? await admin.from('subscriptions').update(fields).eq('polar_subscription_id', sub.id)
      : await admin.from('subscriptions').insert({ id: randomUUID(), ...fields })

    if (error) { skipped++; notes.push(`skip ${sub.id}: write ${error.message}`); continue }
    if (existing) updated++; else created++

    // A real Polar row now exists for this user — clear any manual-recovery placeholder we inserted.
    await admin.from('subscriptions')
      .delete().eq('user_id', userId).like('polar_subscription_id', 'manual-recovery-%')
  }

  return NextResponse.json(
    { ok: true, total: subs.length, created, updated, skipped, notes: notes.slice(0, 20) },
    { headers: NO_STORE },
  )
}
