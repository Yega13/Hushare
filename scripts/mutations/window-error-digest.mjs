// Mutation set for the digest on window errors in src/lib/report-error.ts -- run with:
//   node scripts/mutations/run.mjs window-error-digest
export default {
  file: 'src/lib/report-error.ts',
  test: 'tests/window-error-digest.test.ts',
  mutations: [
    { name: 'A BROWSER #419 ROW CANNOT BE MATCHED TO THE SERVER ERROR THAT CAUSED IT',
      from: "        ...(typeof digest === 'string' && digest !== '' ? { digest: digest.slice(0, 100) } : {}),", to: '        ...({}),' },
    { name: 'an error with no digest gets an empty digest field',
      from: "typeof digest === 'string' && digest !== '' ? { digest", to: "true ? { digest: String(digest), d" },
  ],
}
