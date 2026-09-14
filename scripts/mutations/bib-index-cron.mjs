// Mutation set for src/app/api/cron/bib-index/route.ts -- run with:
//   node scripts/mutations/run.mjs bib-index-cron
//
// The every-minute indexer that carries a race album's bib and face search to completion. Each
// mutation below leaves it running happily -- and each one either lets a gateway blip become an error
// row, reads a failed query as "no albums", or lets an album fail every minute without a trace.
export default {
  file: 'src/app/api/cron/bib-index/route.ts',
  test: 'tests/route-wiring-bib-index.test.ts',
  mutations: [
    { name: 'the album read is not retried, so every :00/:30 gateway blip is an error row',
      from: "import { readWithRetry } from '@/lib/server/read-with-retry'",
      to: "const readWithRetry = async <T,>(read: () => PromiseLike<T>) => ({ result: await read(), attempts: 1 })" },
    { name: 'A FAILED READ IS AN EMPTY LIST AGAIN -- nothing is indexed and nothing is said',
      from: '  if (albumsError) {', to: '  if (false) {' },
    { name: 'an album whose indexing fails every minute leaves no trace on the panel',
      from: "      reportServerError('cron/bib-index', 'Album indexing failed', { albumId: album.id, context: { reason: msg.slice(0, 300) } })\n", to: '' },
    { name: 'the failure is reported without the album it happened to',
      from: '{ albumId: album.id, context: { reason: msg.slice(0, 300) } }', to: '{ albumId: null, context: { reason: msg.slice(0, 300) } }' },
  ],
}
