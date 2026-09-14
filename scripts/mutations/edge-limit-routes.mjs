// Mutation set for which edge limit the album photos route asks, in src/app/api/album/photos/route.ts -- run with:
//   node scripts/mutations/run.mjs edge-limit-routes
export default {
  file: 'src/app/api/album/photos/route.ts',
  test: 'tests/edge-rate-limit-config.test.ts',
  mutations: [
    { name: 'THE PHOTO READ COUNTS AGAINST THE RESOLVE LIMIT -- 900 a minute for a whole venue',
      from: "  const rl = await readRateLimit(req, 'albumPhotos')", to: "  const rl = await readRateLimit(req, 'albumResolve')" },
  ],
}
