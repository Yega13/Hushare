// Mutation set for public/_headers -- run with:
//   node scripts/mutations/run.mjs static-headers
//
// The cache rules Cloudflare applies to static files. Each mutation below still deploys and still
// serves every page -- and each one either makes every repeat visit re-ask for every script, or pins a
// file that can change under its own name in guests' browsers for a year.
export default {
  file: 'public/_headers',
  test: 'tests/static-headers.test.ts',
  mutations: [
    { name: 'THE RULE IS GONE -- every script is re-validated on every visit again',
      from: '/_next/static/*\n  Cache-Control: public,max-age=31536000,immutable\n', to: '' },
    { name: 'the build output is cached for no time at all',
      from: 'max-age=31536000,immutable', to: 'max-age=0,must-revalidate' },
    { name: 'EVERYTHING is marked immutable, so a replaced logo or font is stale for a year',
      from: '/_next/static/*\n', to: '/*\n' },
    { name: 'a font that keeps its name is pinned for a year beside the build output',
      from: '/_next/static/*\n', to: '/fonts/*\n  Cache-Control: public,max-age=31536000,immutable\n/_next/static/*\n' },
  ],
}
