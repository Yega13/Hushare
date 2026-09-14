import { describe, it, expect } from 'vitest'
import {
  handleBackupMessage, handleBackupBatch, consumeMediaEvents, reconcileStep, pruneBackup, keySortsAfter,
  parseBackupState, backupRunDue, nextBackupState,
  TOMBSTONE_PREFIX, GRACE_DAYS, RETRY_DELAY_SECONDS, MEDIA_EVENTS_QUEUE, LIST_PAGE, BACKUP_STATE_KEY, PASS_INTERVAL_MS,
  RECONCILE_COPY_BUDGET, RECONCILE_TIME_BUDGET_MS, QUEUE_WINDOW_MS,
  type BackupBucket, type BackupDeps, type QueuedMessage, type ReconcileResult, type BackupState,
} from '@/lib/server/media-backup'

// THE SECOND COPY OF EVERY PHOTO. Every failure here is silent until the day the backup is needed: a
// copy that never happened, a deletion mirrored into the backup, a grace period that deletes early, a
// walk that steps over an object, or a prune that reads a photo as a deletion record.
//
// The buckets are in-memory fakes that behave like R2 where it matters: listings in key order with
// startAfter, streamed bodies with a length, and a lock that refuses to overwrite an existing object.
// Numbers are written as numbers (rule 17).

const NOW = new Date('2026-09-14T12:00:00.000Z')
const HOUR = 3_600_000
const DAY = 86_400_000
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const enc = new TextEncoder()

type Obj = { body: string; uploaded: Date; httpMetadata?: unknown; customMetadata?: Record<string, string> }
type Seed = { body: string; uploaded?: Date; httpMetadata?: unknown; customMetadata?: Record<string, string> }
type Opts = {
  locked?: boolean
  failPut?: (key: string) => boolean
  putSize?: number
  failHead?: (key: string) => boolean
  pageSize?: number
  hideFromList?: Set<string>
  short?: Set<string>
  /** What the real lock does to a delete: nothing, and no error either (seen 2026-09-14). */
  ignoreDelete?: (key: string) => boolean
}

function fakeBucket(initial: Record<string, Seed> = {}, opts: Opts = {}) {
  const store = new Map<string, Obj>()
  for (const [k, v] of Object.entries(initial)) store.set(k, { uploaded: NOW, ...v })
  const calls = { puts: [] as string[], deletes: [] as string[], lists: 0, heads: 0, cancelled: [] as string[] }
  const bucket: BackupBucket = {
    async get(key) {
      const o = store.get(key)
      if (!o) return null
      const bytes = enc.encode(opts.short?.has(key) ? o.body.slice(0, -1) : o.body)
      const body = new ReadableStream<Uint8Array>({
        pull(c) { c.enqueue(bytes); c.close() },
        cancel() { calls.cancelled.push(key) },
      }, { highWaterMark: 0 })
      return { body, size: enc.encode(o.body).length, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata }
    },
    async put(key, value, options) {
      if (opts.failPut?.(key)) throw new Error('R2 put failed')
      // THE LOCK: an object that is already there cannot be overwritten.
      if (opts.locked && store.has(key)) throw new Error(`object ${key} is locked`)
      const text = typeof value === 'string' ? value : await new Response(value).text()
      store.set(key, { body: text, uploaded: NOW, httpMetadata: options?.httpMetadata, customMetadata: options?.customMetadata })
      calls.puts.push(key)
      return { size: opts.putSize ?? enc.encode(text).length }
    },
    async head(key) {
      calls.heads++
      if (opts.failHead?.(key)) throw new Error('R2 head failed')
      const o = store.get(key)
      return o ? { size: enc.encode(o.body).length } : null
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        calls.deletes.push(k)
        if (!opts.ignoreDelete?.(k)) store.delete(k)
      }
    },
    async list(options) {
      calls.lists++
      // Never verified against R2, so never sent: the code passes undefined for "from the start".
      if (options?.startAfter === '') throw new Error('startAfter "" sent to R2')
      const prefix = options?.prefix ?? ''
      const after = options?.startAfter
      const keys = [...store.keys()]
        .filter((k) => k.startsWith(prefix) && !opts.hideFromList?.has(k) && (after === undefined || k > after))
        .sort()
      const limit = Math.min(options?.limit ?? 1000, opts.pageSize ?? 1000)
      return {
        objects: keys.slice(0, limit).map((k) => ({ key: k, size: enc.encode(store.get(k)!.body).length, uploaded: store.get(k)!.uploaded })),
        truncated: keys.length > limit,
      }
    },
  }
  return { bucket, store, calls }
}

/** Stands in for FixedLengthStream: passes bytes through and errors on too many or too few. */
function fixedLengthFake(size: number, sizes: number[]) {
  sizes.push(size)
  let seen = 0
  const t = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, c) {
      seen += chunk.byteLength
      if (seen > size) c.error(new Error('too many bytes'))
      else c.enqueue(chunk)
    },
    flush(c) { if (seen !== size) c.error(new Error(`expected ${size} bytes, got ${seen}`)) },
  })
  return { readable: t.readable as ReadableStream, writable: t.writable as WritableStream }
}

function rig(source: Record<string, Seed> = {}, backup: Record<string, Seed> = {}, srcOpts: Opts = {}, bakOpts: Opts = {}) {
  const src = fakeBucket(source, srcOpts)
  const bak = fakeBucket(backup, { locked: true, ...bakOpts })
  const logs: string[] = []
  const sizes: number[] = []
  const deps: BackupDeps = {
    source: src.bucket, backup: bak.bucket, now: () => NOW,
    log: (l) => { logs.push(l) },
    fixedLength: (n) => fixedLengthFake(n, sizes),
  }
  return { src, bak, logs, sizes, deps }
}

function message(body: unknown, attempts = 1) {
  const state = { acked: false, retried: undefined as undefined | { delaySeconds?: number } }
  const m: QueuedMessage = {
    body, attempts,
    ack() { state.acked = true },
    retry(options) { state.retried = options ?? {} },
  }
  return Object.assign(m, { state })
}

const event = (action: string, key: string) => ({ action, bucket: 'hushare-media', object: { key, size: 5, eTag: 'x' }, eventTime: NOW.toISOString() })
const photo: Seed = { body: 'JPEG!', httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { album: 'a1' } }

describe('the queue -- a new object', () => {
  it('copies its bytes, content type and metadata through a stream of its exact length, and acknowledges', async () => {
    const r = rig({ 'albums/a1/p.jpg': photo })
    const m = message(event('PutObject', 'albums/a1/p.jpg'))
    expect(await handleBackupMessage(m, r.deps)).toBe('copied')
    const copy = r.bak.store.get('albums/a1/p.jpg')
    expect([copy?.body, copy?.httpMetadata, copy?.customMetadata]).toEqual(['JPEG!', { contentType: 'image/jpeg' }, { album: 'a1' }])
    expect(r.sizes).toEqual([5])
    expect(m.state.acked).toBe(true)
  })

  it('treats a copy and a completed multipart upload as new objects too', async () => {
    for (const action of ['CopyObject', 'CompleteMultipartUpload']) {
      const r = rig({ 'albums/a1/big.jpg': photo })
      expect(await handleBackupMessage(message(event(action, 'albums/a1/big.jpg')), r.deps), action).toBe('copied')
      expect(r.bak.store.has('albums/a1/big.jpg'), action).toBe(true)
    }
  })

  it('A REPEATED EVENT does not write again, and does not download the object -- the lock would refuse the write', async () => {
    const r = rig({ 'albums/a1/p.jpg': photo }, { 'albums/a1/p.jpg': photo })
    const m = message(event('PutObject', 'albums/a1/p.jpg'))
    expect(await handleBackupMessage(m, r.deps)).toBe('already-backed-up')
    expect(r.bak.calls.puts).toEqual([])
    expect(r.src.calls.cancelled).toEqual(['albums/a1/p.jpg'])
    expect(m.state.acked).toBe(true)
  })

  it('an object deleted before it could be copied is acknowledged, with nothing written', async () => {
    const r = rig()
    const m = message(event('PutObject', 'albums/a1/gone.jpg'))
    expect(await handleBackupMessage(m, r.deps)).toBe('already-gone')
    expect(r.bak.calls.puts).toEqual([])
    expect(m.state.acked).toBe(true)
  })

  it('A SOURCE THAT ENDS EARLY is not stored as a backup: retried in 60 seconds, not acknowledged', async () => {
    const r = rig({ 'albums/a1/p.jpg': photo }, {}, { short: new Set(['albums/a1/p.jpg']) })
    const m = message(event('PutObject', 'albums/a1/p.jpg'))
    expect(await handleBackupMessage(m, r.deps)).toBe('retrying')
    expect(r.bak.store.has('albums/a1/p.jpg')).toBe(false)
    expect(m.state.acked).toBe(false)
    expect(m.state.retried).toEqual({ delaySeconds: 60 })
  })

  it('A COPY THAT IS NOT THE ORIGINAL SIZE is not a backup: retried, and the attempt is logged', async () => {
    const r = rig({ 'albums/a1/p.jpg': photo }, {}, {}, { putSize: 2 })
    const m = message(event('PutObject', 'albums/a1/p.jpg'), 3)
    expect(await handleBackupMessage(m, r.deps)).toBe('retrying')
    expect(m.state.acked).toBe(false)
    expect(m.state.retried).toEqual({ delaySeconds: 60 })
    expect(r.logs.join(' ')).toContain('attempt 3')
  })

  it('a failed write is retried in 60 seconds, not acknowledged', async () => {
    const r = rig({ 'albums/a1/p.jpg': photo }, {}, {}, { failPut: () => true })
    const m = message(event('PutObject', 'albums/a1/p.jpg'))
    expect(await handleBackupMessage(m, r.deps)).toBe('retrying')
    expect(m.state.acked).toBe(false)
    expect(m.state.retried).toEqual({ delaySeconds: 60 })
  })
})

describe('the queue -- a deleted object', () => {
  it('NEVER DELETES THE COPY: it writes an empty tombstone, and acknowledges', async () => {
    for (const action of ['DeleteObject', 'LifecycleDeletion']) {
      const r = rig({}, { 'albums/a1/p.jpg': photo })
      const m = message(event(action, 'albums/a1/p.jpg'))
      expect(await handleBackupMessage(m, r.deps), action).toBe('tombstoned')
      expect(r.bak.store.get('albums/a1/p.jpg')?.body, `${action} removed the copy`).toBe('JPEG!')
      expect(r.bak.store.get('_deleted/albums/a1/p.jpg')?.body).toBe('')
      expect(r.bak.calls.deletes).toEqual([])
      expect(m.state.acked).toBe(true)
    }
  })

  it('a repeated delete does not rewrite the tombstone -- that would move the grace period, or meet the lock', async () => {
    const r = rig({}, { '_deleted/albums/a1/p.jpg': { body: '', uploaded: ago(5 * DAY) } })
    const m = message(event('DeleteObject', 'albums/a1/p.jpg'))
    expect(await handleBackupMessage(m, r.deps)).toBe('tombstoned')
    expect(r.bak.calls.puts).toEqual([])
    expect(r.bak.store.get('_deleted/albums/a1/p.jpg')?.uploaded).toEqual(ago(5 * DAY))
    expect(m.state.acked).toBe(true)
  })

  it('a tombstone that could not be written is retried', async () => {
    const r = rig({}, {}, {}, { failPut: () => true })
    const m = message(event('DeleteObject', 'albums/a1/p.jpg'))
    expect(await handleBackupMessage(m, r.deps)).toBe('retrying')
    expect(m.state.retried).toEqual({ delaySeconds: 60 })
  })
})

describe('the queue -- events it cannot use', () => {
  it('no key, no action, an empty key, or a key inside the tombstone namespace: acknowledged and logged, never retried', async () => {
    const bodies = [null, {}, { action: 'PutObject' }, { object: { key: 'x' } }, event('PutObject', ''), event('PutObject', '_deleted/albums/a/p.jpg')]
    for (const body of bodies) {
      const r = rig({ '_deleted/albums/a/p.jpg': photo })
      const m = message(body)
      expect(await handleBackupMessage(m, r.deps), JSON.stringify(body)).toBe('ignored')
      expect(m.state.acked).toBe(true)
      expect(m.state.retried).toBeUndefined()
      expect(r.bak.calls.puts).toEqual([])
      expect(r.logs).toHaveLength(1)
    }
  })

  it('an action it does not know is acknowledged and logged', async () => {
    const r = rig({ k: photo })
    const m = message(event('RestoreObject', 'k'))
    expect(await handleBackupMessage(m, r.deps)).toBe('ignored')
    expect(m.state.acked).toBe(true)
    expect(r.bak.calls.puts).toEqual([])
    expect(r.logs).toHaveLength(1)
  })
})

describe('handleBackupBatch', () => {
  it('handles every message, and one failure does not stop the rest', async () => {
    let calls = 0
    const r = rig({ a: photo, b: photo }, {}, {}, { failPut: () => calls++ === 0 })
    const tally = await handleBackupBatch([message(event('PutObject', 'a')), message(event('PutObject', 'b')), message(event('DeleteObject', 'c'))], r.deps)
    expect(tally).toEqual({ copied: 1, 'already-backed-up': 0, 'already-gone': 0, tombstoned: 1, ignored: 0, retrying: 1 })
  })
})

describe('consumeMediaEvents -- what worker.ts runs', () => {
  const runtime = (r: ReturnType<typeof rig>) => ({ now: r.deps.now, log: r.deps.log, fixedLength: r.deps.fixedLength })

  it('copies FROM the media bucket INTO the backup, never the other way', async () => {
    const r = rig({ 'albums/a/p.jpg': photo })
    const m = message(event('PutObject', 'albums/a/p.jpg'))
    await consumeMediaEvents({ queue: 'hushare-media-events', messages: [m] }, { R2_BUCKET: r.src.bucket, R2_BACKUP: r.bak.bucket }, runtime(r))
    expect(r.bak.store.get('albums/a/p.jpg')?.body).toBe('JPEG!')
    expect(m.state.acked).toBe(true)
  })

  it('A BATCH FROM ANOTHER QUEUE THROWS, so its messages are retried rather than acknowledged unread', async () => {
    const r = rig({ k: photo })
    const m = message(event('PutObject', 'k'))
    await expect(consumeMediaEvents({ queue: 'something-else', messages: [m] }, { R2_BUCKET: r.src.bucket, R2_BACKUP: r.bak.bucket }, runtime(r)))
      .rejects.toThrow('no consumer for queue something-else')
    expect(m.state.acked).toBe(false)
  })

  it('a missing binding throws rather than dropping the batch', async () => {
    const r = rig({ k: photo })
    for (const env of [{ R2_BUCKET: r.src.bucket }, { R2_BACKUP: r.bak.bucket }]) {
      const m = message(event('PutObject', 'k'))
      await expect(consumeMediaEvents({ queue: MEDIA_EVENTS_QUEUE, messages: [m] }, env, runtime(r))).rejects.toThrow('binding missing')
      expect(m.state.acked).toBe(false)
    }
  })

  it('the queue is named hushare-media-events', () => {
    expect(MEDIA_EVENTS_QUEUE).toBe('hushare-media-events')
  })
})

describe('keySortsAfter -- R2 lists keys in UTF-8 byte order', () => {
  it('orders plain keys, and a key after its own prefix', () => {
    expect(keySortsAfter('albums/b', 'albums/a')).toBe(true)
    expect(keySortsAfter('albums/a', 'albums/b')).toBe(false)
    expect(keySortsAfter('albums/a', 'albums/a')).toBe(false)
    expect(keySortsAfter('albums/ab', 'albums/a')).toBe(true)
    expect(keySortsAfter('albums/a', 'albums/ab')).toBe(false)
  })

  it('agrees with UTF-8 where JavaScript string order does not', () => {
    const astral = String.fromCodePoint(0x10000)
    const high = String.fromCharCode(0xffff)
    expect(astral > high).toBe(false)
    expect(keySortsAfter(astral, high)).toBe(true)
  })
})

describe('reconcileStep -- the walk that repairs what the queue missed', () => {
  const walk = (r: ReturnType<typeof rig>, over: Partial<Parameters<typeof reconcileStep>[0]> = {}) =>
    reconcileStep({ ...r.deps, startAfter: '', budget: 100, missedAfterMs: HOUR, shouldStop: () => false, ...over })

  it('lists a page of 1000', () => {
    expect(LIST_PAGE).toBe(1000)
  })

  it('THE BACKFILL: copies what the backup lacks, a budget at a time, and resumes where it stopped', async () => {
    const r = rig({ a: photo, b: photo, c: photo, d: photo }, { b: photo })
    // a and c are copied (b is already held), so the run resumes after c.
    const first = await walk(r, { budget: 2 })
    expect(first).toEqual<ReconcileResult>({ copied: 2, skipped: 0, tombstoned: 0, missed: [], failure: null, nextStartAfter: 'c', passComplete: false })
    const second = await walk(r, { startAfter: first.nextStartAfter, budget: 2 })
    expect(second).toEqual<ReconcileResult>({ copied: 1, skipped: 0, tombstoned: 0, missed: [], failure: null, nextStartAfter: '', passComplete: true })
    expect([...r.bak.store.keys()].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('walks page by page across the whole bucket', async () => {
    const seed: Record<string, Seed> = {}
    for (const k of ['a', 'b', 'c', 'd', 'e']) seed[k] = photo
    const r = rig(seed, {}, { pageSize: 2 }, { pageSize: 2 })
    let startAfter = ''
    let runs = 0
    // Bounded: a walk that never advances must fail this test, not hang it.
    while (runs < 10) {
      const step = await walk(r, { startAfter })
      runs++
      if (step.passComplete) break
      startAfter = step.nextStartAfter
    }
    expect(runs).toBe(3)
    expect([...r.bak.store.keys()].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('A DELETION DURING THE PASS DOES NOT MOVE THE WALK PAST AN OBJECT', async () => {
    const r = rig({ a: photo, b: photo, c: photo, d: photo, e: photo }, {}, { pageSize: 2 }, { pageSize: 2 })
    const first = await walk(r)
    expect(first.nextStartAfter).toBe('b')
    // An offset-based position would now point at e: two of the objects before it are gone.
    r.src.store.delete('a')
    r.src.store.delete('c')
    const second = await walk(r, { startAfter: first.nextStartAfter })
    expect(second).toMatchObject({ copied: 2, passComplete: true })
    expect(r.bak.store.has('d')).toBe(true)
    expect(r.bak.store.has('e')).toBe(true)
  })

  it('lists the backup only as far as the page it is comparing, not the whole bucket every run', async () => {
    const seed: Record<string, Seed> = {}
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) seed[k] = photo
    const r = rig(seed, seed, { pageSize: 2 }, { pageSize: 2 })
    const step = await walk(r)
    expect(step).toMatchObject({ copied: 0, tombstoned: 0, nextStartAfter: 'b', passComplete: false })
    expect(r.bak.calls.lists).toBe(2)
    // And an object present in both is not looked up one by one as a possible deletion.
    expect(r.src.calls.heads + r.bak.calls.heads).toBe(0)
  })

  it('stops before copying when told to, and does not advance', async () => {
    const r = rig({ a: photo, b: photo })
    const step = await walk(r, { startAfter: '', shouldStop: () => true })
    expect(step).toEqual<ReconcileResult>({ copied: 0, skipped: 0, tombstoned: 0, missed: [], failure: null, nextStartAfter: '', passComplete: false })
    expect(r.bak.calls.puts).toEqual([])
  })

  it('A FAILING OBJECT STOPS THE WALK THERE -- it is reported every run, never stepped over', async () => {
    const r = rig({ a: photo, b: photo, c: photo }, {}, {}, { failPut: (k) => k === 'b' })
    const step = await walk(r)
    expect(step).toEqual<ReconcileResult>({
      copied: 1, skipped: 0, tombstoned: 0, missed: [], failure: { key: 'b', reason: 'R2 put failed' }, nextStartAfter: 'a', passComplete: false,
    })
    expect(r.bak.store.has('c')).toBe(false)
  })

  it('A COPY HELD AT THE WRONG SIZE is not counted as backed up: it is attempted, and the lock makes that loud', async () => {
    const r = rig({ a: photo }, { a: { body: 'JPE' } })
    const step = await walk(r)
    expect(step.failure).toEqual({ key: 'a', reason: 'object a is locked' })
    expect(step.passComplete).toBe(false)
  })

  it('an object the queue copied between the listing and the copy is skipped, not counted as copied', async () => {
    const r = rig({ a: photo }, { a: photo }, {}, { hideFromList: new Set(['a']) })
    const step = await walk(r)
    expect(step).toMatchObject({ copied: 0, skipped: 1, failure: null, passComplete: true })
  })

  it('NAMES WHAT THE QUEUE SHOULD HAVE COPIED: older than the window and missing', async () => {
    const r = rig({ old: { body: 'x', uploaded: ago(HOUR + 1000) }, fresh: { body: 'x', uploaded: ago(HOUR - 1000) } })
    const step = await walk(r)
    expect(step.copied).toBe(2)
    expect(step.missed).toEqual(['old'])
  })

  it('a key inside the tombstone namespace is never copied over a deletion record, and the walk moves past it', async () => {
    const r = rig({ '_deleted/x': photo, a: photo })
    const step = await walk(r)
    expect(r.bak.calls.puts).toEqual(['a'])
    expect(step.passComplete).toBe(true)
  })

  it('A DELETION THE QUEUE NEVER RECORDED is tombstoned once, and the copy is kept', async () => {
    const r = rig({ a: photo }, { a: photo, gone: photo })
    const first = await walk(r)
    expect(first).toMatchObject({ tombstoned: 1, passComplete: true, failure: null })
    expect(r.bak.store.get('gone')?.body).toBe('JPEG!')
    expect(r.bak.store.has('_deleted/gone')).toBe(true)
    const again = await walk(r)
    expect(again).toMatchObject({ tombstoned: 0, failure: null })
  })

  it('an object uploaded after the listing and already copied by the queue is NOT tombstoned', async () => {
    const r = rig({ a: photo, late: photo }, { a: photo, late: photo }, { hideFromList: new Set(['late']) })
    const step = await walk(r)
    expect(step.tombstoned).toBe(0)
    expect(r.bak.store.has('_deleted/late')).toBe(false)
  })

  it('deletion records in the backup are not mistaken for photos that need their own deletion record', async () => {
    const r = rig({}, { '_deleted/x': { body: '' } })
    const step = await walk(r)
    expect(step).toMatchObject({ tombstoned: 0, passComplete: true })
    expect(r.bak.calls.puts).toEqual([])
  })

  it('a deletion record that could not be written stops the run and repeats the range', async () => {
    const r = rig({ a: photo }, { gone: photo }, {}, { failPut: (k) => k === '_deleted/gone' })
    const step = await walk(r, { startAfter: '' })
    expect(step.failure).toEqual({ key: 'gone', reason: 'R2 put failed' })
    expect(step.nextStartAfter).toBe('')
    expect(step.passComplete).toBe(false)
  })

  it('an empty bucket is a complete pass', async () => {
    const r = rig()
    expect(await walk(r)).toEqual<ReconcileResult>({ copied: 0, skipped: 0, tombstoned: 0, missed: [], failure: null, nextStartAfter: '', passComplete: true })
  })
})

describe('pruneBackup -- the grace period', () => {
  it('keeps a deleted photo 31 days, one day past the 30-day lock', () => {
    expect(GRACE_DAYS).toBe(31)
    expect(TOMBSTONE_PREFIX).toBe('_deleted/')
    expect(RETRY_DELAY_SECONDS).toBe(60)
  })

  it('removes a copy and its tombstone past 31 days, and keeps one a second short of it', async () => {
    const r = rig({}, {
      'albums/a/old.jpg': photo, '_deleted/albums/a/old.jpg': { body: '', uploaded: ago(31 * DAY + 1000) },
      'albums/a/young.jpg': photo, '_deleted/albums/a/young.jpg': { body: '', uploaded: ago(31 * DAY - 1000) },
    })
    expect(await pruneBackup(r.deps)).toEqual({ removed: 1, kept: 1, failed: 0 })
    expect(r.bak.store.has('albums/a/old.jpg')).toBe(false)
    expect(r.bak.store.has('_deleted/albums/a/old.jpg')).toBe(false)
    expect(r.bak.store.has('albums/a/young.jpg')).toBe(true)
  })

  it('A PHOTO IS NEVER READ AS A DELETION RECORD, however old it is', async () => {
    const r = rig({}, { 'albums/a/wedding.jpg': { body: 'JPEG!', uploaded: ago(400 * DAY) } })
    expect(await pruneBackup(r.deps)).toEqual({ removed: 0, kept: 0, failed: 0 })
    expect(r.bak.calls.deletes).toEqual([])
  })

  it('A TOMBSTONE WITH NO READABLE DATE deletes nothing', async () => {
    const r = rig({}, { 'albums/a/x.jpg': photo, '_deleted/albums/a/x.jpg': { body: '', uploaded: new Date('not a date') } })
    expect(await pruneBackup(r.deps)).toEqual({ removed: 0, kept: 1, failed: 0 })
    expect(r.bak.calls.deletes).toEqual([])
  })

  it('an original re-uploaded under the same key is live again: only its tombstone goes', async () => {
    const r = rig({ 'albums/a/back.jpg': photo }, { 'albums/a/back.jpg': photo, '_deleted/albums/a/back.jpg': { body: '', uploaded: ago(40 * DAY) } })
    await pruneBackup(r.deps)
    expect(r.bak.calls.deletes).toEqual(['_deleted/albums/a/back.jpg'])
    expect(r.bak.store.has('albums/a/back.jpg')).toBe(true)
  })

  it('an original that could not be checked keeps its copy, and the failure is logged', async () => {
    const r = rig({}, { 'albums/a/x.jpg': photo, '_deleted/albums/a/x.jpg': { body: '', uploaded: ago(40 * DAY) } }, { failHead: () => true })
    expect(await pruneBackup(r.deps)).toEqual({ removed: 0, kept: 0, failed: 1 })
    expect(r.bak.store.has('albums/a/x.jpg')).toBe(true)
    expect(r.logs).toHaveLength(1)
  })

  it('A DELETE THE LOCK SILENTLY IGNORED is a failure, not a removal', async () => {
    const r = rig({}, { 'albums/a/x.jpg': photo, '_deleted/albums/a/x.jpg': { body: '', uploaded: ago(40 * DAY) } }, {}, {
      ignoreDelete: (k) => k === 'albums/a/x.jpg',
    })
    expect(await pruneBackup(r.deps)).toEqual({ removed: 0, kept: 0, failed: 1 })
    expect(r.logs.join(' ')).toContain('albums/a/x.jpg is still in the backup after its delete')
  })

  it('reads every page of tombstones before deleting any', async () => {
    const backup: Record<string, Seed> = {}
    for (let i = 0; i < 5; i++) backup[`_deleted/k${i}`] = { body: '', uploaded: ago(32 * DAY) }
    const r = rig({}, backup, {}, { pageSize: 2 })
    expect(await pruneBackup(r.deps)).toEqual({ removed: 5, kept: 0, failed: 0 })
  })

  it('stops at its limit', async () => {
    const backup: Record<string, Seed> = {}
    for (let i = 0; i < 5; i++) backup[`_deleted/k${i}`] = { body: '', uploaded: ago(32 * DAY) }
    const r = rig({}, backup)
    expect(await pruneBackup({ ...r.deps, limit: 2 })).toEqual({ removed: 2, kept: 0, failed: 0 })
  })
})

describe('the stored walk position', () => {
  const T0 = '2026-09-13T10:00:00.000Z'
  const T1 = '2026-09-14T12:00:00.000Z'
  const base: BackupState = { startAfter: '', passStartedAt: null, lastPassCompletedAt: null, firstPassCompletedAt: null, passCopied: 0, lastPassCopied: 0 }
  const step = (over: Partial<ReconcileResult>): ReconcileResult =>
    ({ copied: 0, skipped: 0, tombstoned: 0, missed: [], failure: null, nextStartAfter: '', passComplete: false, ...over })

  it('lives under media_backup; a pass runs once a day, a run copies at most 200 in 25 seconds, and the queue gets an hour', () => {
    expect(BACKUP_STATE_KEY).toBe('media_backup')
    expect(PASS_INTERVAL_MS).toBe(86_400_000)
    expect(RECONCILE_COPY_BUDGET).toBe(200)
    expect(RECONCILE_TIME_BUDGET_MS).toBe(25_000)
    expect(QUEUE_WINDOW_MS).toBe(3_600_000)
  })

  it('reads back what it wrote', () => {
    const s: BackupState = { startAfter: 'albums/x', passStartedAt: T0, lastPassCompletedAt: T0, firstPassCompletedAt: T0, passCopied: 7, lastPassCopied: 3 }
    expect(parseBackupState(JSON.stringify(s))).toEqual(s)
  })

  it('ANYTHING UNREADABLE STARTS A FRESH PASS rather than believing one is done', () => {
    for (const v of [null, undefined, 42, '', 'not json', '"a string"', 'null']) {
      expect(parseBackupState(v), String(v)).toEqual(base)
    }
    expect(parseBackupState(JSON.stringify({ startAfter: 5, passStartedAt: 'yesterday', lastPassCompletedAt: 12, passCopied: -1, lastPassCopied: 1.5 })))
      .toEqual(base)
  })

  it('is due mid-pass, before any pass, and a day after the last one -- not before', () => {
    const nowMs = Date.parse(T1)
    expect(backupRunDue({ ...base, passStartedAt: T0, lastPassCompletedAt: T1 }, nowMs)).toBe(true)
    expect(backupRunDue(base, nowMs)).toBe(true)
    expect(backupRunDue({ ...base, lastPassCompletedAt: new Date(nowMs - DAY + 1000).toISOString() }, nowMs)).toBe(false)
    expect(backupRunDue({ ...base, lastPassCompletedAt: new Date(nowMs - DAY).toISOString() }, nowMs)).toBe(true)
  })

  it('A COMPLETION IN THE FUTURE cannot postpone the next pass (rule 22)', () => {
    const nowMs = Date.parse(T1)
    expect(backupRunDue({ ...base, lastPassCompletedAt: new Date(nowMs + 1000).toISOString() }, nowMs)).toBe(true)
  })

  it('mid-pass: keeps when the pass started, moves the position, adds up the copies', () => {
    const a = nextBackupState(base, step({ copied: 4, nextStartAfter: 'b' }), T0)
    expect(a).toEqual({ ...base, startAfter: 'b', passStartedAt: T0, passCopied: 4 })
    const b = nextBackupState(a, step({ copied: 3, nextStartAfter: 'd' }), T1)
    expect(b).toEqual({ ...base, startAfter: 'd', passStartedAt: T0, passCopied: 7 })
  })

  it('a completed pass records when, how many it copied, and the FIRST completion only once', () => {
    const mid: BackupState = { ...base, startAfter: 'd', passStartedAt: T0, passCopied: 7 }
    const done = nextBackupState(mid, step({ copied: 2, passComplete: true }), T0)
    expect(done).toEqual<BackupState>({ startAfter: '', passStartedAt: null, lastPassCompletedAt: T0, firstPassCompletedAt: T0, passCopied: 0, lastPassCopied: 9 })
    const later = nextBackupState(done, step({ passComplete: true }), T1)
    expect(later.firstPassCompletedAt).toBe(T0)
    expect(later.lastPassCompletedAt).toBe(T1)
  })
})
