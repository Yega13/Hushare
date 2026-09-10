// Mutation set for ONE enforcement site -- run with: node scripts/mutations/run.mjs plan-gates-site
//
// scripts/mutations/plan-gates.mjs proves the table cannot drift away from the code. This proves
// the other direction, which is the one that actually shipped: the CODE drifting away from the
// table. "Remove Hushare branding" is the site that cost the trust -- it was gated on the server
// and drawn as an ordinary switch, so a free owner flipped it and learned it was paid from the
// error that came back. If tests/plan-gates.test.ts can be left green while this route changes
// what it charges for, the whole file is decoration.
export default {
  file: 'src/app/api/album/branding/route.ts',
  test: 'tests/plan-gates.test.ts',
  mutations: [
  { name: 'branding is quietly repriced to Max while the table and every badge still say Pro',
    from: "await refuseBelowTier(access.album, 'pro', 'Removing Hushare branding')",
    to: "await refuseBelowTier(access.album, 'studio', 'Removing Hushare branding')" },
  { name: 'the gate is removed, so any free album can take the Hushare mark off',
    from: "    const refused = await refuseBelowTier(access.album, 'pro', 'Removing Hushare branding')",
    to: "    const refused = null" },
  { name: 'the gate asks the OWNER ACCOUNT again, so a paid Pro Package album is refused its own feature',
    from: "await refuseBelowTier(access.album, 'pro'", to: "await refuseBelowTier(access.owner, 'pro'" },
  ],
}
