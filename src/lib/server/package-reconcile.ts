import type { SupabaseClient } from '@supabase/supabase-js'
import { listRecentOrders, orderProductId, type PolarOrderItem } from '@/lib/polar'
import { packageGrantForProduct, applyPackageGrant, orderAmountLooksPaid, refundIsWhole } from '@/lib/package-purchase'
import { PACKAGE_CATALOGUE, RENEWAL_CATALOGUE, type PackageKey, type RenewalKey } from '@/lib/package-catalogue'

// A PAID PACKAGE THAT NEVER ARRIVED, REPAIRED WITHOUT ANYONE ASKING.
//
// Entitlements are driven by webhooks, and a webhook can simply never arrive: Polar retries, the
// retries are exhausted, and nothing else notices. Subscriptions have had a reconcile since the day
// that dropped a paying customer to free. One-time orders had none — the $49 is collected, the
// album never becomes a package, and the first person to find out is the customer, usually at their
// event, saying "I paid and nothing happened".
//
// The webhook's own compare-and-swap makes that worse rather than better in one specific way: on a
// lost race it deliberately answers 500 and relies on Polar's retry budget to reapply the year.
// Exhaust the retries and the year is simply gone, with a reportServerError line as the only trace.
// This is what turns that from unrecoverable into "fixed by morning".
//
// DECIDED BY THE SAME FUNCTIONS THE WEBHOOK USES — packageGrantForProduct, orderAmountLooksPaid,
// applyPackageGrant. Two implementations of "what did this order buy" is the shape that ends with
// them disagreeing, and this one decides whether somebody gets what they paid for (rule 13).
//
// IDEMPOTENT BY CONSTRUCTION: every album already carries package_last_order_id, so an order that
// has landed is skipped, and the write is conditional on that same id not being set. Running this
// repeatedly converges rather than stacking years onto an album.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PackageReconcileResult = {
  scanned: number
  applied: number
  alreadyApplied: number
  skipped: number
  notes: string[]
}

/**
 * The amount Polar says was collected AND KEPT, preferring the net (post-discount) figure.
 *
 * Refunds are subtracted, which is what makes a partially refunded order repair itself correctly:
 * a $99 order with a $50 refund reads as $49 collected, falls short of the catalogue price, and is
 * refused and reported rather than granted in full. A $1 goodwill credit reads as $98 and still
 * passes, because the tolerance exists for exactly that kind of noise.
 */
export function collectedCents(order: PolarOrderItem): number | null {
  const candidates = [order.net_amount, order.total_amount, order.amount]
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (!candidates.length) return null
  const refunded = typeof order.refunded_amount === 'number' && Number.isFinite(order.refunded_amount)
    ? order.refunded_amount
    : 0
  return Math.min(...candidates) - refunded
}

/**
 * Is this order one we should try to apply?
 *
 * WHOLLY refunded orders are excluded here as well as revoked by the webhook: reconciling one back
 * onto an album would hand back exactly what the refund took away, on a schedule, forever. That is
 * the failure mode a repair job has to be most careful about — it runs unattended.
 *
 * A PARTIALLY refunded order is still applicable, and the earlier version of this was wrong to skip
 * it. Skipping on `refunded_amount > 0` meant a $99 purchase with a $1 goodwill credit could never
 * be repaired if its webhook was also lost — the customer had paid $98 and the one job that exists
 * to notice that refused to look. What such an order actually bought is decided where it belongs,
 * by collectedCents against the catalogue price, so a real shortfall is still refused.
 */
export function orderIsApplicable(order: PolarOrderItem): boolean {
  if (!order.id || !orderProductId(order)) return false
  if (order.refunded === true) return false
  if (refundIsWhole(order.total_amount ?? order.net_amount, order.refunded_amount).whole) return false
  // Polar marks a completed order 'paid' and a partly-refunded one 'partially_refunded' — both had
  // real money behind them (the partial case is then judged by collectedCents net of the refund).
  // Anything else (pending, failed, refunded) has no money to honour.
  if (typeof order.status === 'string' && order.status !== 'paid' && order.status !== 'partially_refunded') return false
  return true
}

export async function reconcilePackageOrders(
  admin: SupabaseClient,
  now: Date = new Date(),
): Promise<PackageReconcileResult> {
  const orders = await listRecentOrders()
  const notes: string[] = []
  let applied = 0, alreadyApplied = 0, skipped = 0

  for (const order of orders) {
    if (!orderIsApplicable(order)) { skipped++; continue }
    // orderIsApplicable already refused anything without an id; this restates it for the type
    // system rather than asserting, so a future change to that function cannot silently produce an
    // `undefined` interpolated into a database filter below.
    const orderId = order.id
    if (!orderId) { skipped++; continue }
    // orderProductId, NOT order.product_id: the list API nests the product as an object while the
    // webhook sends a flat id. Reading only the flat field made every listed order unrecognisable,
    // so the job skipped all of them and reported a quiet night — the repair path silently
    // repairing nothing, which is the one failure a repair job must never have.
    const grant = packageGrantForProduct(orderProductId(order))
    if (!grant) { skipped++; continue }            // a subscription's order, or an unknown product

    const albumId = order.metadata?.albumId
    if (!albumId || !UUID_RE.test(albumId)) {
      skipped++
      notes.push(`order ${orderId}: ${grant.label} with no usable albumId`)
      continue
    }

    const expectedCents = grant.kind === 'package'
      ? PACKAGE_CATALOGUE[grant.key as PackageKey].amountCents
      : RENEWAL_CATALOGUE[grant.key as RenewalKey].amountCents
    const paid = orderAmountLooksPaid(expectedCents, collectedCents(order))
    if (!paid.ok && paid.reason === 'short') {
      skipped++
      notes.push(`order ${orderId}: paid ${paid.paidCents} of ${expectedCents} — not applying`)
      continue
    }

    const { data: album, error } = await admin
      .from('albums')
      .select('id, user_id, package_tier, package_expires_at, package_last_order_id')
      .eq('id', albumId)
      .is('retired_at', null)
      .maybeSingle<{
        id: string
        user_id: string | null
        package_tier: 'pro' | 'studio' | null
        package_expires_at: string | null
        package_last_order_id: string | null
      }>()
    if (error) { skipped++; notes.push(`order ${orderId}: album lookup failed`); continue }
    if (!album) { skipped++; notes.push(`order ${orderId}: album ${albumId} is gone`); continue }

    // CLAIM THE ORDER BEFORE GRANTING IT, in the ledger, atomically.
    //
    // This used to be `album.package_last_order_id === orderId`, which asks whether this was the
    // LAST order applied — not whether it was EVER applied. An album with a purchase AND a renewal
    // has two orders and one column, so each night whichever one was not last looked unapplied and
    // was granted again, alternating forever: +3 years of paid time a night on a $118 sale, with a
    // false "a payment was dropped" alert every time. See the ledger migration for the full trace.
    //
    // An INSERT is the claim, so the webhook applying this same order at this same moment loses the
    // race cleanly instead of both paths granting. ignoreDuplicates makes an existing row return no
    // rows rather than an error, which is the "already honoured" answer.
    const { data: claimed, error: claimErr } = await admin
      .from('package_order_grants')
      .upsert({ order_id: orderId, album_id: album.id, source: 'reconcile' },
        { onConflict: 'order_id', ignoreDuplicates: true })
      .select('order_id')
    if (claimErr) { skipped++; notes.push(`order ${orderId}: could not claim`); continue }
    if (!claimed || claimed.length === 0) { alreadyApplied++; continue }

    const next = applyPackageGrant(
      { tier: album.package_tier, expiresAt: album.package_expires_at },
      grant,
      now,
    )
    // Payment claims an unowned album, exactly as the webhook does.
    const buyerId = order.metadata?.userId
    const claim = !album.user_id && buyerId && UUID_RE.test(buyerId) ? { user_id: buyerId } : {}

    // THE SAME COMPARE-AND-SWAP THE WEBHOOK USES, written the same way on purpose.
    //
    // The order-id predicate alone makes this idempotent against a redelivery of the SAME order and
    // does nothing about two DIFFERENT orders in flight at once — which is precisely the case the
    // webhook guards and this job did not. The webhook reads expiry E for order A while this reads
    // the same E for order B; the webhook writes E+1y; this writes E+1y with its own order id, the
    // id predicate passes because it IS a different id, and one paid year is silently gone with
    // both paths reporting success. A repair job racing the thing it repairs must not be the reason
    // a customer loses a year.
    //
    // So the expiry this was computed from must still be there when the write lands. If anything
    // moved it, zero rows match, the order is counted as already applied, and tomorrow's run reads
    // the new value and extends from it correctly.
    let q = admin
      .from('albums')
      .update({ ...next, ...claim, package_last_order_id: orderId })
      .eq('id', album.id)
    // Interpolated into a PostgREST filter, so a comma or paren in an id would rewrite it. The
    // webhook guards the identical filter and this did not (rule 13: one fact, two enforcement
    // sites, a check in only one of them). An unexpected shape DROPS the predicate rather than
    // refusing the order — the CAS below already makes double-application impossible on its own,
    // so the uncertain branch gives up the extra guard, never the money (rule 19).
    if (UUID_RE.test(orderId)) {
      q = q.or(`package_last_order_id.is.null,package_last_order_id.neq.${orderId}`)
    }
    q = album.package_expires_at === null
      ? q.is('package_expires_at', null)
      : q.eq('package_expires_at', album.package_expires_at)
    const { data: written, error: updErr } = await q.select('id')

    // RELEASE THE CLAIM IF THE GRANT DID NOT LAND. The claim above is what stops this order being
    // granted twice; holding it after a failed write would stop it being granted AT ALL, and this
    // job's entire purpose is to be the last thing standing between a paid order and a customer who
    // got nothing. So an order that was claimed but not applied goes back on the table for tomorrow
    // (rule 19: the uncertain branch must not be the one that keeps someone's money and gives them
    // nothing). Double-granting is the cheaper mistake and the CAS already guards it.
    if (updErr || !written || written.length === 0) {
      const { error: releaseErr } = await admin
        .from('package_order_grants').delete().eq('order_id', orderId)
      if (releaseErr) {
        // Now it IS stuck: claimed, not applied, and not releasable. Say so loudly rather than
        // letting a paid order sit unrepairable behind a silent counter.
        notes.push(`order ${orderId}: CLAIMED BUT NOT APPLIED and the claim could not be released — needs a human`)
      }
      if (updErr) { skipped++; notes.push(`order ${orderId}: apply failed`); continue }
      // Zero rows means the expiry moved under us — the webhook applied it a moment ago. Correct
      // and expected; tomorrow's run re-reads the new value.
      alreadyApplied++
      continue
    }

    applied++
    notes.push(`order ${orderId}: ${grant.label} applied to ${album.id} — WEBHOOK WAS LOST`)
  }

  return { scanned: orders.length, applied, alreadyApplied, skipped, notes }
}
