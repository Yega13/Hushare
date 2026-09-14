// Mutation set for the edge read limits declared in wrangler.toml -- run with:
//   node scripts/mutations/run.mjs edge-limit-wrangler
export default {
  file: 'wrangler.toml',
  test: 'tests/edge-rate-limit-config.test.ts',
  mutations: [
    { name: 'THE PHOTO READ LIMIT IN PRODUCTION IS TENFOLD LOWER THAN THE CODE SAYS -- a venue hits it',
      from: 'name = "ALBUM_PHOTOS_LIMITER"\nnamespace_id = "1003"\n  [ratelimits.simple]\n  limit = 20000',
      to: 'name = "ALBUM_PHOTOS_LIMITER"\nnamespace_id = "1003"\n  [ratelimits.simple]\n  limit = 2000' },
    { name: 'staging has no presence limiter, so it silently pays the database round trip again',
      from: '[[env.staging.ratelimits]]\nname = "PRESENCE_LIMITER"\nnamespace_id = "2005"\n  [env.staging.ratelimits.simple]\n  limit = 3000\n  period = 60\n',
      to: '' },
    { name: 'the resolve limiter shares the photo limiter\'s namespace, and so its counter',
      from: 'name = "ALBUM_RESOLVE_LIMITER"\nnamespace_id = "1004"', to: 'name = "ALBUM_RESOLVE_LIMITER"\nnamespace_id = "1003"' },
  ],
}
