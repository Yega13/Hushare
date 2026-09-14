import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createAdminClient } from '@/lib/supabase/admin'
import { timingSafeEqual } from '@/lib/timing-safe'
import { serverError } from '@/lib/server/respond'
import { reportServerError } from '@/lib/report-server-error'
import { readWithRetry } from '@/lib/server/read-with-retry'
import {
  reconcileStep, pruneBackup, parseBackupState, backupRunDue, nextBackupState,
  BACKUP_STATE_KEY, RECONCILE_TIME_BUDGET_MS, RECONCILE_COPY_BUDGET, QUEUE_WINDOW_MS,
  type BackupBucket, type BackupDeps,
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
// Called every minute by worker.ts. Mid-pass it walks the next page of the media bucket and copies
// what the backup lacks; between passes it returns after one database read, until a day has passed.
// Its first pass is the backfill of everything uploaded before the queue existed -- about ten hours
// for the 62,250 objects there were on 2026-09-14.
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
  if (!backupRunDue(state, started)) {
    return NextResponse.json({ ok: true, idle: true, lastPassCompletedAt: state.lastPassCompletedAt }, { headers: NO_STORE })
  }

  const deps: BackupDeps = {
    source,
    backup,
    now: () => new Date(),
    log: (message) => { console.error(message) },
    fixedLength: (size) => new FixedLengthStream(size),
  }

  let step
  try {
    step = await reconcileStep({
      ...deps,
      startAfter: state.startAfter,
      budget: RECONCILE_COPY_BUDGET,
      missedAfterMs: QUEUE_WINDOW_MS,
      shouldStop: () => Date.now() - started > RECONCILE_TIME_BUDGET_MS,
    })
  } catch (e) {
    return serverError(SOURCE, e, { publicMessage: 'Backup walk failed' })
  }

  let pruned: { removed: number; kept: number; failed: number } | null = null
  if (step.passComplete) {
    try {
      pruned = await pruneBackup(deps)
      if (pruned.failed > 0) reportServerError(SOURCE, 'Backup prune failed', { context: { failed: pruned.failed } })
    } catch (e) {
      reportServerError(SOURCE, 'Backup prune failed', { context: { reason: reasonOf(e).slice(0, 300) } })
    }
  }

  // THE WRITE HAS TO STICK, and supabase-js reports a failed one as { error } rather than throwing.
  // Unsaved progress repeats the same page every minute -- harmless, but it must not be silent.
  const nowIso = new Date().toISOString()
  const saved = await admin.from('system_state').upsert({
    key: BACKUP_STATE_KEY, value: JSON.stringify(nextBackupState(state, step, nowIso)), updated_at: nowIso,
  }).then(
    (r: { error: { message: string } | null }) => r?.error?.message ?? null,
    (e: unknown) => reasonOf(e),
  )
  if (saved !== null) reportServerError(SOURCE, 'Could not save backup progress', { context: { reason: saved.slice(0, 300) } })

  // One stable sentence each, so a failure repeating every minute coalesces into one panel row.
  if (step.failure) {
    reportServerError(SOURCE, 'Backup copy failed', { context: { key: step.failure.key, reason: step.failure.reason.slice(0, 300) } })
  }
  // THE FIRST PASS IS THE BACKFILL: everything it copies predates the queue, so it proves nothing
  // about the queue. After it, an old object the walk had to copy is one the queue dropped.
  if (step.missed.length > 0 && state.firstPassCompletedAt !== null) {
    reportServerError(SOURCE, 'Backup queue missed objects', { context: { count: step.missed.length, keys: step.missed.slice(0, 10) } })
  }

  return NextResponse.json({
    ok: true,
    copied: step.copied,
    skipped: step.skipped,
    tombstoned: step.tombstoned,
    missed: step.missed.length,
    failure: step.failure?.key ?? null,
    passComplete: step.passComplete,
    pruned,
    ms: Date.now() - started,
  }, { headers: NO_STORE })
}
