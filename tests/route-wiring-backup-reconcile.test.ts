import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  RECONCILE_COPY_BUDGET, RECONCILE_TIME_BUDGET_MS, PRUNE_TIME_BUDGET_MS, RECONCILE_OP_BUDGET, PRUNE_OP_BUDGET,
  type BackupBucket,
} from '@/lib/server/media-backup'

// THE EVERY-MINUTE WALK AND SWEEP UNDER THE PHOTO BACKUP.
//
// The lib's tests prove the walk and the prune. These prove the route drives them: from the saved
// positions, with the real budgets, through FixedLengthStream, saving where each got to -- and that each
// way it can fail reaches the error panel, since nothing reads this route's response. The database, the
// Cloudflare context and the error reporter are mocked at the module boundary; the walk and the prune are
// real. Budgets are asserted against the fake buckets' own call counts (rule 17).

const SECRET = 'test-cron-secret'
const DAY = 86_400_000
const HOUR = 3_600_000
const enc = new TextEncoder()

type Report = { source: string; message: string; opts?: { context?: Record<string, unknown> } }
const reports: Report[] = []
const lengths: number[] = []
const cfg = {
  stateValue: null as string | null,
  readError: null as string | null,
  readAttempts: 0,
  writeError: null as string | null,
  writes: [] as Array<{ key: string; value: string }>,
  env: {} as Record<string, unknown>,
}

vi.mock('@/lib/report-server-error', () => ({
  reportServerError: (source: string, message: string, opts?: Report['opts']) => { reports.push({ source, message, opts }) },
}))
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: () => ({ env: cfg.env }) }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const c: Record<string, unknown> = {}
      c.select = () => c
      c.eq = () => c
      c.maybeSingle = () => ({
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          cfg.readAttempts++
          const out = cfg.readError !== null
            ? { data: null, error: { message: cfg.readError } }
            : { data: cfg.stateValue === null ? null : { value: cfg.stateValue }, error: null }
          return Promise.resolve(out).then(res, rej)
        },
      })
      c.upsert = (row: { key: string; value: string }) => {
        cfg.writes.push({ key: row.key, value: row.value })
        return Promise.resolve(cfg.writeError !== null ? { error: { message: cfg.writeError } } : { error: null })
      }
      return c
    },
  }),
}))

type Obj = { body: string; uploaded: Date }
type BucketOpts = {
  locked?: boolean
  failPut?: (k: string) => boolean
  failHead?: (k: string) => boolean
  failList?: boolean
  onGet?: () => void
  onDelete?: () => void
}
function bucket(seed: Record<string, Obj>, opts: BucketOpts = {}) {
  const store = new Map(Object.entries(seed))
  const calls = { lists: 0, gets: 0, puts: 0, heads: 0, deletes: 0, listOptions: [] as Array<{ prefix?: string; startAfter?: string }> }
  const total = () => calls.lists + calls.gets + calls.puts + calls.heads + calls.deletes
  const b: BackupBucket = {
    async get(key) {
      calls.gets++
      opts.onGet?.()
      const o = store.get(key)
      if (!o) return null
      return { body: new Response(o.body).body!, size: enc.encode(o.body).length }
    },
    async put(key, value) {
      calls.puts++
      if (opts.failPut?.(key)) throw new Error('R2 put failed')
      if (opts.locked && store.has(key)) throw new Error(`object ${key} is locked`)
      const text = typeof value === 'string' ? value : await new Response(value).text()
      store.set(key, { body: text, uploaded: new Date() })
      return { size: enc.encode(text).length }
    },
    async head(key) {
      calls.heads++
      if (opts.failHead?.(key)) throw new Error('R2 head failed')
      const o = store.get(key)
      return o ? { size: enc.encode(o.body).length } : null
    },
    async delete(keys) {
      calls.deletes++
      opts.onDelete?.()
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k)
    },
    async list(options) {
      calls.lists++
      calls.listOptions.push({ prefix: options?.prefix, startAfter: options?.startAfter })
      if (opts.failList) throw new Error('R2 list failed')
      const after = options?.startAfter
      const keys = [...store.keys()].filter((k) => k.startsWith(options?.prefix ?? '') && (after === undefined || k > after)).sort()
      const limit = options?.limit ?? 1000
      return {
        objects: keys.slice(0, limit).map((k) => ({ key: k, size: enc.encode(store.get(k)!.body).length, uploaded: store.get(k)!.uploaded })),
        truncated: keys.length > limit,
      }
    },
  }
  return { b, store, calls, total }
}

class FakeFixedLengthStream {
  readable: ReadableStream
  writable: WritableStream
  constructor(n: number) {
    lengths.push(n)
    const t = new TransformStream()
    this.readable = t.readable
    this.writable = t.writable
  }
}

const { POST } = await import('@/app/api/cron/backup-reconcile/route')

const post = (secret = SECRET) => new Request('https://hushare.space/api/cron/backup-reconcile', {
  method: 'POST', headers: { Authorization: `Bearer ${secret}` },
})
const old = () => ({ body: 'JPEG!', uploaded: new Date(Date.now() - 2 * DAY) })
const expiredMarker = () => ({ body: '', uploaded: new Date(Date.now() - 40 * DAY) })
const savedState = () => JSON.parse(cfg.writes.at(-1)!.value) as Record<string, unknown>
const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString()
const rig = (source: ReturnType<typeof bucket>, backup: ReturnType<typeof bucket>) => {
  cfg.env = { R2_BUCKET: source.b, R2_BACKUP: backup.b }
}

beforeEach(() => {
  process.env.ALBUM_RETIREMENT_SECRET = SECRET
  cfg.stateValue = null
  cfg.readError = null
  cfg.readAttempts = 0
  cfg.writeError = null
  cfg.writes = []
  cfg.env = {}
  reports.length = 0
  lengths.length = 0
  ;(globalThis as Record<string, unknown>).FixedLengthStream = FakeFixedLengthStream
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('the backup walk route', () => {
  it('refuses a caller without the secret before touching either bucket', async () => {
    const source = bucket({ 'albums/a/p.jpg': old() })
    rig(source, bucket({}, { locked: true }))
    const res = await POST(post('wrong'))
    expect(res.status).toBe(403)
    expect(source.calls.lists).toBe(0)
    expect(cfg.writes).toEqual([])
  })

  it('THE FIRST RUN IS THE BACKFILL: copies through FixedLengthStream, saves the finished pass, and reports nothing as missed', async () => {
    const source = bucket({ 'albums/a/1.jpg': old(), 'albums/a/2.jpg': old(), 'thumbs/a/1.jpg': old() })
    const backup = bucket({}, { locked: true })
    rig(source, backup)
    const res = await POST(post())
    expect(res.status).toBe(200)
    expect([...backup.store.keys()].sort()).toEqual(['albums/a/1.jpg', 'albums/a/2.jpg', 'thumbs/a/1.jpg'])
    expect(lengths).toEqual([5, 5, 5])
    expect(cfg.writes.map((w) => w.key)).toEqual(['media_backup'])
    expect(savedState()).toMatchObject({ startAfter: '', passStartedAt: null, lastPassCopied: 3 })
    expect(savedState().firstPassCompletedAt).toEqual(expect.any(String))
    expect(reports).toEqual([])
  })

  it('AFTER THE FIRST PASS, an old object the walk had to copy is reported as one the queue missed', async () => {
    const twoDaysAgo = isoAgo(2 * DAY)
    cfg.stateValue = JSON.stringify({ startAfter: '', lastPassCompletedAt: twoDaysAgo, firstPassCompletedAt: twoDaysAgo })
    rig(bucket({ 'albums/a/old.jpg': old() }), bucket({}, { locked: true }))
    await POST(post())
    expect(reports).toEqual([{
      source: 'cron/backup-reconcile', message: 'Backup queue missed objects', opts: { context: { count: 1, keys: ['albums/a/old.jpg'] } },
    }])
  })

  it('between passes, with no sweep due, it reads the positions and stops -- no listing, no write', async () => {
    cfg.stateValue = JSON.stringify({ lastPassCompletedAt: isoAgo(HOUR), lastPruneCompletedAt: isoAgo(HOUR) })
    const source = bucket({ 'albums/a/p.jpg': old() })
    const backup = bucket({}, { locked: true })
    rig(source, backup)
    const res = await POST(post())
    expect(await res.json()).toMatchObject({ ok: true, idle: true })
    expect(source.calls.lists + backup.calls.lists).toBe(0)
    expect(cfg.writes).toEqual([])
  })

  it('BETWEEN PASSES, A SWEEP THAT IS DUE STILL PRUNES -- without walking', async () => {
    cfg.stateValue = JSON.stringify({ lastPassCompletedAt: isoAgo(HOUR), firstPassCompletedAt: isoAgo(3 * DAY), lastPruneCompletedAt: isoAgo(7 * HOUR) })
    const source = bucket({})
    const backup = bucket({ 'albums/gone.jpg': old(), '_deleted/albums/gone.jpg': expiredMarker() }, { locked: true })
    rig(source, backup)
    const res = await POST(post())
    expect(await res.json()).toMatchObject({ walked: false, pruned: { removed: 1, sweepComplete: true } })
    expect(backup.store.has('albums/gone.jpg')).toBe(false)
    expect(source.calls.lists, 'the walk was not due').toBe(0)
    expect(Date.parse(savedState().lastPruneCompletedAt as string)).toBeGreaterThan(Date.now() - HOUR)
  })

  it('mid-pass it carries on from the SAVED position', async () => {
    cfg.stateValue = JSON.stringify({ startAfter: 'albums/b', passStartedAt: new Date().toISOString(), lastPruneCompletedAt: isoAgo(HOUR) })
    const backup = bucket({}, { locked: true })
    rig(bucket({ 'albums/a': old(), 'albums/b': old(), 'albums/c': old() }), backup)
    await POST(post())
    expect([...backup.store.keys()]).toEqual(['albums/c'])
  })

  it('copies at most 200 in a run, saves where it stopped -- and PRUNES WHILE THE PASS IS STILL RUNNING', async () => {
    const seed: Record<string, Obj> = {}
    for (let i = 0; i <= 200; i++) seed[`albums/k${String(i).padStart(3, '0')}`] = old()
    const backup = bucket({ 'albums/zz-gone': old(), '_deleted/albums/zz-gone': expiredMarker() }, { locked: true })
    rig(bucket(seed), backup)
    const res = await POST(post())
    expect(RECONCILE_COPY_BUDGET).toBe(200)
    expect(await res.json()).toMatchObject({ copied: 200, passComplete: false, pruned: { removed: 1 } })
    expect(savedState().startAfter).toBe('albums/k199')
    expect(backup.store.has('albums/zz-gone'), 'erasing on time no longer waits for the pass to end').toBe(false)
  })

  it('STOPS STARTING COPIES after 25 seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const source = bucket({ 'albums/a': old(), 'albums/b': old(), 'albums/c': old() }, {
      onGet: () => { vi.setSystemTime(Date.now() + RECONCILE_TIME_BUDGET_MS + 1) },
    })
    rig(source, bucket({}, { locked: true }))
    const res = await POST(post())
    expect(await res.json()).toMatchObject({ copied: 1, passComplete: false })
    expect(savedState().startAfter).toBe('albums/a')
  })

  it('STOPS STARTING DELETIONS after 10 seconds, and saves where the sweep got to', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    cfg.stateValue = JSON.stringify({ lastPassCompletedAt: new Date().toISOString() })
    const backup = bucket({
      'albums/a': old(), '_deleted/albums/a': expiredMarker(),
      'albums/b': old(), '_deleted/albums/b': expiredMarker(),
    }, { locked: true, onDelete: () => { vi.setSystemTime(Date.now() + PRUNE_TIME_BUDGET_MS + 1) } })
    rig(bucket({}), backup)
    const res = await POST(post())
    expect(await res.json()).toMatchObject({ pruned: { removed: 1, sweepComplete: false } })
    expect(savedState().pruneStartAfter).toBe('_deleted/albums/a')
  })

  it('THE SWEEP POSITION IS SAVED, and the next run resumes from it', async () => {
    const backupSeed: Record<string, Obj> = {}
    for (let i = 0; i < 600; i++) {
      backupSeed[`albums/x/${String(i).padStart(4, '0')}`] = old()
      backupSeed[`_deleted/albums/x/${String(i).padStart(4, '0')}`] = expiredMarker()
    }
    const backup = bucket(backupSeed, { locked: true })
    rig(bucket({}), backup)
    const first = await (await POST(post())).json()
    expect(first.pruned).toMatchObject({ sweepComplete: false })
    const cursor = savedState().pruneStartAfter as string
    expect(cursor.startsWith('_deleted/')).toBe(true)
    cfg.stateValue = cfg.writes.at(-1)!.value
    const before = backup.calls.listOptions.length
    await POST(post())
    const firstSweepList = backup.calls.listOptions.slice(before).find((o) => o.prefix === '_deleted/')
    expect(firstSweepList?.startAfter).toBe(cursor)
  })

  it('a finished sweep prunes deletions past the grace period', async () => {
    const backup = bucket({ 'albums/gone.jpg': old(), '_deleted/albums/gone.jpg': expiredMarker() }, { locked: true })
    rig(bucket({}), backup)
    const res = await POST(post())
    expect(await res.json()).toMatchObject({ passComplete: true, pruned: { removed: 1, kept: 0, failed: 0, sweepComplete: true } })
    expect(backup.store.has('albums/gone.jpg')).toBe(false)
  })

  it('a prune that could not check an original is reported', async () => {
    const backup = bucket({ 'albums/gone.jpg': old(), '_deleted/albums/gone.jpg': expiredMarker() }, { locked: true })
    rig(bucket({}, { failHead: () => true }), backup)
    await POST(post())
    expect(reports).toEqual([{ source: 'cron/backup-reconcile', message: 'Backup prune failed', opts: { context: { failed: 1 } } }])
  })

  it('A COPY THAT FAILS is reported against its key, and the position stops before it', async () => {
    rig(bucket({ 'albums/a': old(), 'albums/b': old() }), bucket({}, { locked: true, failPut: (k) => k === 'albums/b' }))
    await POST(post())
    expect(reports).toEqual([{
      source: 'cron/backup-reconcile', message: 'Backup copy failed', opts: { context: { key: 'albums/b', reason: 'R2 put failed' } },
    }])
    expect(savedState().startAfter).toBe('albums/a')
  })

  it('A REUSED KEY is reported, left as it is, and the walk goes on', async () => {
    const backup = bucket({ 'albums/a': { body: 'JPE', uploaded: new Date(Date.now() - 3 * DAY) } }, { locked: true })
    rig(bucket({ 'albums/a': old(), 'albums/b': old() }), backup)
    await POST(post())
    expect(reports).toEqual([{
      source: 'cron/backup-reconcile', message: 'Backup copy held at a different size', opts: { context: { count: 1, keys: ['albums/a'] } },
    }])
    expect(backup.store.get('albums/a')?.body).toBe('JPE')
    expect(backup.store.has('albums/b')).toBe(true)
  })

  it('A WALK THAT THROWS still saves the sweep it ran first, then fails loudly', async () => {
    const backup = bucket({ 'albums/gone.jpg': old(), '_deleted/albums/gone.jpg': expiredMarker() }, { locked: true })
    rig(bucket({}, { failList: true }), backup)
    const res = await POST(post())
    expect(res.status).toBe(500)
    expect(cfg.writes).toHaveLength(1)
    expect(savedState().lastPruneCompletedAt).toEqual(expect.any(String))
    expect(backup.store.has('albums/gone.jpg')).toBe(false)
    // serverError reports an Error as "name: message" (lib/server/respond).
    expect(reports.map((r) => r.message)).toEqual(['Error: R2 list failed'])
  })

  it('A DELETED 10,000-PHOTO ALBUM THE QUEUE NEVER RECORDED DOES NOT STOP THE WALK', { timeout: 60_000 }, async () => {
    const backupSeed: Record<string, Obj> = { 'albums/a0': old(), 'albums/z9': old() }
    for (let i = 0; i < 10_000; i++) backupSeed[`albums/big/${String(i).padStart(5, '0')}`] = old()
    const source = bucket({ 'albums/a0': old(), 'albums/z9': old() })
    const backup = bucket(backupSeed, { locked: true })
    rig(source, backup)
    let position = ''
    let posts = 0
    for (;;) {
      const before = source.total() + backup.total()
      const res = await POST(post())
      posts++
      expect(res.status).toBe(200)
      expect(source.total() + backup.total() - before, `run ${posts} made too many bucket calls`).toBeLessThanOrEqual(RECONCILE_OP_BUDGET + PRUNE_OP_BUDGET)
      const saved = savedState()
      cfg.stateValue = cfg.writes.at(-1)!.value
      if (saved.passStartedAt === null && saved.lastPassCompletedAt) break
      expect((saved.startAfter as string) > position, `run ${posts} did not move forward`).toBe(true)
      position = saved.startAfter as string
      expect(posts, 'the walk must finish, not repeat a range').toBeLessThan(15)
    }
    expect([...backup.store.keys()].filter((k) => k.startsWith('_deleted/albums/big/'))).toHaveLength(10_000)
    expect(backup.calls.deletes).toBe(0)
    expect(reports).toEqual([])
  })

  it('A POSITION THAT CANNOT BE READ is a failure, not the start: retried once, then reported, and nothing is walked', async () => {
    vi.useFakeTimers()
    cfg.readError = 'Gateway Timeout'
    const source = bucket({ 'albums/a': old() })
    rig(source, bucket({}, { locked: true }))
    const p = POST(post())
    await vi.advanceTimersByTimeAsync(3_000)
    const res = await p
    expect(res.status).toBe(500)
    expect(cfg.readAttempts).toBe(2)
    expect(source.calls.lists).toBe(0)
    expect(reports.map((r) => [r.source, r.message])).toEqual([['cron/backup-reconcile', 'Gateway Timeout']])
  })

  it('progress that could not be saved is reported', async () => {
    cfg.writeError = 'permission denied'
    rig(bucket({ 'albums/a': old() }), bucket({}, { locked: true }))
    await POST(post())
    expect(reports).toEqual([{ source: 'cron/backup-reconcile', message: 'Could not save backup progress', opts: { context: { reason: 'permission denied' } } }])
  })

  it('a missing bucket binding or FixedLengthStream is a reported failure, not a quiet no-op', async () => {
    const source = bucket({ 'albums/a': old() })
    const backup = bucket({}, { locked: true })
    const cases: Array<() => void> = [
      () => { cfg.env = { R2_BACKUP: backup.b } },
      () => { cfg.env = { R2_BUCKET: source.b } },
      () => { cfg.env = { R2_BUCKET: source.b, R2_BACKUP: backup.b }; delete (globalThis as Record<string, unknown>).FixedLengthStream },
    ]
    for (const setUp of cases) {
      reports.length = 0
      setUp()
      const res = await POST(post())
      expect(res.status).toBe(500)
      expect(reports.map((r) => r.message)).toEqual(['Backup bucket bindings unavailable'])
    }
    expect(backup.store.size).toBe(0)
  })
})
