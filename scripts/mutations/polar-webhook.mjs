// Mutation set for the WEBHOOK AND PRODUCT MAPPING in src/lib/polar.ts -- run with:
//   node scripts/mutations/run.mjs polar-webhook
//
// THE DOOR EVERY PAYMENT ARRIVES THROUGH. verifyWebhookSignature is the only thing standing between
// a stranger's POST and a free Max subscription: the body it accepts goes straight on to grant
// tiers, extend packages and revoke them. And tierFromProduct decides WHICH plan a real payment
// bought, where being wrong means a customer pays for Max and gets Pro, silently, until they
// notice a feature missing.
export default {
  file: 'src/lib/polar.ts',
  test: 'tests/polar-webhook.test.ts tests/polar-key.test.ts tests/discount-health.test.ts',
  mutations: [
  // ── the signature ────────────────────────────────────────────────────────────────────────────
  { name: 'ANY POST IS ACCEPTED AS A GENUINE PAYMENT',
    from: "  let match = false\n  for (const candidate of candidates) {\n    if (timingSafeEqual(candidate, expected)) match = true\n  }\n  return match",
    to: "  let match = false\n  for (const candidate of candidates) {\n    if (timingSafeEqual(candidate, expected)) match = true\n  }\n  return true" },
  { name: 'the signature is compared by prefix, which is walkable one character at a time',
    from: "    if (timingSafeEqual(candidate, expected)) match = true",
    to: "    if (expected.startsWith(candidate)) match = true" },
  { name: 'the message ID is not signed over, so a replay under a new id verifies',
    from: "  const signedContent = new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`)",
    to: "  const signedContent = new TextEncoder().encode(`${timestamp}.${rawBody}`)" },
  { name: 'the timestamp is not signed over, so an old signature works forever',
    from: "  const signedContent = new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`)",
    to: "  const signedContent = new TextEncoder().encode(`${id}.${rawBody}`)" },
  { name: 'THE BODY IS NOT SIGNED OVER, so a valid signature covers any payload at all',
    from: "  const signedContent = new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`)",
    to: "  const signedContent = new TextEncoder().encode(`${id}.${timestamp}`)" },
  { name: 'a missing header is no longer required',
    from: "  if (!id || !timestamp || !signatureHeader) return false\n", to: "" },
  { name: 'the id header alone is enough',
    from: "  if (!id || !timestamp || !signatureHeader) return false", to: "  if (!id) return false" },
  // NOT MUTATED -- dropping `.filter(Boolean)` is equivalent: an empty candidate is compared
  // against a 44-character base64 HMAC, and timingSafeEqual rejects on the length difference before
  // comparing anything. The filter is worth keeping (it says no at the point the question is asked)
  // but no header distinguishes it from its absence, because `expected` can never be empty.
  { name: 'the v1 prefix is not stripped, so every genuine Polar signature is refused',
    from: "    .map((s) => (s.startsWith('v1,') ? s.slice(3) : s))", to: "    .map((s) => s)" },
  { name: 'only the first candidate is considered, so a multi-signature header from a key rotation fails',
    from: "  for (const candidate of candidates) {", to: "  for (const candidate of candidates.slice(0, 1)) {" },

  // ── the replay window ────────────────────────────────────────────────────────────────────────
  { name: 'THE REPLAY WINDOW IS GONE: a captured delivery can be replayed months later',
    from: "  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false\n", to: "" },
  { name: 'a non-numeric timestamp reads as zero, which is always outside the window... or inside it',
    from: "  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false",
    to: "  if (Math.abs(Date.now() / 1000 - ts) > 300) return false" },
  { name: 'the window is one-sided, so a timestamp far in the FUTURE is accepted',
    from: "  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false",
    to: "  if (!Number.isFinite(ts) || Date.now() / 1000 - ts > 300) return false" },
  { name: 'the window is milliseconds against seconds, so every genuine delivery is refused',
    from: "  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false",
    to: "  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 300) return false" },
  { name: 'the window shrinks to nothing, so ordinary clock skew refuses real payments',
    from: "Math.abs(Date.now() / 1000 - ts) > 300", to: "Math.abs(Date.now() / 1000 - ts) > 0" },

  // ── which plan a real payment bought ─────────────────────────────────────────────────────────
  { name: 'an unknown product falls back to a tier instead of being refused',
    from: "  const result = getProductMap()[productId] ?? null", to: "  const result = getProductMap()[productId] ?? { tier: 'pro', cycle: 'monthly' }" },
  { name: 'a yearly product is recorded as monthly',
    from: "  if (proYearly) map[proYearly] = { tier: 'pro', cycle: 'yearly' }", to: "  if (proYearly) map[proYearly] = { tier: 'pro', cycle: 'monthly' }" },
  { name: 'the Max monthly product grants Pro',
    from: "  if (studioMonthly) map[studioMonthly] = { tier: 'studio', cycle: 'monthly' }", to: "  if (studioMonthly) map[studioMonthly] = { tier: 'pro', cycle: 'monthly' }" },
  { name: 'an UNSET env var maps the empty string, so any product with no id resolves to a tier',
    from: "  if (proMonthly) map[proMonthly] = { tier: 'pro', cycle: 'monthly' }", to: "  map[proMonthly ?? ''] = { tier: 'pro', cycle: 'monthly' }" },
  // NOT MUTATED -- "the map is built once at import instead of per call" cannot be expressed as a
  // one-line swap that still compiles, and a mutant that throws ReferenceError is killed for the
  // wrong reason. The freshness it buys is real (a rotated Polar secret takes effect on the next
  // click rather than the next deploy) and is stated in the comment above PlanKey; what holds it
  // is tests/polar-key.test.ts reading process.env between calls.

  // ── the plan key the pricing page bakes in ───────────────────────────────────────────────────
  { name: 'any string is a plan key, so checkout resolves an env var of the caller choosing',
    from: "  return Object.prototype.hasOwnProperty.call(PLAN_ENV_KEYS, v)", to: "  return true" },
  // NOT MUTATED -- `in` instead of hasOwnProperty is equivalent THROUGH ITS ONLY CALLER: a
  // prototype key such as 'toString' resolves PLAN_ENV_KEYS[k] to a function, process.env[function]
  // is undefined, and productIdForPlan returns null exactly as it would have. hasOwnProperty is
  // still the right spelling -- it says no at the boundary rather than by accident two lines later,
  // and isPlanKey is exported, so the next caller may not be so forgiving.
  // NOT MUTATED -- removing the isPlanKey guard is equivalent at runtime for the same reason
  // (an unknown key indexes to undefined, process.env[undefined] is undefined, null comes back),
  // and it does not compile: the guard is what narrows `string` to PlanKey before it indexes a
  // Record<PlanKey, string>. Its real enforcement is the type system, which vitest cannot observe
  // and tsc does.
  { name: 'pro_yearly resolves to the monthly product, so a year is charged as a month',
    from: "  pro_yearly: 'POLAR_PRODUCT_PRO_YEARLY',", to: "  pro_yearly: 'POLAR_PRODUCT_PRO_MONTHLY'," },

  // ── reading ids off a Polar payload ──────────────────────────────────────────────────────────
  { name: 'the nested product id is ignored, so half of Polar payload shapes resolve to nothing',
    from: "  return order.product_id ?? order.product?.id ?? null", to: "  return order.product_id ?? null" },
  { name: 'the subscription customer falls back to the wrong field',
    from: "  return sub.customer_id ?? sub.customer?.id ?? null", to: "  return sub.customer_id ?? sub.product?.id ?? null" },
  ],
}
