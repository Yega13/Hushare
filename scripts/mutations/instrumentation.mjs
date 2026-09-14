// Mutation set for src/instrumentation.ts -- run with:
//   node scripts/mutations/run.mjs instrumentation
export default {
  file: 'src/instrumentation.ts',
  test: 'tests/instrumentation.test.ts',
  mutations: [
    { name: 'the edge runtime loads the Supabase reporter it cannot run',
      from: "  if (process.env.NEXT_RUNTIME === 'edge') return\n", to: '' },
    { name: 'the route and render source are dropped on the way to the reporter',
      from: '  reportRequestError(err, request, context)', to: '  reportRequestError(err, request, {})' },
    { name: 'SERVER ERRORS GO NOWHERE AGAIN',
      from: '  reportRequestError(err, request, context)', to: '  void err' },
  ],
}
