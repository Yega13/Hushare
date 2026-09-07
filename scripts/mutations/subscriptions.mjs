// Mutation set for src/lib/subscriptions.ts -- run with: node scripts/mutations/run.mjs subscriptions
// Each entry is a change that would make the code WRONG; the tests in tests/subscriptions.test.ts must fail on it.
export default {
  file: 'src/lib/subscriptions.ts',
  test: 'tests/subscriptions.test.ts',
  mutations: [
  { name: 'every subscription is dropped (every paying customer becomes free)',
    from: "    if (isOneOf(PACKAGE_TIERS, row.tier)) active.push({ ...row, tier: row.tier })",
    to:   "    if (false) active.push({ ...row, tier: row.tier as 'pro' })" },
  { name: 'an unknown tier is granted (the opposite of the safe direction)',
    from: "    if (isOneOf(PACKAGE_TIERS, row.tier)) active.push({ ...row, tier: row.tier })",
    to:   "    if (true) active.push({ ...row, tier: row.tier as 'pro' })" },
  { name: 'an unknown tier is dropped silently',
    from: "    else reportServerError('subscriptions', 'active subscription row has a tier this code does not know; it grants nothing', { account: userId, context: { id: row.id, tier: row.tier } })",
    to:   "    else void row" },
  { name: 'prefer-higher-tier is lost (a stale newer pro hides a studio)',
    from: "  return active.find((s) => s.tier === 'studio') ?? active[0]\n}\n\ntype UserLike",
    to:   "  return active[0]\n}\n\ntype UserLike" },
  { name: 'inactive rows are considered',
    from: "  for (const row of (data ?? []).filter(isSubActive)) {",
    to:   "  for (const row of (data ?? [])) {" },
  ],
}
