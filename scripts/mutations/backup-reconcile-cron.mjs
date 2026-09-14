// Mutation set for src/app/api/cron/backup-reconcile/route.ts -- run with:
//   node scripts/mutations/run.mjs backup-reconcile-cron
//
// The every-minute walk under the photo backup. Nothing reads this route's response, so each mutation
// below either stops the backup quietly or hides a failure from the only place anyone looks.
export default {
  file: 'src/app/api/cron/backup-reconcile/route.ts',
  test: 'tests/route-wiring-backup-reconcile.test.ts',
  mutations: [
    { name: 'anyone can run the walk',
      from: '  if (!secret || !timingSafeEqual(provided, secret)) {', to: '  if (false) {' },
    { name: 'an unreadable position is walked from the start, silently',
      from: "  if (error) {\n    return serverError(SOURCE, error.message, { publicMessage: 'Could not read backup progress' })\n  }\n", to: '' },
    { name: 'the walk runs every minute between passes, listing the whole bucket all day',
      from: '  if (!backupRunDue(state, started)) {', to: '  if (false) {' },
    { name: 'THE SAVED POSITION IS IGNORED, so the backfill never gets past its first page',
      from: '      startAfter: state.startAfter,', to: "      startAfter: '',"},
    { name: 'the copy budget is not passed',
      from: '      budget: RECONCILE_COPY_BUDGET,', to: '      budget: Infinity,' },
    { name: 'the time budget is not passed',
      from: '      shouldStop: () => Date.now() - started > RECONCILE_TIME_BUDGET_MS,', to: '      shouldStop: () => false,' },
    { name: 'COPIES BYPASS FixedLengthStream, which R2 refuses in production',
      from: '    fixedLength: (size) => new FixedLengthStream(size),', to: '    fixedLength: () => new TransformStream(),' },
    { name: 'a missing FixedLengthStream is not caught up front',
      from: '  if (!source || !backup || !FixedLengthStream) {', to: '  if (!source || !backup) {' },
    { name: 'the prune runs mid-pass',
      from: '  if (step.passComplete) {\n    try {', to: '  if (true) {\n    try {' },
    { name: 'a prune that failed is not reported',
      from: "      if (pruned.failed > 0) reportServerError(SOURCE, 'Backup prune failed', { context: { failed: pruned.failed } })\n", to: '' },
    { name: 'the position is saved unchanged, so every run repeats the same page',
      from: 'value: JSON.stringify(nextBackupState(state, step, nowIso)),', to: 'value: JSON.stringify(state),' },
    { name: 'unsaved progress is not reported',
      from: '  if (saved !== null) reportServerError(', to: '  if (false) reportServerError(' },
    { name: 'A COPY THAT FAILS IS NOT REPORTED',
      from: '  if (step.failure) {\n    reportServerError', to: '  if (false) {\n    reportServerError' },
    { name: 'the backfill reports sixty thousand objects as missed by the queue',
      from: '  if (step.missed.length > 0 && state.firstPassCompletedAt !== null) {', to: '  if (step.missed.length > 0) {' },
    { name: 'A QUEUE THAT DROPS EVENTS IS NEVER REPORTED',
      from: '  if (step.missed.length > 0 && state.firstPassCompletedAt !== null) {', to: '  if (step.missed.length > 0 && state.firstPassCompletedAt === null) {' },
  ],
}
