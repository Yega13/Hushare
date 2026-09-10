// Mutation set for the GATE DISCOVERY inside tests/plan-features.test.ts -- run with:
//   node scripts/mutations/run.mjs plan-gate-discovery
//
// UNUSUAL, AND DELIBERATE: the subject here IS a test file. What tests/plan-features.test.ts holds
// is "every tier gate in src/app has been decided about", and the mechanism that makes that true is
// the set of patterns it scans with -- code that lives in the test. A hole in those patterns is
// silent by construction: fewer files found means fewer files checked, and the suite goes greener,
// not redder.
//
// That is not hypothetical. Both mutations below are the file's own history. `requireTier` gated
// four Max-only handlers in api/collections and matched no pattern at all, and the two helper
// patterns used `[^)]*?`, which cannot cross the nested parenthesis in wall/[slug]'s call -- so
// that route sat in the table only because somebody had typed it there by hand.
export default {
  file: 'tests/plan-features.test.ts',
  test: 'tests/plan-features.test.ts',
  mutations: [
  { name: 'a gate helper is dropped from the list, so every route using it becomes invisible',
    from: "const GATE_HELPERS = ['refuseBelowTier', 'albumHasTier', 'requireTier']",
    to: "const GATE_HELPERS = ['refuseBelowTier', 'albumHasTier']" },
  { name: 'the helper patterns cannot cross a nested parenthesis again (the wall/[slug] hole)',
    from: "  new RegExp(name + String.raw`\\([\\s\\S]{0,300}?['\"](pro|studio)['\"]`, 'g')",
    to: "  new RegExp(name + String.raw`\\([^)]*?['\"](pro|studio)['\"]`, 'g')" },
  { name: 'the reach is narrowed to a few characters, so an argument list of any size hides the tier',
    from: "String.raw`\\([\\s\\S]{0,300}?['\"](pro|studio)['\"]`",
    to: "String.raw`\\([\\s\\S]{0,8}?['\"](pro|studio)['\"]`" },
  // The `gatedFiles.length >= N` floor that used to sit here was mutated too, and survived: once
  // every route in the table must be FOUND by name, a count can no longer fail on its own. It was
  // deleted rather than kept, and the reasoning is written into the test that replaced it.
  ],
}
