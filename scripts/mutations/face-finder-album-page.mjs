// Mutation set for what the album page hands Face Finder, in src/app/[slug]/AlbumPageClient.tsx -- run with:
//   node scripts/mutations/run.mjs face-finder-album-page
export default {
  file: 'src/app/[slug]/AlbumPageClient.tsx',
  test: 'tests/face-finder-wiring.test.tsx',
  mutations: [
    { name: 'THE ALBUM PAGE PASSES THE LOADED WINDOW AS THE ALBUM TOTAL -- the same bug one component up',
      from: 'photos={photos} albumTotal={total}', to: 'photos={photos} albumTotal={photos.length}' },
  ],
}
