// A SECOND COPY OF EVERY PHOTO, IN A BUCKET NOTHING ELSE WRITES TO.
//
// The 2026-09-03 architecture audit's worst finding, still open on 2026-09-14: the nightly backup
// copied Postgres only. Every photo guests had uploaded existed exactly once, in hushare-media (66 GB,
// 62,250 objects that day), so a bug in a delete path, a mistaken cleanup or a leaked key could remove
// them for good -- somebody's wedding, with nothing to restore from. R2 has no object versioning and
// no replication.
//
// TWO PATHS, AND EITHER ALONE WOULD LEAVE A HOLE.
//   - The queue (consumeMediaEvents): R2 sends every create and delete in the media bucket to a queue,
//     and this copies a new object within seconds. Fast, but a dropped or dead-lettered event is gone,
//     and nobody sees Workers logs here (observability is off).
//   - The reconcile (reconcileStep): walks both buckets in key order, a page per cron run, and repairs
//     whatever the queue missed. Its first pass is the backfill of everything uploaded before the
//     queue existed; after that it runs daily, and anything it has to copy is reported, because the
//     queue should already have done it.
//
// A DELETION IS NEVER MIRRORED. It writes a tombstone, and pruneBackup removes the copy only once the
// tombstone is GRACE_DAYS old -- long enough to notice a wrong deletion and restore it, short enough
// that a photo someone deleted does not live on indefinitely.
//
// IDEMPOTENT ON PURPOSE. Events repeat, the two paths race each other, and the backup bucket carries a
// lock that refuses to overwrite or delete a young object. So a copy or tombstone that is already
// there is checked for, never rewritten -- a rewrite would be refused, retried and dead-lettered.
//
// No imports at all: worker.ts runs the queue consumer outside the Next handler, and wrangler bundles
// this file for it directly.

/** One object as a listing returns it. */
export type ListedObject = { key: string; size: number; uploaded: Date }

/** The part of an R2 bucket binding the backup uses. A real R2Bucket satisfies it. */
export type BackupBucket = {
  get(key: string): Promise<{
    body: ReadableStream
    size: number
    httpMetadata?: unknown
    customMetadata?: Record<string, string>
  } | null>
  put(
    key: string,
    value: ReadableStream | string,
    options?: { httpMetadata?: unknown; customMetadata?: Record<string, string> },
  ): Promise<{ size: number } | null>
  head(key: string): Promise<{ size: number } | null>
  delete(keys: string | string[]): Promise<void>
  list(options?: { prefix?: string; startAfter?: string; limit?: number }): Promise<{ objects: ListedObject[]; truncated: boolean }>
}

/** A queued R2 event notification, as Cloudflare Queues delivers it. */
export type QueuedMessage = {
  body: unknown
  attempts: number
  ack(): void
  retry(options?: { delaySeconds?: number }): void
}

export type BackupDeps = {
  source: BackupBucket
  backup: BackupBucket
  now: () => Date
  log: (message: string) => void
  /**
   * A pass-through stream of exactly `size` bytes. In the Worker, `new FixedLengthStream(size)`: R2
   * refuses to store a stream whose length it is not told ("Provided readable stream must have a known
   * length", found by the image relay), and it errors if the source sends too many or too few bytes.
   */
  fixedLength: (size: number) => { readable: ReadableStream; writable: WritableStream }
}

export type BackupOutcome = 'copied' | 'already-backed-up' | 'already-gone' | 'tombstoned' | 'ignored' | 'retrying'

/** The queue R2 sends media-bucket events to. wrangler.toml consumes it; a test holds the two together. */
export const MEDIA_EVENTS_QUEUE = 'hushare-media-events'
/** Where a deletion is recorded inside the backup bucket. No media key starts with an underscore. */
export const TOMBSTONE_PREFIX = '_deleted/'
/**
 * How long a deleted object's copy is kept. One day more than the backup bucket's lock (30 days, set
 * with `wrangler r2 bucket lock add`), so a prune never asks to delete something the lock still holds.
 */
export const GRACE_DAYS = 31
/** How long a failed queue copy waits before it is tried again. */
export const RETRY_DELAY_SECONDS = 60
/** Objects per listing page; R2's own maximum. */
export const LIST_PAGE = 1000

const CREATE_ACTIONS: readonly string[] = ['PutObject', 'CopyObject', 'CompleteMultipartUpload']
const DELETE_ACTIONS: readonly string[] = ['DeleteObject', 'LifecycleDeletion']
const DAY_MS = 86_400_000

const describe = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Whether key `a` sorts after key `b` in R2's listing order, which compares UTF-8 bytes. JavaScript's
 * `>` compares UTF-16 units, and the two disagree on characters outside the basic plane.
 */
const encoder = new TextEncoder()
export function keySortsAfter(a: string, b: string): boolean {
  const x = encoder.encode(a)
  const y = encoder.encode(b)
  const n = Math.min(x.length, y.length)
  for (let i = 0; i < n; i++) {
    if (x[i] !== y[i]) return x[i] > y[i]
  }
  return x.length > y.length
}

async function copyInto(deps: BackupDeps, key: string): Promise<'copied' | 'already-backed-up' | 'already-gone'> {
  const original = await deps.source.get(key)
  // Deleted again before this ran: nothing left to copy, and its own delete event records it.
  if (!original) return 'already-gone'
  const existing = await deps.backup.head(key)
  // Every media key ends in a fresh random id, so a key is never reused for different bytes and an
  // equal size means this exact object is already held.
  if (existing && existing.size === original.size) {
    await original.body.cancel()
    return 'already-backed-up'
  }
  const { readable, writable } = deps.fixedLength(original.size)
  const [, copy] = await Promise.all([
    original.body.pipeTo(writable),
    deps.backup.put(key, readable, {
      httpMetadata: original.httpMetadata,
      customMetadata: original.customMetadata,
    }),
  ])
  // A copy that is not the original's size is not a backup.
  if (!copy || copy.size !== original.size) {
    throw new Error(`backup copy of ${key} is ${copy ? copy.size : 'missing'} bytes, the original is ${original.size}`)
  }
  return 'copied'
}

/** Records a deletion, once. Never deletes the copy -- that is what the grace period is for. */
async function tombstone(deps: BackupDeps, key: string): Promise<void> {
  const marker = TOMBSTONE_PREFIX + key
  if (!(await deps.backup.head(marker))) await deps.backup.put(marker, '')
}

/** One event: copy on create, tombstone on delete, and a delayed retry on any failure. */
export async function handleBackupMessage(message: QueuedMessage, deps: BackupDeps): Promise<BackupOutcome> {
  const event = message.body as { action?: unknown; object?: { key?: unknown } } | null
  const key = event?.object?.key
  const action = event?.action
  // A key inside the tombstone namespace would be read back as a deletion record, so it is refused
  // rather than guessed at. None exists: every media key starts with a lowercase folder name.
  if (typeof key !== 'string' || key === '' || key.startsWith(TOMBSTONE_PREFIX) || typeof action !== 'string') {
    deps.log(`[media-backup] ignored an event it cannot back up: ${JSON.stringify(message.body)?.slice(0, 200)}`)
    message.ack()
    return 'ignored'
  }
  try {
    if (CREATE_ACTIONS.includes(action)) {
      const outcome = await copyInto(deps, key)
      message.ack()
      return outcome
    }
    if (DELETE_ACTIONS.includes(action)) {
      await tombstone(deps, key)
      message.ack()
      return 'tombstoned'
    }
    deps.log(`[media-backup] ignored unknown action ${action} for ${key}`)
    message.ack()
    return 'ignored'
  } catch (e) {
    deps.log(`[media-backup] ${action} ${key} failed on attempt ${message.attempts}: ${describe(e)}`)
    message.retry({ delaySeconds: RETRY_DELAY_SECONDS })
    return 'retrying'
  }
}

/** A whole batch, one message at a time -- ten large originals streamed at once is memory for nothing. */
export async function handleBackupBatch(messages: readonly QueuedMessage[], deps: BackupDeps): Promise<Record<BackupOutcome, number>> {
  const tally: Record<BackupOutcome, number> = {
    copied: 0, 'already-backed-up': 0, 'already-gone': 0, tombstoned: 0, ignored: 0, retrying: 0,
  }
  for (const message of messages) tally[await handleBackupMessage(message, deps)]++
  return tally
}

/**
 * The queue consumer worker.ts runs. A batch from any other queue, or with a bucket binding missing,
 * THROWS: every message is then retried, where returning would acknowledge them all unread.
 */
export async function consumeMediaEvents(
  batch: { queue: string; messages: readonly QueuedMessage[] },
  env: { R2_BUCKET?: BackupBucket; R2_BACKUP?: BackupBucket },
  runtime: Pick<BackupDeps, 'now' | 'log' | 'fixedLength'>,
): Promise<Record<BackupOutcome, number>> {
  if (batch.queue !== MEDIA_EVENTS_QUEUE) throw new Error(`no consumer for queue ${batch.queue}`)
  if (!env.R2_BUCKET || !env.R2_BACKUP) throw new Error('media backup: R2_BUCKET or R2_BACKUP binding missing')
  return handleBackupBatch(batch.messages, { source: env.R2_BUCKET, backup: env.R2_BACKUP, ...runtime })
}

export type ReconcileResult = {
  copied: number
  /** Objects the listing said were missing, that the queue copied (or a deletion removed) meanwhile. */
  skipped: number
  tombstoned: number
  /** Copied here although they were uploaded long enough ago that the queue should have done it. */
  missed: string[]
  /** The first object that could not be handled. The walk stops there and resumes from it. */
  failure: { key: string; reason: string } | null
  /** Where the next run starts: after this key. '' once the pass is complete. */
  nextStartAfter: string
  passComplete: boolean
}

/**
 * One run of the walk: the next page of the media bucket, compared against the backup over the same
 * range of keys.
 *
 * NOTHING IS SKIPPED OVER. Positions are keys, not offsets, so deletions during a pass cannot move the
 * walk past an object. A run that stops early -- out of budget, out of time, or at a failure -- resumes
 * from the last object it finished, and a failing object stops the walk rather than being passed, so
 * one that can never be copied is reported on every run instead of being quietly left behind.
 */
export async function reconcileStep(deps: BackupDeps & {
  startAfter: string
  /** The most objects this run may copy. */
  budget: number
  /** An object uploaded longer ago than this should already have been copied by the queue. */
  missedAfterMs: number
  shouldStop: () => boolean
}): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    copied: 0, skipped: 0, tombstoned: 0, missed: [], failure: null, nextStartAfter: deps.startAfter, passComplete: false,
  }
  const page = await deps.source.list({ startAfter: deps.startAfter || undefined, limit: LIST_PAGE })
  const last = page.objects.at(-1)?.key
  // undefined: this page reaches the end of the bucket, so the range does too.
  const rangeEnd = page.truncated ? last : undefined

  // What the backup holds over the same range, by size.
  const held = new Map<string, number>()
  let after = deps.startAfter
  for (;;) {
    const part = await deps.backup.list({ startAfter: after || undefined, limit: LIST_PAGE })
    let beyond = false
    for (const object of part.objects) {
      if (rangeEnd !== undefined && keySortsAfter(object.key, rangeEnd)) { beyond = true; break }
      if (!object.key.startsWith(TOMBSTONE_PREFIX)) held.set(object.key, object.size)
    }
    if (beyond || !part.truncated || part.objects.length === 0) break
    after = part.objects[part.objects.length - 1].key
  }

  const cutoff = deps.now().getTime() - deps.missedAfterMs
  const inSource = new Set(page.objects.map((o) => o.key))
  let finishedThrough = deps.startAfter
  let stoppedEarly = false
  for (const object of page.objects) {
    if (held.get(object.key) !== object.size && !object.key.startsWith(TOMBSTONE_PREFIX)) {
      if (result.copied >= deps.budget || deps.shouldStop()) { stoppedEarly = true; break }
      try {
        if ((await copyInto(deps, object.key)) === 'copied') {
          result.copied++
          if (object.uploaded.getTime() < cutoff) result.missed.push(object.key)
        } else {
          result.skipped++
        }
      } catch (e) {
        result.failure = { key: object.key, reason: describe(e) }
        result.nextStartAfter = finishedThrough
        return result
      }
    }
    finishedThrough = object.key
  }

  // DELETIONS THE QUEUE NEVER RECORDED: held in the backup over this page's range, gone from the media
  // bucket. The page lists that whole range, so this holds even when the copying stopped early.
  const complete = !page.truncated && !stoppedEarly
  for (const key of held.keys()) {
    if (inSource.has(key)) continue
    try {
      // Already recorded -- the usual case, for every deletion still inside its grace period.
      if (await deps.backup.head(TOMBSTONE_PREFIX + key)) continue
      // Uploaded after the listing above and copied by the queue since: live, not deleted.
      if (await deps.source.head(key)) continue
      await deps.backup.put(TOMBSTONE_PREFIX + key, '')
      result.tombstoned++
    } catch (e) {
      // The copies above are already held and will be skipped by size; this range runs again.
      result.failure = { key, reason: describe(e) }
      result.nextStartAfter = deps.startAfter
      return result
    }
  }

  result.passComplete = complete
  result.nextStartAfter = complete ? '' : finishedThrough
  return result
}

/**
 * Removes the copy of an object deleted more than GRACE_DAYS ago, with its tombstone.
 *
 * Errs toward keeping (rule 19): a tombstone with no readable date is left alone, and so is any object
 * whose original could not be checked. An original re-uploaded under the same key since is live again,
 * so only the tombstone goes. The date is the tombstone's own upload time, which is the first time
 * the deletion was recorded, because a tombstone is never rewritten.
 */
export async function pruneBackup(deps: BackupDeps & { limit?: number }): Promise<{ removed: number; kept: number; failed: number }> {
  const cutoff = deps.now().getTime() - GRACE_DAYS * DAY_MS
  const limit = deps.limit ?? LIST_PAGE
  let kept = 0
  // LISTED IN FULL BEFORE ANYTHING IS DELETED, so deleting cannot move the listing under itself.
  const expired: string[] = []
  let after: string | undefined
  listing: for (;;) {
    const page = await deps.backup.list({ prefix: TOMBSTONE_PREFIX, startAfter: after, limit: LIST_PAGE })
    for (const marker of page.objects) {
      if (expired.length + kept >= limit) break listing
      const at = marker.uploaded instanceof Date ? marker.uploaded.getTime() : Number.NaN
      if (!Number.isFinite(at) || at > cutoff) { kept++; continue }
      expired.push(marker.key)
    }
    if (!page.truncated || page.objects.length === 0) break
    after = page.objects[page.objects.length - 1].key
  }

  let removed = 0
  let failed = 0
  for (const marker of expired) {
    const key = marker.slice(TOMBSTONE_PREFIX.length)
    try {
      const live = await deps.source.head(key)
      const doomed = live ? [marker] : [key, marker]
      await deps.backup.delete(doomed)
      // A LOCKED OBJECT IS NOT DELETED, AND THE DELETE STILL SUCCEEDS. Seen on this bucket on 2026-09-14:
      // `wrangler r2 object delete` printed "Delete complete." and the object was still there
      // (MISTAKES 125). So only what is verifiably gone counts as removed.
      for (const k of doomed) {
        if (await deps.backup.head(k)) throw new Error(`${k} is still in the backup after its delete -- locked?`)
      }
      removed++
    } catch (e) {
      failed++
      deps.log(`[media-backup] prune of ${key} failed: ${describe(e)}`)
    }
  }
  return { removed, kept, failed }
}

/** Where the walk is, as stored in system_state. */
export type BackupState = {
  startAfter: string
  passStartedAt: string | null
  lastPassCompletedAt: string | null
  firstPassCompletedAt: string | null
  passCopied: number
  lastPassCopied: number
}

export const BACKUP_STATE_KEY = 'media_backup'
/** After a complete pass, how long before the next one starts. */
export const PASS_INTERVAL_MS = DAY_MS
/** No new copy starts after this long in one run, so a run ends well inside the minute before the next. */
export const RECONCILE_TIME_BUDGET_MS = 25_000
/** The most objects one run copies: about three subrequests each, far under the 10,000 a Worker may make. */
export const RECONCILE_COPY_BUDGET = 200
/** The queue copies an upload within seconds, so one still missing after an hour was missed by it. */
export const QUEUE_WINDOW_MS = 3_600_000

const EMPTY_STATE: BackupState = {
  startAfter: '', passStartedAt: null, lastPassCompletedAt: null, firstPassCompletedAt: null, passCopied: 0, lastPassCopied: 0,
}

/**
 * Reads the stored state. Anything unreadable starts a fresh pass from the first key: that errs toward
 * re-listing the bucket, which costs a few operations, rather than toward believing a pass is done.
 */
export function parseBackupState(value: unknown): BackupState {
  let raw: unknown
  try { raw = typeof value === 'string' ? JSON.parse(value) : null } catch { return { ...EMPTY_STATE } }
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STATE }
  const r = raw as Record<string, unknown>
  const text = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null)
  const count = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0)
  return {
    startAfter: typeof r.startAfter === 'string' ? r.startAfter : '',
    passStartedAt: text(r.passStartedAt),
    lastPassCompletedAt: text(r.lastPassCompletedAt),
    firstPassCompletedAt: text(r.firstPassCompletedAt),
    passCopied: count(r.passCopied),
    lastPassCopied: count(r.lastPassCopied),
  }
}

/**
 * Whether this run should walk. Mid-pass, always. Between passes, once PASS_INTERVAL_MS has gone by --
 * or when the last completion is in the future, because a clock that moved (rule 22) must not be able to
 * postpone the next pass indefinitely.
 */
export function backupRunDue(state: BackupState, nowMs: number): boolean {
  if (state.passStartedAt !== null || state.lastPassCompletedAt === null) return true
  const elapsed = nowMs - Date.parse(state.lastPassCompletedAt)
  return elapsed < 0 || elapsed >= PASS_INTERVAL_MS
}

export function nextBackupState(state: BackupState, step: ReconcileResult, nowIso: string): BackupState {
  const copied = state.passCopied + step.copied
  if (step.passComplete) {
    return {
      startAfter: '',
      passStartedAt: null,
      lastPassCompletedAt: nowIso,
      firstPassCompletedAt: state.firstPassCompletedAt ?? nowIso,
      passCopied: 0,
      lastPassCopied: copied,
    }
  }
  return { ...state, startAfter: step.nextStartAfter, passStartedAt: state.passStartedAt ?? nowIso, passCopied: copied }
}
