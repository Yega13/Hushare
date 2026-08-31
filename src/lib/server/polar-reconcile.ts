import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listAllSubscriptions, getCustomerEmail, tierFromProduct, subProductId, subCustomerId } from '@/lib/polar'
import { findOrCreateUserByEmail } from '@/lib/provision-user'

// PULL THE TRUTH FROM POLAR, RATHER THAN WAITING TO BE TOLD IT.
//
// Entitlements are driven by webhooks, and a webhook can simply never arrive: Polar retries, the
// retries are exhausted, and nothing else notices. A subscription row keeps a 7-day grace past
// current_period_end (ACTIVE_PERIOD_GRACE_MS), so a renewal whose webhook was lost drops the
// customer to free on day eight — while Polar goes on charging them. The only repair was an admin
// noticing and pressing a button, which means the customer discovers it first, usually at their
// event, with Face Finder and bib search suddenly gone and no error that names the real cause.
//
// So the same reconciliation now runs on a schedule. Lifted out of the admin route rather than
// copied: two implementations of "what does this customer actually own" is the shape that ends
// with them disagreeing, and this one decides whether somebody gets what they paid for.
//
// Idempotent by construction — every write is keyed on polar_subscription_id, so running it
// repeatedly converges instead of duplicating.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ReconcileResult = {
  total: number
  created: number
  updated: number
  skipped: number
  notes: string[]
}

export async function reconcilePolarSubscriptions(admin: SupabaseClient): Promise<ReconcileResult> {
  const subs = await listAllSubscriptions()

  let created = 0, updated = 0, skipped = 0
  const notes: string[] = []

  for (const sub of subs) {
    const productId = subProductId(sub)
    const customerId = subCustomerId(sub)
    const tierMatch = productId ? tierFromProduct(productId) : null
    if (!tierMatch) { skipped++; notes.push(`skip ${sub.id}: unknown product ${productId ?? '(none)'}`); continue }

    // Resolve the account: in-app userId metadata first, else provision/find by customer email.
    let userId = sub.metadata?.userId
    // A metadata userId can be STALE — e.g. it points at a user from the old (deleted) Supabase
    // project, so writing it violates the user_id foreign key. Only trust it if that user still
    // exists; otherwise fall through to email-based provisioning below.
    if (userId && UUID_RE.test(userId)) {
      const { data: existsUser } = await admin.auth.admin.getUserById(userId)
      if (!existsUser?.user) userId = undefined
    }
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

    // The read's error is checked, not discarded. A failed lookup used to read as "no row" and
    // turn an UPDATE into an INSERT, which the unique index then rejected — safe, but it spent a
    // write and reported a skip whose message named the wrong problem.
    const { data: existing, error: readErr } = await admin
      .from('subscriptions').select('id').eq('polar_subscription_id', sub.id).maybeSingle<{ id: string }>()
    if (readErr) { skipped++; notes.push(`skip ${sub.id}: read ${readErr.message}`); continue }

    const { error } = existing
      ? await admin.from('subscriptions').update(fields).eq('polar_subscription_id', sub.id)
      : await admin.from('subscriptions').insert({ id: randomUUID(), ...fields })

    if (error) { skipped++; notes.push(`skip ${sub.id}: write ${error.message}`); continue }
    if (existing) updated++; else created++

    // A real Polar row now exists for this user — clear any manual-recovery placeholder we inserted.
    await admin.from('subscriptions')
      .delete().eq('user_id', userId).like('polar_subscription_id', 'manual-recovery-%')
  }

  return { total: subs.length, created, updated, skipped, notes }
}
