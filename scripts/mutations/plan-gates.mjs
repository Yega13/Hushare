// Mutation set for src/lib/plan-gates.ts -- run with: node scripts/mutations/run.mjs plan-gates
//
// The single table that says which plan each paid feature needs. Every mutation here is either
// something given away free, something a paying owner is refused, or the one-sided failure this
// file was built to end: the server refusing while the screen showed an ordinary switch.
export default {
  file: 'src/lib/plan-gates.ts',
  test: 'tests/plan-gates.test.ts',
  mutations: [
  { name: 'a tier still loading is treated as allowed, so every paid control is live for a moment',
    from: "  if (!tier) return false", to: "  if (!tier) return true" },
  { name: 'a feature needs its EXACT tier, so Pro loses the Pro features it pays for',
    from: "  return RANK[tier] >= RANK[FEATURE_TIER[feature]]", to: "  return RANK[tier] > RANK[FEATURE_TIER[feature]]" },
  { name: 'the comparison inverts: free gets everything and Max gets nothing',
    from: "  return RANK[tier] >= RANK[FEATURE_TIER[feature]]", to: "  return RANK[tier] <= RANK[FEATURE_TIER[feature]]" },
  { name: 'the tier is not consulted at all',
    from: "  return RANK[tier] >= RANK[FEATURE_TIER[feature]]", to: "  return true" },
  { name: 'Pro outranks Max',
    from: "const RANK: Record<Tier, number> = { free: 0, pro: 1, studio: 2 }",
    to: "const RANK: Record<Tier, number> = { free: 0, pro: 2, studio: 1 }" },
  { name: 'free ranks with Pro, so a free album keeps the Pro features',
    from: "const RANK: Record<Tier, number> = { free: 0, pro: 1, studio: 2 }",
    to: "const RANK: Record<Tier, number> = { free: 1, pro: 1, studio: 2 }" },
  { name: 'null reads as a known tier, so a PRO badge flashes on a control the owner paid for',
    from: "  return tier !== null && tier !== undefined", to: "  return tier !== undefined" },
  { name: 'undefined reads as a known tier (the same flash, from the other absent value)',
    from: "  return tier !== null && tier !== undefined", to: "  return tier !== null" },
  { name: 'a lock is shown before the tier is known -- the badge that contradicts what they bought',
    from: "  return tierIsKnown(tier) && !tierAllows(tier, feature)", to: "  return !tierAllows(tier, feature)" },
  { name: 'nothing ever shows as locked, so a free owner finds out from the error toast',
    from: "  return tierIsKnown(tier) && !tierAllows(tier, feature)", to: "  return false" },
  { name: 'the table says branding is Max while the route still refuses below Pro',
    from: "  hideBranding: 'pro',", to: "  hideBranding: 'studio'," },
  { name: 'the table gives bib search to Pro while the route still refuses below Max',
    from: "  bibSearch: 'studio',", to: "  bibSearch: 'pro'," },
  { name: 'the table gives the live wall to Pro while the page still checks Max',
    from: "  liveWall: 'studio',", to: "  liveWall: 'pro'," },
  { name: 'the table demands Max for a custom URL while the route refuses below Pro',
    from: "  customUrl: 'pro',", to: "  customUrl: 'studio'," },
  { name: 'a feature is dropped from the table, so it is gated nowhere and tested nowhere',
    from: "  sponsorLogos: 'studio',\n", to: "" },
  ],
}
