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
    { name: 'the photos that came with the album are dropped, so every album paints empty first',
      from: "  const initialPhotos: Photo[] = resolved.photos\n",
      to: "  const initialPhotos: Photo[] = []\n" },
    { name: 'the total is taken from the first window, so a big album never offers the rest',
      from: "  const initialTotal = resolved.total\n",
      to: "  const initialTotal = resolved.photos.length\n" },
  ],
}
