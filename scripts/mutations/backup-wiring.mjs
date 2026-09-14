// Mutation set for the photo backup's wiring in worker.ts -- run with:
//   node scripts/mutations/run.mjs backup-wiring
//
// worker.ts imports the OpenNext build, so no test can load it; tests/architecture.test.ts reads it as
// text instead. Each mutation below deploys cleanly and leaves the backup doing nothing.
export default {
  file: 'worker.ts',
  test: 'tests/architecture.test.ts',
  mutations: [
    { name: 'THE QUEUE HANDLER IS GONE -- every event is delivered to nothing',
      from: '  async queue(batch: MessageBatch, env: Env): Promise<void> {', to: '  async queueDisabled(batch: MessageBatch, env: Env): Promise<void> {' },
    { name: 'the handler never calls the consumer',
      from: '    await consumeMediaEvents(batch, env, {', to: '    await Promise.resolve(batch && env && {' },
    { name: 'copies bypass FixedLengthStream, which R2 refuses in production',
      from: '      fixedLength: (size) => new FixedLengthStream(size),', to: '      fixedLength: () => new TransformStream(),' },
    { name: 'the every-minute schedule no longer runs the reconcile walk',
      from: "        callCronRoute(baseUrl, '/api/cron/backup-reconcile', secret),\n", to: '' },
  ],
}
