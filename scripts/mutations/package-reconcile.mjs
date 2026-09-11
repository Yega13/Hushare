// Mutation set for src/lib/server/package-reconcile.ts -- run with:
//   node scripts/mutations/run.mjs package-reconcile
//
// THE REPAIR JOB FOR A LOST WEBHOOK. It runs unattended, so its failures divide into two kinds and
// the second is much worse than the first: a customer who paid stays un-upgraded (bad, and visible
// to them), or a REFUNDED order is handed back onto the album on a schedule, forever (silent, and
// undoes a decision somebody already made about money).
export default {
  file: 'src/lib/server/package-reconcile.ts',
  test: 'tests/package-reconcile.test.ts tests/package-purchase.test.ts',
  mutations: [
  // ── how much money this order really represents ──────────────────────────────────────────────
  { name: 'the REFUND is not subtracted, so a partly refunded order counts as paid in full',
    from: "  return Math.min(...candidates) - refunded", to: "  return Math.min(...candidates)" },
  { name: 'the most generous amount is taken instead of the most conservative',
    from: "  return Math.min(...candidates) - refunded", to: "  return Math.max(...candidates) - refunded" },
  { name: 'an unreadable refunded amount is treated as the whole order rather than as zero',
    from: "  const refunded = typeof order.refunded_amount === 'number' && Number.isFinite(order.refunded_amount)\n    ? order.refunded_amount\n    : 0",
    to: "  const refunded = typeof order.refunded_amount === 'number' && Number.isFinite(order.refunded_amount)\n    ? order.refunded_amount\n    : Infinity" },
  { name: 'an order with no readable amount reads as zero collected rather than as unknown',
    from: "  if (!candidates.length) return null", to: "  if (!candidates.length) return 0" },
  { name: 'a non-numeric amount is believed',
    from: "    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))",
    to: "    .filter((v): v is number => v !== null && v !== undefined)" },

  // ── which orders the unattended job will touch ───────────────────────────────────────────────
  { name: 'A REFUNDED ORDER IS RE-APPLIED ON A SCHEDULE, handing back what the refund took away',
    from: "  if (order.refunded === true) return false\n", to: "" },
  { name: 'a WHOLLY refunded order is re-applied, which the refunded flag alone does not catch',
    from: "  if (refundIsWhole(order.total_amount ?? order.net_amount, order.refunded_amount).whole) return false\n", to: "" },
  { name: 'a PARTLY refunded order is skipped, so a $99 purchase with a $1 credit can never be repaired',
    from: "  if (refundIsWhole(order.total_amount ?? order.net_amount, order.refunded_amount).whole) return false",
    to: "  if (typeof order.refunded_amount === 'number' && order.refunded_amount > 0) return false" },
  { name: 'an order with no product id is applied, so the grant is decided from nothing',
    from: "  if (!order.id || !orderProductId(order)) return false", to: "  if (!order.id) return false" },
  { name: 'an order with no id is applied, so nothing can record which order granted it',
    from: "  if (!order.id || !orderProductId(order)) return false", to: "  if (!orderProductId(order)) return false" },
  { name: 'a PENDING or FAILED order is honoured as if the money had arrived',
    from: "  if (typeof order.status === 'string' && order.status !== 'paid' && order.status !== 'partially_refunded') return false\n", to: "" },
  { name: 'a partially refunded order is refused by status, contradicting the line above it',
    from: "  if (typeof order.status === 'string' && order.status !== 'paid' && order.status !== 'partially_refunded') return false",
    to: "  if (typeof order.status === 'string' && order.status !== 'paid') return false" },
  { name: 'nothing is applicable at all, so the repair job silently repairs nothing',
    from: "  return true\n}\n\nexport async function reconcilePackageOrders(", to: "  return false\n}\n\nexport async function reconcilePackageOrders(" },
  ],
}
