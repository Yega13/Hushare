// Mutations for the question "did they pay for this, or did we give it to them?"
//
// It was answered in three places that disagreed: the comp script writes polar_product_id = "comp",
// the admin button writes "comp-pro"/"comp-studio", and the dashboard asked startsWith("comp-").
// "comp" does not start with "comp-", so every gift sent by the script was counted as revenue.
// Two of seven live rows were on the wrong side of it.
//
// The direction matters: calling revenue a gift understates a number on an internal page; calling a
// gift revenue means valuing the business from a figure that includes things nobody paid for.
export default {
  file: 'src/lib/subscription-origin.ts',
  test: 'tests/subscription-origin.test.ts',
  mutations: [
    {
      name: 'the bare "comp" marker stops matching — the exact bug, restored',
      from: "export const COMP_PREFIX = 'comp'",
      to: "export const COMP_PREFIX = 'comp-'",
    },
    {
      name: 'only the product id is consulted, so a comp marked on the subscription id is revenue',
      from: '  if (marksAComp(row.polar_subscription_id)) return \u0027comped\u0027',
      to: '  if (false) return \u0027comped\u0027',
    },
    {
      name: 'only the subscription id is consulted, missing the shape already in the table',
      from: '  if (marksAComp(row.polar_product_id)) return \u0027comped\u0027',
      to: '  if (false) return \u0027comped\u0027',
    },
    {
      name: 'the marker is matched anywhere in the value, not only at the start',
      from: '  return value.trim().toLowerCase().startsWith(COMP_PREFIX)',
      to: '  return value.trim().toLowerCase().includes(COMP_PREFIX)',
    },
    {
      name: 'a non-string reaches startsWith and throws inside the dashboard',
      from: "  if (typeof value !== 'string') return false",
      to: '  if (value === undefined) return false',
    },
    {
      name: 'case and whitespace stop being normalised, so a hand-run comp is read as revenue',
      from: '  return value.trim().toLowerCase().startsWith(COMP_PREFIX)',
      to: '  return value.startsWith(COMP_PREFIX)',
    },
    {
      name: 'every row is called comped, so the dashboard shows no revenue at all',
      from: "  return 'paid'",
      to: "  return 'comped'",
    },
  ],
}
