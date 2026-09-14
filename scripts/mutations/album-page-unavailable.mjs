// Mutation set for the failed-read branch of src/app/[slug]/page.tsx -- run with:
//   node scripts/mutations/run.mjs album-page-unavailable
export default {
  file: 'src/app/[slug]/page.tsx',
  test: 'tests/album-page-unavailable.test.tsx',
  mutations: [
    { name: 'THE ALBUM PAGE HAS NO ANSWER FOR A FAILED READ and crashes rendering a guest page',
      from: "  if (resolved.kind === 'unavailable') {\n    return (\n      <>\n        <OwnerHashFlag />\n        <AlbumPageClient />\n      </>\n    )\n  }\n",
      to: '' },
    { name: 'a failed read is rendered as a 404',
      from: "  if (resolved.kind === 'invalid' || resolved.kind === 'notfound') notFound()",
      to: "  if (resolved.kind === 'invalid' || resolved.kind === 'notfound' || resolved.kind === 'unavailable') notFound()" },
  ],
}
