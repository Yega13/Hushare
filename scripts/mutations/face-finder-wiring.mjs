// Mutation set for the Face Finder skip decision's wiring in src/components/FaceFinder.tsx -- run with:
//   node scripts/mutations/run.mjs face-finder-wiring
export default {
  file: 'src/components/FaceFinder.tsx',
  test: 'tests/face-finder-wiring.test.tsx',
  mutations: [
    { name: 'THE ORIGINAL BUG: the loaded window decides whether the album is scanned',
      from: '    if (canSkipFaceIndexing(photos, albumTotal)) {',
      to: '    if (imagePhotos.length > 0 && imagePhotos.every((p) => p.face_ids != null)) {' },
    { name: 'the component hands the decision its loaded count instead of the album total',
      from: '    if (canSkipFaceIndexing(photos, albumTotal)) {',
      to: '    if (canSkipFaceIndexing(photos, photos.length)) {' },
  ],
}
