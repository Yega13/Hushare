// Mutation set for src/lib/package-catalogue.ts -- run with:
//   node scripts/mutations/run.mjs package-catalogue
//
// THE PRICE LIST, AND THE ARITHMETIC THAT TURNS A PAYMENT INTO A DATE. Everything downstream reads
// this file rather than retyping its numbers -- the album item allowance, the checkout amount check,
// the reconcile job -- so a wrong number here is wrong in every one of them at once, consistently,
// which is exactly the shape no test notices.
export default {
  file: 'src/lib/package-catalogue.ts',
  test: 'tests/album-packages.test.ts tests/package-purchase.test.ts tests/package-renewal.test.ts',
  mutations: [
  // ── how long a payment buys ──────────────────────────────────────────────────────────────────
  { name: 'PAYING EARLY THROWS AWAY THE TIME ALREADY PAID FOR',
    from: "  const from = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now",
    to: "  const from = now" },
  { name: 'a LAPSED package is extended from its old expiry, so a renewal buys time in the past',
    from: "  const from = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now",
    to: "  const from = currentExpiry ?? now" },
  { name: 'AN UNPARSEABLE STORED EXPIRY FLOWS THROUGH, and toISOString() on it 500s the paid webhook',
    from: "  const from = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now",
    to: "  const from = currentExpiry && !Number.isNaN(currentExpiry.getTime()) === false ? now : (currentExpiry ?? now)" },
  // NOT MUTATED -- `>` versus `>=` on the expiry is equivalent: when the stored expiry IS the
  // current instant, extending from it and extending from now are the same date to the
  // millisecond. There is no input that tells them apart.
  { name: 'the extension mutates the date it was handed, so the caller sees its input change',
    from: "  const out = new Date(from.getTime())", to: "  const out = from" },
  // NOT MUTATED AS BEHAVIOUR -- setFullYear versus setUTCFullYear cannot be told apart by a test
  // that has to pass in CI, because CI runs in UTC where the two are identical; it would only fail
  // on a developer machine in another timezone, which is a test that passes or fails by accident.
  // Held as a SOURCE assertion instead, in "the expiry arithmetic is in UTC" -- see
  // tests/album-packages.test.ts.
  { name: 'the grant adds nothing at all, so a payment buys a package that has already expired',
    from: "  out.setUTCFullYear(out.getUTCFullYear() + years)", to: "  void years" },

  // ── the price list itself ────────────────────────────────────────────────────────────────────
  { name: 'the Pro package is repriced without the checkout knowing',
    from: "    amountCents: 4900,", to: "    amountCents: 900," },
  { name: 'the Max package grants the Pro item allowance',
    from: "    items: 10_000,", to: "    items: 5_000," },
  { name: 'the Pro package lasts one year rather than the two it is sold as',
    from: "    items: 5_000,\n    years: 2,", to: "    items: 5_000,\n    years: 1," },
  { name: 'a renewal buys two years for the price of one',
    from: "  renewal_pro: {\n    years: 1,", to: "  renewal_pro: {\n    years: 2," },

  // ── which key is real ────────────────────────────────────────────────────────────────────────
  { name: 'any string is accepted as a package key',
    from: "export function isPackageKey(v: unknown): v is PackageKey {", to: "export function isPackageKey(v: unknown): v is PackageKey {\n  if (typeof v === 'string') return true" },
  { name: 'a RENEWAL key is accepted as a package key, so a $9 renewal reads as a $99 purchase',
    from: "export function isRenewalKey(v: unknown): v is RenewalKey {", to: "export function isRenewalKey(v: unknown): v is RenewalKey {\n  if (isPackageKey(v)) return true" },
  ],
}
