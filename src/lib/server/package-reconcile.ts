import type { SupabaseClient } from '@supabase/supabase-js'
import { listRecentOrders, type PolarOrderItem } from '@/lib/polar'
import { packageGrantForProduct, applyPackageGrant, orderAmountLooksPaid } from '@/lib/package-purchase'
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

/** The amount Polar says was collected, preferring the net (post-discount) figure. */
export function collectedCents(order: PolarOrderItem): number | null {
  const candidates = [order.net_amount, order.total_amount, order.amount]
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  return candidates.length ? Math.min(...candidates) : null
}

/**
 * Is this order one we should try to apply?
 *
 * Refunded orders are excluded here as well as revoked by the webhook: reconciling a refunded order
 * back onto an album would hand back exactly what the refund took away, on a schedule, forever.
 * That is the failure mode a repair job has to be most careful about — it runs unattended.
 */
export function orderIsApplicable(order: PolarOrderItem): boolean {
  if (!order.id || !order.product_id) return false
  if (order.refunded === true) return false
  if (typeof order.refunded_amount === 'number' && order.refunded_amount > 0) return false
  // Polar marks a completed order 'paid'; anything else (pending, failed) has no money behind it.
  if (typeof order.status === 'string' && order.status !== 'paid') return false
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
    const grant = packageGrantForProduct(order.product_id)
    if (!grant) { skipped++; continue }            // a subscription's order, or an unknown product

    const albumId = order.metadata?.albumId
    if (!albumId || !UUID_RE.test(albumId)) {
      skipped++
      notes.push(`order ${order.id}: ${grant.label} with no usable albumId`)
      continue
    }

    const expectedCents = grant.kind === 'package'
      ? PACKAGE_CATALOGUE[grant.key as PackageKey].amountCents
      : RENEWAL_CATALOGUE[grant.key as RenewalKey].amountCents
    const paid = orderAmountLooksPaid(expectedCents, collectedCents(order))
    if (!paid.ok && paid.reason === 'short') {
      skipped++
      notes.push(`order ${order.id}: paid ${paid.paidCents} of ${expectedCents} — not applying`)
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
    if (error) { skipped++; notes.push(`order ${order.id}: album lookup failed`); continue }
    if (!album) { skipped++; notes.push(`order ${order.id}: album ${albumId} is gone`); continue }
    if (album.package_last_order_id === order.id) { alreadyApplied++; continue }

    const next = applyPackageGrant(
      { tier: album.package_tier, expiresAt: album.package_expires_at },
      grant,
      now,
    )
    // Payment claims an unowned album, exactly as the webhook does.
    const buyerId = order.metadata?.userId
    const claim = !album.user_id && buyerId && UUID_RE.test(buyerId) ? { user_id: buyerId } : {}

    // Conditional on the order not having landed in the meantime — the webhook may be applying it
    // at this very moment, and the id is what makes the two idempotent against each other.
    const { data: written, error: updErr } = await admin
      .from('albums')
      .update({ ...next, ...claim, package_last_order_id: order.id })
      .eq('id', album.id)
      .or(`package_last_order_id.is.null,package_last_order_id.neq.${order.id}`)
      .select('id')
    if (updErr) { skipped++; notes.push(`order ${order.id}: apply failed`); continue }
    if (!written || written.length === 0) { alreadyApplied++; continue }

    applied++
    notes.push(`order ${order.id}: ${grant.label} applied to ${album.id} — WEBHOOK WAS LOST`)
  }

  return { scanned: orders.length, applied, alreadyApplied, skipped, notes }
}
