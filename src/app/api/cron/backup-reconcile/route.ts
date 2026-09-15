import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createAdminClient } from '@/lib/supabase/admin'
import { timingSafeEqual } from '@/lib/timing-safe'
import { serverError } from '@/lib/server/respond'
import { reportServerError } from '@/lib/report-server-error'
import { readWithRetry } from '@/lib/server/read-with-retry'
import {
  reconcileStep, pruneBackup, parseBackupState, backupRunDue, pruneRunDue, nextBackupState, nextPruneState,
  BACKUP_STATE_KEY, RECONCILE_TIME_BUDGET_MS, PRUNE_TIME_BUDGET_MS, RECONCILE_COPY_BUDGET, RECONCILE_OP_BUDGET,
  PRUNE_OP_BUDGET, QUEUE_WINDOW_MS,
  type BackupBucket, type BackupDeps, type ReconcileResult, type PruneResult,
} from '@/lib/server/media-backup'

export const runtime = 'nodejs'
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' }
const SOURCE = 'cron/backup-reconcile'

// FixedLengthStream is a Workers global, not a DOM type -- the image relay reads it the same way.
type FixedLengthStreamCtor = new (length: number) => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }
type BackupEnv = { R2_BUCKET?: BackupBucket; R2_BACKUP?: BackupBucket }

const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// THE SAFETY NET UNDER THE PHOTO BACKUP (lib/server/media-backup has the whole design).
//
// Called every minute by worker.ts. Mid-pass it walks the next range of the media bucket and copies
// what the backup lacks; between passes it returns after one database read, until a day has passed.
// Its first pass is the backfill of everything uploaded before the queue existed. MEASURED on 2026-09-15 in
// production, not worked out: about 20 copies a run, because the 25-second time budget binds long before
// the 200-copy one, so the 63,716 objects (61.75 GB) there were take roughly 38 to 50 hours.
//
// THE PRUNE SWEEP HAS ITS OWN CLOCK and runs FIRST, inside its own budget. It used to run only when a
// walk pass finished, which made every erasure wait on a pass -- and a walk that could not finish
// stopped erasing altogether (review of 2026-09-14). Now a sweep is due every six hours, resumes where
// it stopped, and a walk that fails in the same run cannot take the sweep's progress with it.
//
// Two runs overlapping (a run longer than a minute) cost repeated work, not wrong work: every copy and
// every deletion record is checked for before it is written, and the later position simply wins.
export async function POST(req: Request) {
  const secret = process.env.ALBUM_RETIREMENT_SECRET ?? ''
  const auth = req.headers.get('Authorization') ?? ''
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!secret || !timingSafeEqual(provided, secret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  }

  const env = getCloudflareContext()?.env as BackupEnv | undefined
  const source = env?.R2_BUCKET
  const backup = env?.R2_BACKUP
  const FixedLengthStream = (globalThis as unknown as { FixedLengthStream?: FixedLengthStreamCtor }).FixedLengthStream
  if (!source || !backup || !FixedLengthStream) {
    return serverError(SOURCE, 'Backup bucket bindings unavailable', { publicMessage: 'Backup unavailable' })
  }

  const admin = createAdminClient()
  // A POSITION WE COULD NOT READ IS NOT THE START. Walking from the first key would only repeat work,
  // but it would also hide that the row is unreadable -- and the same row is where progress is saved.
  const { result: { data, error } } = await readWithRetry(() => admin
    .from('system_state').select('value').eq('key', BACKUP_STATE_KEY).maybeSingle())
  if (error) {
    return serverError(SOURCE, error.message, { publicMessage: 'Could not read backup progress' })
  }
  const state = parseBackupState(data?.value)
  const started = Date.now()
  const walkDue = backupRunDue(state, started)
  const pruneDue = pruneRunDue(state, started)
  if (!walkDue && !pruneDue) {
    return NextResponse.json({ ok: true, idle: true, lastPassCompletedAt: state.lastPassCompletedAt }, { headers: NO_STORE })
  }

  const deps: BackupDeps = {
    source,
    backup,
    now: () => new Date(),
    log: (message) => { console.error(message) },
    fixedLength: (size) => new FixedLengthStream(size),
  }
  let next = state

  let pruned: Pick<PruneResult, 'removed' | 'kept' | 'failed' | 'sweepComplete'> | null = null
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

  let step: ReconcileResult | null = null
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

  // THE WRITE HAS TO STICK, and supabase-js reports a failed one as { error } rather than throwing.
  // Unsaved progress repeats the same range every minute -- harmless, but it must not be silent. Saved
  // before a failed walk is answered, so the sweep's progress in this run is never thrown away with it.
  const nowIso = new Date().toISOString()
  const saved = await admin.from('system_state').upsert({
    key: BACKUP_STATE_KEY, value: JSON.stringify(next), updated_at: nowIso,
  }).then(
    (r: { error: { message: string } | null }) => r?.error?.message ?? null,
    (e: unknown) => reasonOf(e),
  )
  if (saved !== null) reportServerError(SOURCE, 'Could not save backup progress', { context: { reason: saved.slice(0, 300) } })

  if (walkFailure) return serverError(SOURCE, walkFailure.error, { publicMessage: 'Backup walk failed' })

  // One stable sentence each, so a failure repeating every minute coalesces into one panel row.
  if (step?.failure) {
    reportServerError(SOURCE, 'Backup copy failed', { context: { key: step.failure.key, reason: step.failure.reason.slice(0, 300) } })
  }
  // A REUSED KEY: the backup holds different bytes under it and will not overwrite them. Something wrote
  // media in place, which the backup cannot protect -- see the note at the top of lib/server/media-backup.
  if (step && step.conflicts.length > 0) {
    reportServerError(SOURCE, 'Backup copy held at a different size', { context: { count: step.conflicts.length, keys: step.conflicts.slice(0, 10) } })
  }
  // THE FIRST PASS IS THE BACKFILL: everything it copies predates the queue, so it proves nothing
  // about the queue. After it, an old object the walk had to copy is one the queue dropped.
  if (step && step.missed.length > 0 && state.firstPassCompletedAt !== null) {
    reportServerError(SOURCE, 'Backup queue missed objects', { context: { count: step.missed.length, keys: step.missed.slice(0, 10) } })
  }

  return NextResponse.json({
    ok: true,
    walked: step !== null,
    copied: step?.copied ?? 0,
    skipped: step?.skipped ?? 0,
    tombstoned: step?.tombstoned ?? 0,
    missed: step?.missed.length ?? 0,
    conflicts: step?.conflicts.length ?? 0,
    failure: step?.failure?.key ?? null,
    passComplete: step?.passComplete ?? false,
    ops: step?.ops ?? 0,
    pruned,
    ms: Date.now() - started,
  }, { headers: NO_STORE })
}
