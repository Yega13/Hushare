import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// THE RETENTION CRON, WHICH KEPT ITS FAILURES IN A RESPONSE NOBODY READS.
//
// Every number it enforces is published in the privacy policy. Each step wrote its failure into the
// response body, which the scheduler throws away, so a retention promise could quietly stop being
// kept. And two of its face-data branches treated a failure as a green light: a failed read of an
// album's recent photos meant "no recent photos" and deleted a live album's face data, and a flag
// write that did not land still deleted the collection, leaving the flag up for the indexer to
// re-enrol every face.
//
// The database, Rekognition and the error reporter are mocked at the module boundary. The order of
// the writes, the retry and the reporting are real.

const SECRET = 'test-cron-secret'
const OLD = '2025-01-01T00:00:00.000Z'

type Report = { source: string; message: string; opts?: { albumId?: string | null; context?: Record<string, unknown> } }

const cfg = {
  deleteFail: {} as Record<string, number>,
  deleteAttempts: {} as Record<string, number>,
  faceAlbums: [] as Array<{ id: string; created_at: string }>,
  faceAlbumsError: null as string | null,
  recent: [] as Array<{ id: string }>,
  recentError: null as string | null,
  flagError: null as string | null,
  clearError: null as string | null,
  deleteCollectionThrows: false,
}
const events: string[] = []
const reports: Report[] = []

vi.mock('@/lib/report-server-error', () => ({
  reportServerError: (source: string, message: string, opts?: Report['opts']) => { reports.push({ source, message, opts }) },
}))
vi.mock('@/lib/rekognition', () => ({
  deleteCollection: async (albumId: string) => {
    if (cfg.deleteCollectionThrows) throw new Error('AccessDeniedException')
    events.push(`deleteCollection:${albumId}`)
  },
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let op: 'select' | 'delete' | 'update' = 'select'
      const c: Record<string, unknown> = {}
      for (const m of ['eq', 'is', 'lt', 'gt', 'order', 'limit', 'select']) c[m] = () => c
      c.delete = () => { op = 'delete'; return c }
      c.update = () => { op = 'update'; return c }
      const answer = () => {
        if (op === 'delete') {
          cfg.deleteAttempts[table] = (cfg.deleteAttempts[table] ?? 0) + 1
          if ((cfg.deleteFail[table] ?? 0) > 0) {
            cfg.deleteFail[table]--
            return { error: { message: 'Gateway Timeout' }, count: null }
          }
          return { error: null, count: 3 }
        }
        if (op === 'update') {
          events.push(`update:${table}`)
          const e = table === 'albums' ? cfg.flagError : cfg.clearError
          return { error: e ? { message: e } : null }
        }
        if (table === 'albums') {
          return cfg.faceAlbumsError
            ? { data: null, error: { message: cfg.faceAlbumsError } }
            : { data: cfg.faceAlbums, error: null }
        }
        return cfg.recentError
          ? { data: null, error: { message: cfg.recentError } }
          : { data: cfg.recent, error: null }
      }
      c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(answer()).then(res, rej)
      return c
    },
  }),
}))

const { POST } = await import('@/app/api/cron/prune-data/route')

const post = (mode?: string) => new Request(`https://hushare.space/api/cron/prune-data${mode ? `?mode=${mode}` : ''}`, {
  method: 'POST', headers: { Authorization: `Bearer ${SECRET}` },
})

beforeEach(() => {
  process.env.ALBUM_RETIREMENT_SECRET = SECRET
  cfg.deleteFail = {}
  cfg.deleteAttempts = {}
  cfg.faceAlbums = []
  cfg.faceAlbumsError = null
  cfg.recent = []
  cfg.recentError = null
  cfg.flagError = null
  cfg.clearError = null
  cfg.deleteCollectionThrows = false
  events.length = 0
  reports.length = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('the every-minute presence sweep', () => {
  it('a sweep that works reports nothing', async () => {
    const res = await POST(post('presence'))
    expect(await res.json()).toMatchObject({ ok: true, presenceDeleted: 3 })
    expect(reports).toEqual([])
  })

  it('ONE GATEWAY BLIP IS NOT AN INCIDENT: a failed sweep is retried once, and nothing is reported', async () => {
    vi.useFakeTimers()
    cfg.deleteFail.active_sessions = 1
    const p = POST(post('presence'))
    await vi.advanceTimersByTimeAsync(3_000)
    const res = await p
    expect(await res.json()).toMatchObject({ presenceDeleted: 3 })
    expect(cfg.deleteAttempts.active_sessions).toBe(2)
    expect(reports).toEqual([])
  })

  it('a sweep that keeps failing reaches the panel -- the 10-minute presence promise is not being kept', async () => {
    vi.useFakeTimers()
    cfg.deleteFail.active_sessions = 5
    const p = POST(post('presence'))
    await vi.advanceTimersByTimeAsync(3_000)
    await p
    expect(cfg.deleteAttempts.active_sessions).toBe(2)
    expect(reports).toEqual([{
      source: 'cron/prune-data',
      message: 'Retention step failed: presence',
      opts: { albumId: null, context: { reason: 'Gateway Timeout' } },
    }])
  })
})

describe('the daily retention steps', () => {
  it('a failing step reaches the panel by name, and the steps after it still run', async () => {
    cfg.deleteFail.rate_limit_events = 5
    const res = await POST(post())
    expect((await res.json()).rateLimitDeleted).toBe('error: Gateway Timeout')
    expect(reports.map((r) => r.message)).toEqual(['Retention step failed: rate_limit_events'])
    expect(cfg.deleteAttempts.error_events, 'the steps after the failure still ran').toBe(1)
  })

  it('each daily step reports under its own name', async () => {
    for (const table of ['pending_stream_uploads', 'rate_limit_counters', 'error_events']) {
      reports.length = 0
      cfg.deleteFail = { [table]: 5 }
      await POST(post())
      expect(reports.map((r) => r.message), table).toEqual([`Retention step failed: ${table}`])
    }
  })

  it('a failed read of the face-collection candidates is reported', async () => {
    cfg.faceAlbumsError = 'Gateway Timeout'
    await POST(post())
    expect(reports.map((r) => r.message)).toEqual(['Retention step failed: face collection candidates'])
  })
})

describe('face data expiry, which must never delete what it could not check', () => {
  const idle = { id: 'album-1', created_at: OLD }

  it('expires an idle album: the flag goes down FIRST, then the collection, then the face ids', async () => {
    cfg.faceAlbums = [idle]
    const res = await POST(post())
    expect(await res.json()).toMatchObject({ faceCollectionsExpired: 1 })
    expect(events).toEqual(['update:albums', 'deleteCollection:album-1', 'update:photos'])
    expect(reports).toEqual([])
  })

  it('an album with a recent photo is left alone', async () => {
    cfg.faceAlbums = [idle]
    cfg.recent = [{ id: 'photo-1' }]
    await POST(post())
    expect(events).toEqual([])
  })

  it('A FAILED RECENT-PHOTO READ IS NOT "NO RECENT PHOTOS": nothing is switched off or deleted, and it is reported', async () => {
    cfg.faceAlbums = [idle]
    cfg.recentError = 'Gateway Timeout'
    const res = await POST(post())
    expect(await res.json()).toMatchObject({ faceCollectionsExpired: 0 })
    expect(events, 'a live album lost its Face Finder to a database blip').toEqual([])
    expect(reports).toEqual([{
      source: 'cron/prune-data',
      message: 'Retention step failed: face collection recent-photo check',
      opts: { albumId: 'album-1', context: { reason: 'Gateway Timeout' } },
    }])
  })

  it('A FLAG THAT DID NOT GO DOWN keeps the collection -- otherwise the indexer re-enrols every face', async () => {
    cfg.faceAlbums = [idle]
    cfg.flagError = 'row is read only'
    const res = await POST(post())
    expect(await res.json()).toMatchObject({ faceCollectionsExpired: 0 })
    expect(events).toEqual(['update:albums'])
    expect(reports.map((r) => [r.message, r.opts?.albumId])).toEqual([['Retention step failed: face collection expiry', 'album-1']])
  })

  it('face ids that could not be cleared are reported', async () => {
    cfg.faceAlbums = [idle]
    cfg.clearError = 'statement timeout'
    await POST(post())
    expect(reports.map((r) => [r.message, r.opts?.albumId])).toEqual([['Retention step failed: face ids reset', 'album-1']])
  })

  it('a collection that could not be deleted is reported', async () => {
    cfg.faceAlbums = [idle]
    cfg.deleteCollectionThrows = true
    await POST(post())
    expect(reports.map((r) => [r.message, r.opts?.albumId])).toEqual([['Retention step failed: face collection expiry', 'album-1']])
  })
})
