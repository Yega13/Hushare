// Mutation set for src/lib/package-purchase.ts -- run with:
//   node scripts/mutations/run.mjs package-purchase
//
// THE MONEY PATH FOR A BOUGHT ALBUM. What a payment grants, what a refund takes back, and whether
// the money arrived at all. Every mutation here is either a customer paying and not getting what
// they bought, or somebody keeping a $99 album they were refunded for -- and both are silent,
// because a package is a tier and a date on one row with no lifecycle behind it.
export default {
  file: 'src/lib/package-purchase.ts',
  test: 'tests/package-purchase.test.ts tests/package-reconcile.test.ts tests/album-packages.test.ts',
  mutations: [
  // ── which product was bought ─────────────────────────────────────────────────────────────────
  { name: 'any product id grants the first package in the catalogue',
    from: "    if (env[spec.envVar] === productId) {\n      return { kind: 'package', key, tier: spec.tier, years: spec.years, label: spec.label }",
    to: "    if (true) {\n      return { kind: 'package', key, tier: spec.tier, years: spec.years, label: spec.label }" },
  { name: 'an absent product id still grants something',
    from: "  if (!productId) return null\n", to: "" },
  { name: 'a renewal is granted at the package tier rather than its own',
    from: "      return { kind: 'renewal', key, tier: RENEWAL_TIER[key], years: spec.years, label: spec.label }",
    to: "      return { kind: 'renewal', key, tier: 'studio', years: spec.years, label: spec.label }" },
  { name: 'a renewal is labelled as a package, so the caller treats it as a new purchase',
    from: "      return { kind: 'renewal', key, tier: RENEWAL_TIER[key], years: spec.years, label: spec.label }",
    to: "      return { kind: 'package', key, tier: RENEWAL_TIER[key], years: spec.years, label: spec.label }" },
  { name: 'the years come from a literal rather than from what was sold',
    from: "      return { kind: 'package', key, tier: spec.tier, years: spec.years, label: spec.label }",
    to: "      return { kind: 'package', key, tier: spec.tier, years: 1, label: spec.label }" },

  // ── was the money actually collected ─────────────────────────────────────────────────────────
  { name: 'A 100%-OFF PROMO CODE STILL BUYS A TWO-YEAR MAX PACKAGE (the discount hole)',
    from: "  if (paidCents + PACKAGE_PRICE_TOLERANCE_CENTS < expectedCents) {", to: "  if (false) {" },
  { name: 'an unknown paid amount is treated as paid in full',
    from: "  if (typeof paidCents !== 'number' || !Number.isFinite(paidCents)) {\n    return { ok: false, reason: 'unknown', paidCents: null }\n  }\n", to: "" },
  { name: 'an unknown paid amount is treated as UNPAID, refusing a genuine purchase over a moved field',
    from: "    return { ok: false, reason: 'unknown', paidCents: null }", to: "    return { ok: false, reason: 'short', paidCents: null }" },
  { name: 'the tolerance is gone, so three cents of currency rounding refuses a real customer',
    from: "  if (paidCents + PACKAGE_PRICE_TOLERANCE_CENTS < expectedCents) {", to: "  if (paidCents < expectedCents) {" },
  { name: 'the tolerance is a whole dollar out, so a real discount is honoured as full price',
    from: "export const PACKAGE_PRICE_TOLERANCE_CENTS = 100", to: "export const PACKAGE_PRICE_TOLERANCE_CENTS = 10000" },

  // ── the refund ───────────────────────────────────────────────────────────────────────────────
  { name: 'A REFUND OF ANOTHER ORDER STRIPS A PACKAGE SOMEBODY ELSE PAID FOR',
    from: "  if (!current.lastOrderId || current.lastOrderId !== refundedOrderId) {\n    return { action: 'keep', reason: 'other-order' }\n  }\n", to: "" },
  { name: 'an album with no recorded order id may be revoked by any refund',
    from: "  if (!current.lastOrderId || current.lastOrderId !== refundedOrderId) {", to: "  if (current.lastOrderId && current.lastOrderId !== refundedOrderId) {" },
  { name: 'A $1 REFUND ERASES A $99 PURCHASE (the partial-refund hole)',
    from: "  if (!refundIsWhole(amounts.totalCents, amounts.refundedCents).whole) {", to: "  if (false) {" },
  { name: 'a WHOLE refund keeps the album, so buy-and-refund works once per album',
    from: "  return { action: 'revoke', update: { package_tier: null, package_expires_at: null } }\n}",
    to: "  return { action: 'keep', reason: 'partial' }\n}" },
  { name: 'the revoke leaves the expiry behind, so the album keeps its date with no tier',
    from: "  return { action: 'revoke', update: { package_tier: null, package_expires_at: null } }",
    to: "  return { action: 'revoke', update: { package_tier: null, package_expires_at: undefined as unknown as null } }" },
  { name: 'a partial refund and an unknown one report the same reason, so the panel cannot tell them apart',
    from: "    return { action: 'keep', reason: known ? 'partial' : 'unknown' }", to: "    return { action: 'keep', reason: 'partial' }" },

  // ── is the refund the whole order ────────────────────────────────────────────────────────────
  { name: 'ONE refund event is read instead of the order total, so two half refunds never add up',
    from: "  return { whole: refundedCents + PACKAGE_PRICE_TOLERANCE_CENTS >= totalCents }",
    to: "  return { whole: refundedCents >= totalCents }" },
  { name: 'any refund at all counts as the whole order',
    from: "  return { whole: refundedCents + PACKAGE_PRICE_TOLERANCE_CENTS >= totalCents }",
    to: "  return { whole: refundedCents > 0 }" },
  { name: 'an unreadable order total reads as wholly refunded, so a bad field revokes a live package',
    from: "  if (typeof totalCents !== 'number' || !Number.isFinite(totalCents) || totalCents <= 0) {\n    return { whole: false }\n  }\n", to: "" },
  { name: 'an unreadable refunded amount reads as wholly refunded',
    from: "  if (typeof refundedCents !== 'number' || !Number.isFinite(refundedCents)) {\n    return { whole: false }\n  }\n", to: "" },

  // ── what the purchase actually grants ────────────────────────────────────────────────────────
  { name: 'BUYING PRO ON A LIVE MAX ALBUM DOWNGRADES IT',
    from: "  const tier = liveTier && RANK[liveTier] > RANK[grant.tier] ? liveTier : grant.tier", to: "  const tier = grant.tier" },
  { name: 'an EXPIRED higher package still outranks what was just bought',
    from: "  const liveTier = current && !packageExpired(current, now) ? current.tier : null", to: "  const liveTier = current ? current.tier : null" },
  { name: 'buying early THROWS AWAY the time already paid for',
    from: "  const expires = extendExpiry(validExpiry, grant.years, now)", to: "  const expires = extendExpiry(null, grant.years, now)" },
  // NOT MUTATED -- `validExpiry` is equivalent, and kept anyway. extendExpiry only extends from a
  // date whose getTime() is GREATER than now, and NaN fails that comparison, so an Invalid Date
  // already falls back to `now` one module along. This is defence in depth ACROSS a module
  // boundary: if extendExpiry were ever "simplified" to `currentExpiry ?? now`, an unparseable
  // package_expires_at would reach toISOString() and 500 a paid webhook, with Polar retrying and a
  // customer who has paid sitting without their package. The real guard is mutated in
  // scripts/mutations/package-catalogue.mjs, where it lives; the behaviour is held either way by
  // "a corrupt stored expiry does not 500 the purchase" in tests/package-purchase.test.ts.
  { name: 'the grant lasts one year whatever was sold',
    from: "  const expires = extendExpiry(validExpiry, grant.years, now)", to: "  const expires = extendExpiry(validExpiry, 1, now)" },
  ],
}
