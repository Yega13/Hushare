// Mutation set for scripts/gen-db-types-emit.mjs -- run with: node scripts/mutations/run.mjs db-types-emit
// Each entry is a change that would make the code WRONG; the tests in tests/db-types.test.ts must fail on it.
export default {
  file: 'scripts/gen-db-types-emit.mjs',
  test: 'tests/db-types.test.ts',
  mutations: [
  {
    name: 'a NOT NULL column with a default becomes REQUIRED on insert',
    from: "const required = c.is_nullable === 'NO' && c.column_default === null && !isIdentity(c)",
    to: "const required = c.is_nullable === 'NO'",
  },
  {
    name: 'GENERATED ALWAYS identity is offered on insert (the write Postgres refuses)',
    from: "const isAlwaysIdentity = (col) => col.is_identity === 'YES' && col.identity_generation === 'ALWAYS'",
    to: "const isAlwaysIdentity = () => false",
  },
  {
    name: 'nullable columns lose their `| null`',
    from: "  return col.is_nullable === 'NO' ? base : `${base} | null`",
    to: "  return base",
  },
  {
    name: 'jsonb becomes unknown (sponsor_logos crash stops being a compile error)',
    from: "  jsonb: 'Json',",
    to: "  jsonb: 'unknown',",
  },
  {
    name: 'timestamptz becomes Date (PostgREST actually sends a string)',
    from: "  timestamptz: 'string',",
    to: "  timestamptz: 'Date',",
  },
  {
    name: 'an unmapped Postgres type is guessed instead of refused',
    from: "    throw new Error(`unmapped udt_name '${col.udt_name}' on ${col.table_name}.${col.column_name}`)",
    to: "    return 'unknown'",
  },
  {
    name: 'function arguments split on every comma, not top-level ones',
    from: "    if (ch === ',' && depth === 0 && !quoted) { out.push(cur); cur = ''; continue }",
    to: "    if (ch === ',') { out.push(cur); cur = ''; continue }",
  },
  {
    name: 'DEFAULTed function arguments become required',
    from: "    const hasDefault = / DEFAULT /i.test(raw)",
    to: "    const hasDefault = false",
  },
  {
    name: 'the Functions map is emitted empty (every .rpc() breaks)',
    from: "  for (const fn of [...functions].sort((a, b) => a.proname.localeCompare(b.proname))) {",
    to: "  for (const fn of []) {",
  },
  ],
}
