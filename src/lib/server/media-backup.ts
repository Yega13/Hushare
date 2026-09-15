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
//   - The reconcile (reconcileStep): walks both buckets in key order, a range per cron run, and repairs
//     whatever the queue missed. Its first pass is the backfill of everything uploaded before the
//     queue existed; after that it runs daily, and anything it has to copy is reported, because the
//     queue should already have done it.
//
// A DELETION IS NEVER MIRRORED. It writes a tombstone, and pruneBackup removes the copy only once the
// tombstone is GRACE_DAYS old -- long enough to notice a wrong deletion and restore it, short enough
// that a photo someone deleted does not live on indefinitely. The prune sweeps on its own schedule
// (PRUNE_INTERVAL_MS), resuming where it stopped, so erasing on time never waits on the walk.
//
// IDEMPOTENT ON PURPOSE. Events repeat, the two paths race each other, and the backup bucket carries a
// lock that refuses to overwrite or delete a young object. So a copy or tombstone that is already
// there is checked for, never rewritten -- a rewrite would be refused, retried and dead-lettered.
//
// EVERY RUN IS METERED (review of 2026-09-14). A Worker may make 10,000 subrequests in one invocation
// and every R2 call counts. The walk used to look up each deleted photo one by one, with no budget, so a
// deleted 10,000-photo album put more calls in one range than a run may make: the run died at the same
// point every minute, the position never moved, the prune never ran, and the failure could not even be
// reported because reporting needs subrequests too. Now every bucket call is counted against
// RECONCILE_OP_BUDGET or PRUNE_OP_BUDGET, room for a whole object is checked before each one, and
// deletion records are found by LISTING them rather than looking each one up.
//
// A KEY IS ONE SET OF BYTES FOREVER. Every media key ends in a fresh random id. A copy held at a
// different size than its original means the key was reused, and that is reported as a conflict and
// never overwritten: once the 30-day lock has expired an overwrite would replace the only backup of the
// old bytes with no grace period at all. Anything that rewrites media in place must mint new keys.
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
  /**
   * Puts a sentence in the admin panel. Optional, because this file cannot import the reporter; the
   * caller passes one when it has a way to deliver it. Must not throw, and is guarded here as if it might.
   */
  report?: (message: string, context: Record<string, string | number>) => Promise<void>
}

export type BackupOutcome = 'copied' | 'already-backed-up' | 'already-gone' | 'tombstoned' | 'ignored' | 'retrying' | 'conflict'

/** The queue R2 sends media-bucket events to. wrangler.toml consumes it; a test holds the two together. */
export const MEDIA_EVENTS_QUEUE = 'hushare-media-events'
/** Where a deletion is recorded inside the backup bucket. No media key starts with an underscore. */
export const TOMBSTONE_PREFIX = '_deleted/'
/**
 * How long a deleted object's copy is kept. One day more than the backup bucket's lock (30 days, set
 * with `wrangler r2 bucket lock add`), so a prune never asks to delete something the lock still holds.
 */
export const GRACE_DAYS = 31
/** Objects per listing page; R2's own maximum. */
export const LIST_PAGE = 1000

/**
 * HOW LONG A FAILED QUEUE COPY WAITS, by attempt. A fixed minute gave up after about six: an outage of
 * the backup bucket longer than that dropped every copy made in it, silently. These cover about 19
 * hours before the last delivery, which is inside a day, so the daily walk is still the next line of
 * defence behind them. 12 hours is the longest single delay; Cloudflare's documentation allows messages
 * to be delayed by up to 24 hours.
 */
export const RETRY_DELAYS_SECONDS = [60, 600, 3_600, 21_600, 43_200] as const
/** wrangler.toml's max_retries for the media events consumer; a test holds the two equal. */
export const QUEUE_MAX_RETRIES = 5

export function retryDelaySeconds(attempts: number): number {
  const index = Number.isInteger(attempts) && attempts >= 1 ? attempts - 1 : 0
  return RETRY_DELAYS_SECONDS[Math.min(index, RETRY_DELAYS_SECONDS.length - 1)]
}

/**
 * The most bucket calls one object can cost: a copy is get, head, put and a head after a refused put;
 * a deletion record is head, head, put and a head after a refused put; a prune is head, delete and two
 * verifying heads.
 */
export const OPS_PER_OBJECT = 4
/**
 * Bucket calls per walk run and per prune sweep run. Together 6,000, under the 10,000 subrequests a
 * Worker may make, with the rest left for the state read, the save and the reports -- and for any
 * accounting of subrequests this code cannot see.
 */
export const RECONCILE_OP_BUDGET = 4_000
export const PRUNE_OP_BUDGET = 2_000
/** The most listing pages one range may read before it is cut short at what it has seen. */
export const MAX_LIST_PAGES = 50

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

type Meter = { used: number; limit: number }

/**
 * A bucket whose every call is counted. Past the limit a call THROWS -- a reported failure of this run,
 * never the platform's subrequest limit, which would take the save and the report down with it.
 */
function metered(bucket: BackupBucket, meter: Meter): BackupBucket {
  const spend = () => {
    if (meter.used >= meter.limit) throw new Error(`this run's budget of ${meter.limit} bucket operations is spent`)
    meter.used++
  }
  return {
    async get(key) { spend(); return bucket.get(key) },
    async put(key, value, options) { spend(); return bucket.put(key, value, options) },
    async head(key) { spend(); return bucket.head(key) },
    async delete(keys) { spend(); return bucket.delete(keys) },
    async list(options) { spend(); return bucket.list(options) },
  }
}

async function copyInto(deps: BackupDeps, key: string): Promise<'copied' | 'already-backed-up' | 'already-gone' | 'conflict'> {
  const original = await deps.source.get(key)
  // Deleted again before this ran: nothing left to copy, and its own delete event records it.
  if (!original) return 'already-gone'
  const existing = await deps.backup.head(key)
  if (existing) {
    await original.body.cancel()
    // An equal size is this exact object, already held (a key is never reused for different bytes).
    // A different size is a REUSED key: never overwritten, because past the lock an overwrite replaces
    // the only copy of the old bytes. Reported by the walk instead.
    return existing.size === original.size ? 'already-backed-up' : 'conflict'
  }
  const { readable, writable } = deps.fixedLength(original.size)
  let copy: { size: number } | null
  try {
    ;[, copy] = await Promise.all([
      original.body.pipeTo(writable),
      deps.backup.put(key, readable, {
        httpMetadata: original.httpMetadata,
        customMetadata: original.customMetadata,
      }),
    ])
  } catch (e) {
    // THE OTHER PATH MAY HAVE WON THE RACE. The queue and the walk copy the same new object at the same
    // moment; the lock refuses the second write. What the backup now holds decides whether that was a
    // failure at all.
    const held = await deps.backup.head(key)
    if (held && held.size === original.size) return 'already-backed-up'
    if (held) return 'conflict'
    throw e
  }
  // A copy that is not the original's size is not a backup.
  if (!copy || copy.size !== original.size) {
    throw new Error(`backup copy of ${key} is ${copy ? copy.size : 'missing'} bytes, the original is ${original.size}`)
  }
  return 'copied'
}

/** Records a deletion, once. Never deletes the copy -- that is what the grace period is for. */
async function tombstone(deps: BackupDeps, key: string): Promise<void> {
  const marker = TOMBSTONE_PREFIX + key
  if (await deps.backup.head(marker)) return
  try {
    await deps.backup.put(marker, '')
  } catch (e) {
    // Written a moment ago by the other path, and the lock refused this second write of the same record.
    if (await deps.backup.head(marker)) return
    throw e
  }
}

/** One event: copy on create, tombstone on delete, and a growing, delayed retry on any failure. */
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
      // Retrying a conflict cannot succeed for up to 30 days; the walk reports it to the panel.
      if (outcome === 'conflict') deps.log(`[media-backup] ${key} is already held at a different size -- a reused key, not overwritten`)
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
    const delaySeconds = retryDelaySeconds(message.attempts)
    deps.log(`[media-backup] ${action} ${key} failed on attempt ${message.attempts}, retrying in ${delaySeconds}s: ${describe(e)}`)
    // Retried even on the last attempt, so a dead-letter queue added later receives it.
    message.retry({ delaySeconds })
    // THE LAST TRIES ARE REPORTED, at >= rather than one exact attempt: if the platform counts attempts
    // differently than expected, this can only report early, never not at all.
    if (message.attempts >= QUEUE_MAX_RETRIES && deps.report) {
      try {
        await deps.report('Backup queue is giving up on an object', {
          key, action, attempts: message.attempts, reason: describe(e).slice(0, 300),
        })
      } catch (err) {
        deps.log(`[media-backup] could not report the failed ${action} of ${key}: ${describe(err)}`)
      }
    }
    return 'retrying'
  }
}

/** A whole batch, one message at a time -- ten large originals streamed at once is memory for nothing. */
export async function handleBackupBatch(messages: readonly QueuedMessage[], deps: BackupDeps): Promise<Record<BackupOutcome, number>> {
  const tally: Record<BackupOutcome, number> = {
    copied: 0, 'already-backed-up': 0, 'already-gone': 0, tombstoned: 0, ignored: 0, retrying: 0, conflict: 0,
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
  runtime: Pick<BackupDeps, 'now' | 'log' | 'fixedLength' | 'report'>,
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
  /** Held in the backup at a different size than the original: a reused key, left as it is. */
  conflicts: string[]
  /** The first object that could not be handled. The walk stops there and resumes from it. */
  failure: { key: string; reason: string } | null
  /** Where the next run starts: after this key. '' once the pass is complete. */
  nextStartAfter: string
  passComplete: boolean
  /** Bucket operations this run made. */
  ops: number
}

/**
 * Lists one bucket from `startAfter` up to `end`, at most MAX_LIST_PAGES pages. Keys come back with the
 * prefix removed. `complete: false` means it stopped short, and `through` is the last key it saw.
 *
 * A LISTING THAT GOES BACKWARDS THROWS. How R2 treats startAfter together with a prefix was not verified
 * against the real service, so a key that does not sort after the position is a loud failure rather
 * than a walk that quietly repeats a range forever.
 */
async function listRange(
  bucket: BackupBucket, prefix: string, startAfter: string, end: string | undefined, meter: Meter, shouldStop: () => boolean,
): Promise<{ objects: ListedObject[]; complete: boolean; through: string }> {
  const objects: ListedObject[] = []
  let after = startAfter
  let pages = 0
  for (;;) {
    if (pages >= MAX_LIST_PAGES || meter.used + 1 > meter.limit || shouldStop()) return { objects, complete: false, through: after }
    const part = await bucket.list({
      prefix: prefix || undefined,
      startAfter: after ? prefix + after : undefined,
      limit: LIST_PAGE,
    })
    pages++
    for (const listed of part.objects) {
      const key = listed.key.slice(prefix.length)
      if (after && !keySortsAfter(key, after)) {
        throw new Error(`the listing of ${prefix || 'the bucket'} went backwards: ${listed.key} after ${after}`)
      }
      if (end !== undefined && keySortsAfter(key, end)) return { objects, complete: true, through: end }
      objects.push({ key, size: listed.size, uploaded: listed.uploaded })
      after = key
    }
    if (!part.truncated || part.objects.length === 0) return { objects, complete: true, through: end ?? after }
  }
}

/**
 * One run of the walk: the next page of the media bucket, compared against the backup over the same
 * range of keys.
 *
 * NOTHING IS SKIPPED OVER. Positions are keys, not offsets, so deletions during a pass cannot move the
 * walk past an object. A run that stops early -- out of budget, out of time, or at a failure -- resumes
 * from the last object it finished, and a failing object stops the walk rather than being passed, so
 * one that can never be copied is reported on every run instead of being quietly left behind.
 *
 * EVERY RUN MOVES FORWARD. When the backup's listing of a range cannot be finished inside the run, the
 * range is cut short at what was listed rather than stepped past, and the next run starts there.
 */
export async function reconcileStep(deps: BackupDeps & {
  startAfter: string
  /** The most objects this run may copy. */
  budget: number
  /** The most bucket operations this run may make. */
  opBudget: number
  /** An object uploaded longer ago than this should already have been copied by the queue. */
  missedAfterMs: number
  shouldStop: () => boolean
}): Promise<ReconcileResult> {
  const meter: Meter = { used: 0, limit: deps.opBudget }
  const source = metered(deps.source, meter)
  const backup = metered(deps.backup, meter)
  const run: BackupDeps = { ...deps, source, backup }
  const result: ReconcileResult = {
    copied: 0, skipped: 0, tombstoned: 0, missed: [], conflicts: [], failure: null,
    nextStartAfter: deps.startAfter, passComplete: false, ops: 0,
  }
  const finish = () => { result.ops = meter.used; return result }

  const page = await source.list({ startAfter: deps.startAfter || undefined, limit: LIST_PAGE })
  // undefined: this page reaches the end of the bucket, so the range does too.
  let end: string | undefined = page.truncated ? page.objects.at(-1)?.key : undefined

  // What the backup holds over the same range. If that listing cannot be finished, the range ends where
  // it stopped: comparing past it would read every copy beyond as deleted.
  const held = await listRange(backup, '', deps.startAfter, end, meter, deps.shouldStop)
  if (!held.complete) end = held.through
  // Deletion records over the same range, by LISTING -- one call per thousand, where a head per copy was
  // one call per photo. A record this listing missed only costs a head below, so it never shortens the range.
  const recorded = await listRange(backup, TOMBSTONE_PREFIX, deps.startAfter, end, meter, deps.shouldStop)
  const tombstoned = new Set(recorded.objects.map((o) => o.key))

  const within = (key: string) => end === undefined || !keySortsAfter(key, end)
  const inSource = new Map(page.objects.filter((o) => within(o.key)).map((o) => [o.key, o]))
  // Deletion records sit in this listing too; the loop below passes over them, and over any source key in
  // their namespace, in one place.
  const heldSize = new Map(held.objects.filter((o) => within(o.key)).map((o) => [o.key, o.size]))
  const keys = [...new Set([...inSource.keys(), ...heldSize.keys()])]
    .sort((a, b) => (a === b ? 0 : keySortsAfter(a, b) ? 1 : -1))

  const cutoff = deps.now().getTime() - deps.missedAfterMs
  let finishedThrough = deps.startAfter
  let stoppedEarly = false
  for (const key of keys) {
    if (key.startsWith(TOMBSTONE_PREFIX)) { finishedThrough = key; continue }
    const listed = inSource.get(key)
    if (listed) {
      if (heldSize.get(key) !== listed.size) {
        if (result.copied >= deps.budget || meter.used + OPS_PER_OBJECT > meter.limit || deps.shouldStop()) { stoppedEarly = true; break }
        try {
          const outcome = await copyInto(run, key)
          if (outcome === 'copied') {
            result.copied++
            if (listed.uploaded.getTime() < cutoff) result.missed.push(key)
          } else if (outcome === 'conflict') {
            result.conflicts.push(key)
          } else {
            result.skipped++
          }
        } catch (e) {
          result.failure = { key, reason: describe(e) }
          result.nextStartAfter = finishedThrough
          return finish()
        }
      }
      finishedThrough = key
      continue
    }

    // HELD IN THE BACKUP, GONE FROM THE MEDIA BUCKET: a deletion, unless it is already recorded.
    if (tombstoned.has(key)) { finishedThrough = key; continue }
    if (meter.used + OPS_PER_OBJECT > meter.limit || deps.shouldStop()) { stoppedEarly = true; break }
    try {
      const marker = TOMBSTONE_PREFIX + key
      // Recorded after the listing above -- by the queue, a moment ago.
      if (await backup.head(marker)) { finishedThrough = key; continue }
      // Uploaded after the source listing and copied by the queue since: live, not deleted.
      if (await source.head(key)) { finishedThrough = key; continue }
      try {
        await backup.put(marker, '')
        result.tombstoned++
      } catch (e) {
        // The queue wrote the same record in between, and the lock refused this second write.
        if (!(await backup.head(marker))) throw e
      }
    } catch (e) {
      result.failure = { key, reason: describe(e) }
      result.nextStartAfter = finishedThrough
      return finish()
    }
    finishedThrough = key
  }

  if (stoppedEarly) {
    result.nextStartAfter = finishedThrough
    result.passComplete = false
  } else {
    // The whole range is handled, so the next run starts after its END, not after the last key handled:
    // a range that held nothing still moves the walk forward.
    result.nextStartAfter = end ?? ''
    result.passComplete = end === undefined
  }
  return finish()
}

export type PruneResult = {
  removed: number
  kept: number
  failed: number
  ops: number
  /** Where the next sweep run starts: after this tombstone key. '' once the sweep is complete. */
  nextStartAfter: string
  sweepComplete: boolean
}

/**
 * Removes the copy of an object deleted more than GRACE_DAYS ago, with its tombstone -- one resumable
 * sweep over the tombstones, a page at a time.
 *
 * Errs toward keeping (rule 19): a tombstone with no readable date is left alone, and so is any object
 * whose original could not be checked. An original re-uploaded under the same key since is live again,
 * so only the tombstone goes. The date is the tombstone's own upload time, which is the first time
 * the deletion was recorded, because a tombstone is never rewritten.
 *
 * A YOUNG TOMBSTONE COSTS NOTHING. The first version stopped after a thousand tombstones counting the
 * young ones it kept, and always started from the first key, so expired ones sorting after a large
 * recent deletion waited weeks. Now only expired ones spend the budget, and the sweep resumes from its
 * saved position until it reaches the end.
 *
 * Deleting behind a key-based position cannot move it, so each page is acted on as it is read.
 */
export async function pruneBackup(deps: BackupDeps & {
  startAfter: string
  opBudget: number
  shouldStop: () => boolean
}): Promise<PruneResult> {
  const meter: Meter = { used: 0, limit: deps.opBudget }
  const source = metered(deps.source, meter)
  const backup = metered(deps.backup, meter)
  const cutoff = deps.now().getTime() - GRACE_DAYS * DAY_MS
  let removed = 0
  let kept = 0
  let failed = 0
  let after = deps.startAfter
  const finish = (complete: boolean): PruneResult => ({
    removed, kept, failed, ops: meter.used, nextStartAfter: complete ? '' : after, sweepComplete: complete,
  })

  for (;;) {
    if (meter.used + 1 > meter.limit || deps.shouldStop()) return finish(false)
    const page = await backup.list({ prefix: TOMBSTONE_PREFIX, startAfter: after || undefined, limit: LIST_PAGE })
    for (const marker of page.objects) {
      const at = marker.uploaded instanceof Date ? marker.uploaded.getTime() : Number.NaN
      if (!Number.isFinite(at) || at > cutoff) {
        kept++
        after = marker.key
        continue
      }
      if (meter.used + OPS_PER_OBJECT > meter.limit || deps.shouldStop()) return finish(false)
      const key = marker.key.slice(TOMBSTONE_PREFIX.length)
      try {
        const live = await source.head(key)
        const doomed = live ? [marker.key] : [key, marker.key]
        await backup.delete(doomed)
        // A LOCKED OBJECT IS NOT DELETED, AND THE DELETE STILL SUCCEEDS. Seen on this bucket on 2026-09-14:
        // `wrangler r2 object delete` printed "Delete complete." and the object was still there
        // (MISTAKES 125). So only what is verifiably gone counts as removed.
        for (const k of doomed) {
          if (await backup.head(k)) throw new Error(`${k} is still in the backup after its delete -- locked?`)
        }
        removed++
      } catch (e) {
        // Left for the next sweep; one stubborn object never holds the sweep in place.
        failed++
        deps.log(`[media-backup] prune of ${key} failed: ${describe(e)}`)
      }
      after = marker.key
    }
    if (!page.truncated || page.objects.length === 0) return finish(true)
  }
}

/** Where the walk and the prune sweep are, as stored in system_state. */
export type BackupState = {
  startAfter: string
  passStartedAt: string | null
  lastPassCompletedAt: string | null
  firstPassCompletedAt: string | null
  passCopied: number
  lastPassCopied: number
  /** Where an unfinished prune sweep resumes: a tombstone key, or '' between sweeps. */
  pruneStartAfter: string
  lastPruneCompletedAt: string | null
}

export const BACKUP_STATE_KEY = 'media_backup'
/** After a complete pass, how long before the next one starts. */
export const PASS_INTERVAL_MS = DAY_MS
/**
 * After a complete prune sweep, how long before the next. Short enough that a copy past its grace
 * period is erased within hours of it, and one sweep costs a few listings when nothing has expired.
 */
export const PRUNE_INTERVAL_MS = 6 * 3_600_000
/** No new copy starts after this long in one run, so a run ends well inside the minute before the next. */
export const RECONCILE_TIME_BUDGET_MS = 25_000
/** No new prune starts after this long from the start of the run, leaving the rest of it to the walk. */
export const PRUNE_TIME_BUDGET_MS = 10_000
/** The most objects one run copies. */
export const RECONCILE_COPY_BUDGET = 200
/** The queue copies an upload within seconds, so one still missing after an hour was missed by it. */
export const QUEUE_WINDOW_MS = 3_600_000

const EMPTY_STATE: BackupState = {
  startAfter: '', passStartedAt: null, lastPassCompletedAt: null, firstPassCompletedAt: null, passCopied: 0, lastPassCopied: 0,
  pruneStartAfter: '', lastPruneCompletedAt: null,
}

/**
 * Reads the stored state. Anything unreadable starts a fresh pass from the first key: that errs toward
 * re-listing the bucket, which costs a few operations, rather than toward believing a pass is done.
 * A prune position that is not a tombstone key is not believed either -- the sweep starts over.
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
    pruneStartAfter: typeof r.pruneStartAfter === 'string' && r.pruneStartAfter.startsWith(TOMBSTONE_PREFIX) ? r.pruneStartAfter : '',
    lastPruneCompletedAt: text(r.lastPruneCompletedAt),
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

/** Whether this run should sweep: mid-sweep always, otherwise PRUNE_INTERVAL_MS after the last. Rule 22 as above. */
export function pruneRunDue(state: BackupState, nowMs: number): boolean {
  if (state.pruneStartAfter !== '' || state.lastPruneCompletedAt === null) return true
  const elapsed = nowMs - Date.parse(state.lastPruneCompletedAt)
  return elapsed < 0 || elapsed >= PRUNE_INTERVAL_MS
}

export function nextBackupState(state: BackupState, step: ReconcileResult, nowIso: string): BackupState {
  const copied = state.passCopied + step.copied
  if (step.passComplete) {
    return {
      // Everything the walk does not own -- the prune sweep's position -- carries over untouched.
      ...state,
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

export function nextPruneState(state: BackupState, sweep: Pick<PruneResult, 'nextStartAfter' | 'sweepComplete'>, nowIso: string): BackupState {
  return sweep.sweepComplete
    ? { ...state, pruneStartAfter: '', lastPruneCompletedAt: nowIso }
    : { ...state, pruneStartAfter: sweep.nextStartAfter }
}
