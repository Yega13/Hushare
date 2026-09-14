// Mutation set for the failed-read branch of src/app/wall/[slug]/page.tsx -- run with:
//   node scripts/mutations/run.mjs wall-page-unavailable
export default {
  file: 'src/app/wall/[slug]/page.tsx',
  test: 'tests/wall-page-unavailable.test.tsx',
  mutations: [
    { name: 'THE VENUE SCREEN CALLS A FAILED READ A PRIVATE ALBUM',
      from: "  if (resolved.kind === 'unavailable') {\n",
      to: "  if (false) {\n" },
    { name: 'a failed read on the wall is a 404',
      from: "  if (resolved.kind === 'invalid' || resolved.kind === 'notfound') notFound()",
      to: "  if (resolved.kind === 'invalid' || resolved.kind === 'notfound' || resolved.kind === 'unavailable') notFound()" },
  ],
}
