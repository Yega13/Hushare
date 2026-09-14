// Mutation set for the photo backup's configuration in wrangler.toml -- run with:
//   node scripts/mutations/run.mjs backup-wrangler
export default {
  file: 'wrangler.toml',
  test: 'tests/architecture.test.ts',
  mutations: [
    { name: 'the Worker consumes a queue nothing sends to',
      from: 'queue = "hushare-media-events"', to: 'queue = "hushare-media-event"' },
    { name: 'the Worker consumes no queue at all',
      from: '[[queues.consumers]]\nqueue = "hushare-media-events"\n', to: '' },
    { name: 'THE BACKUP IS BOUND TO THE MEDIA BUCKET ITSELF -- one copy, twice',
      from: 'binding = "R2_BACKUP"\nbucket_name = "hushare-media-backup"', to: 'binding = "R2_BACKUP"\nbucket_name = "hushare-media"' },
  ],
}
