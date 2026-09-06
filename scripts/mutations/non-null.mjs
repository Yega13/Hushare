// Mutation set for src/lib/non-null.ts -- run with: node scripts/mutations/run.mjs non-null
// Each entry is a change that would make the code WRONG; the tests in tests/non-null.test.ts must fail on it.
export default {
  file: 'src/lib/non-null.ts',
  test: 'tests/non-null.test.ts',
  mutations: [
  { name: 'the predicate body is neutered (every row passes, null and all)',
    from: "      if (row[k] === null || row[k] === undefined) { ok = false; break }\n", to: "" },
  { name: 'falsy is treated as null (drops "", 0, false)',
    from: "      if (row[k] === null || row[k] === undefined) { ok = false; break }",
    to:   "      if (!row[k]) { ok = false; break }" },
  { name: 'the empty string is treated as null',
    from: "      if (row[k] === null || row[k] === undefined) { ok = false; break }",
    to:   "      if (row[k] === null || row[k] === undefined || row[k] === '') { ok = false; break }" },
  { name: 'undefined is not treated as null',
    from: "      if (row[k] === null || row[k] === undefined) { ok = false; break }",
    to:   "      if (row[k] === null) { ok = false; break }" },
  { name: 'nullDropReport never reports',
    from: "  if (kept === scanned) return null\n  return {", to: "  return null\n  return {" },
  { name: 'nullDropReport reports on a clean run',
    from: "  if (kept === scanned) return null\n", to: "" },
  { name: 'nullDropReport counts the kept rows as dropped',
    from: "dropped: scanned - kept", to: "dropped: kept" },
  { name: 'nullDropReport puts the count in the message (defeats coalescing)',
    from: "message: `rows the query filtered as non-null arrived null: ${keys.join(', ')}`",
    to:   "message: `${scanned - kept} rows the query filtered as non-null arrived null: ${keys.join(', ')}`" },
  ],
}
