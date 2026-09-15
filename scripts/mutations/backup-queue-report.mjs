// Mutation set for src/app/api/cron/backup-queue-report/route.ts -- run with:
//   node scripts/mutations/run.mjs backup-queue-report
//
// The photo backup queue's only way into the error panel. Each mutation below either lets anyone write rows
// into the panel, stores whatever body arrives, or drops the report -- and the queue handler that posts here
// reads nothing of the answer but its status.
export default {
  file: 'src/app/api/cron/backup-queue-report/route.ts',
  test: 'tests/route-wiring-backup-queue-report.test.ts',
  mutations: [
    { name: 'anyone can put a row in the error panel',
      from: '  if (!secret || !timingSafeEqual(provided, secret)) {', to: '  if (false) {' },
    { name: 'A BODY OF ANY SHAPE IS STORED',
      from: "  if (typeof body?.message !== 'string' || !isFlatContext(body.context)) {", to: '  if (false) {' },
    { name: 'an array passes as context',
      from: ' && !Array.isArray(v)', to: '' },
    { name: 'nested objects pass as context',
      from: "Object.values(v).every((x) => typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x)))", to: 'true' },
    { name: 'THE REPORT IS NEVER WRITTEN -- the queue gives up in silence again',
      from: '  reportServerError(SOURCE, body.message, { context: body.context })\n', to: '' },
    { name: 'the report lands under a source nobody filters for',
      from: "const SOURCE = 'queue/media-backup'", to: "const SOURCE = 'cron/backup-queue-report'" },
  ],
}
