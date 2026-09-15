// Mutation set for src/app/api/cron/backup-reconcile/route.ts -- run with:
//   node scripts/mutations/run.mjs backup-reconcile-cron
//
// The every-minute walk and sweep under the photo backup. Nothing reads this route's response, so each
// mutation below either stops the backup quietly, stops erasing on time, or hides a failure from the only
// place anyone looks.
// The sweep block and the walk block, verbatim, for the one mutation that swaps their order. If either
// drifts from the route, the runner reports DID NOT APPLY rather than passing quietly.
const PRUNE = `  let pruned: Pick<PruneResult, 'removed' | 'kept' | 'failed' | 'sweepComplete'> | null = null
  if (pruneDue) {
    try {
      const sweep = await pruneBackup({
        ...deps,
        startAfter: state.pruneStartAfter,
        opBudget: PRUNE_OP_BUDGET,
        shouldStop: () => Date.now() - started > PRUNE_TIME_BUDGET_MS,
      })
      pruned = { removed: sweep.removed, kept: sweep.kept, failed: sweep.failed, sweepComplete: sweep.sweepComplete }
      next = nextPruneState(next, sweep, new Date().toISOString())
      if (sweep.failed > 0) reportServerError(SOURCE, 'Backup prune failed', { context: { failed: sweep.failed } })
    } catch (e) {
      reportServerError(SOURCE, 'Backup prune failed', { context: { reason: reasonOf(e).slice(0, 300) } })
    }
  }

`
const WALK = `  let step: ReconcileResult | null = null
  let walkFailure: { error: unknown } | null = null
  if (walkDue) {
    try {
      step = await reconcileStep({
        ...deps,
        startAfter: state.startAfter,
        budget: RECONCILE_COPY_BUDGET,
        opBudget: RECONCILE_OP_BUDGET,
        missedAfterMs: QUEUE_WINDOW_MS,
        shouldStop: () => Date.now() - started > RECONCILE_TIME_BUDGET_MS,
      })
      next = nextBackupState(next, step, new Date().toISOString())
    } catch (e) {
      walkFailure = { error: e }
    }
  }

`

export default {
  file: 'src/app/api/cron/backup-reconcile/route.ts',
  test: 'tests/route-wiring-backup-reconcile.test.ts',
  mutations: [
    { name: 'THE WALK RUNS FIRST, and a walk longer than 10 seconds leaves the sweep no time to erase anything',
      from: PRUNE + WALK, to: WALK + PRUNE },
    { name: 'anyone can run the walk',
      from: '  if (!secret || !timingSafeEqual(provided, secret)) {', to: '  if (false) {' },
    { name: 'WITH NO SECRET SET, ANYONE CAN RUN THE WALK -- timingSafeEqual("", "") is true',
      from: '  if (!secret || !timingSafeEqual(provided, secret)) {', to: '  if (!timingSafeEqual(provided, secret)) {' },
    { name: 'an unreadable position is walked from the start, silently',
      from: "  if (error) {\n    return serverError(SOURCE, error.message, { publicMessage: 'Could not read backup progress' })\n  }\n", to: '' },
    { name: 'the walk and the sweep run every minute between passes, listing buckets all day',
      from: '  if (!walkDue && !pruneDue) {', to: '  if (false) {' },
    { name: 'A SWEEP THAT IS DUE BETWEEN PASSES NEVER RUNS, so erasing waits on the walk again',
      from: '  if (!walkDue && !pruneDue) {', to: '  if (!walkDue) {' },
    { name: 'THE SAVED POSITION IS IGNORED, so the backfill never gets past its first range',
      from: '        startAfter: state.startAfter,', to: "        startAfter: ''," },
    { name: 'THE SAVED SWEEP POSITION IS IGNORED, so a large sweep restarts from the first tombstone',
      from: '        startAfter: state.pruneStartAfter,', to: "        startAfter: ''," },
    { name: 'the copy budget is not passed',
      from: '        budget: RECONCILE_COPY_BUDGET,', to: '        budget: Infinity,' },
    { name: 'THE WALK HAS NO OPERATION BUDGET, so a deleted album runs the Worker past its subrequest limit',
      from: '        opBudget: RECONCILE_OP_BUDGET,', to: '        opBudget: Infinity,' },
    { name: 'the sweep has no operation budget',
      from: '        opBudget: PRUNE_OP_BUDGET,', to: '        opBudget: Infinity,' },
    { name: 'the walk time budget is not passed',
      from: '        shouldStop: () => Date.now() - started > RECONCILE_TIME_BUDGET_MS,', to: '        shouldStop: () => false,' },
    { name: 'the sweep time budget is not passed',
      from: '        shouldStop: () => Date.now() - started > PRUNE_TIME_BUDGET_MS,', to: '        shouldStop: () => false,' },
    { name: 'COPIES BYPASS FixedLengthStream, which R2 refuses in production',
      from: '    fixedLength: (size) => new FixedLengthStream(size),', to: '    fixedLength: () => new TransformStream(),' },
    { name: 'a missing FixedLengthStream is not caught up front',
      from: '  if (!source || !backup || !FixedLengthStream) {', to: '  if (!source || !backup) {' },
    { name: 'a prune that failed is not reported',
      from: "      if (sweep.failed > 0) reportServerError(SOURCE, 'Backup prune failed', { context: { failed: sweep.failed } })\n", to: '' },
    { name: 'the sweep position is not saved',
      from: '      next = nextPruneState(next, sweep, new Date().toISOString())\n', to: '' },
    { name: 'the walk position is not saved, so every run repeats the same range',
      from: '      next = nextBackupState(next, step, new Date().toISOString())\n', to: '' },
    { name: 'A WALK THAT THROWS takes the sweep progress of the same run with it',
      from: '      walkFailure = { error: e }', to: '      throw e' },
    { name: 'unsaved progress is not reported',
      from: '  if (saved !== null) reportServerError(', to: '  if (false) reportServerError(' },
    { name: 'A COPY THAT FAILS IS NOT REPORTED',
      from: '  if (step?.failure) {\n    reportServerError', to: '  if (false) {\n    reportServerError' },
    { name: 'A REUSED KEY IS NEVER REPORTED',
      from: '  if (step && step.conflicts.length > 0) {', to: '  if (false) {' },
    { name: 'the backfill reports sixty thousand objects as missed by the queue',
      from: '  if (step && step.missed.length > 0 && state.firstPassCompletedAt !== null) {', to: '  if (step && step.missed.length > 0) {' },
    { name: 'A QUEUE THAT DROPS EVENTS IS NEVER REPORTED',
      from: '  if (step && step.missed.length > 0 && state.firstPassCompletedAt !== null) {', to: '  if (step && step.missed.length > 0 && state.firstPassCompletedAt === null) {' },
  ],
}
