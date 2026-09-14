import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// THE EVERY-MINUTE INDEXER, WHICH FAILED WITHOUT A WORD.
//
// It is what carries a race album's bib and face indexing to completion. Two of its failures left no
// trace anywhere anyone looks: a failed read of the album list was indistinguishable from "no album
// has indexing on", and a per-album failure went into the response body, which the scheduler throws
// away. Runners were told they were in no photos and the panel stayed clean.
//
// The database, the two indexers and the error reporter are mocked at the module boundary. The
// subrequest budget, the retry and the reporting are real.

const SECRET = 'test-cron-secret'

type Album = { id: string; bib_search_enabled: boolean; face_finder_enabled: boolean }
type Report = { source: string; message: string; opts?: { albumId?: string | null; context?: Record<string, unknown> } }

const cfg: { albums: Album[]; readFailures: number; readError: string | null; readAttempts: number; throwFor: Set<string> } = {
  albums: [], readFailures: 0, readError: null, readAttempts: 0, throwFor: new Set(),
}
const indexed: string[] = []
const reports: Report[] = []

vi.mock('@/lib/report-server-error', () => ({
  reportServerError: (source: string, message: string, opts?: Report['opts']) => { reports.push({ source, message, opts }) },
}))
vi.mock('@/lib/server/bib-index', () => ({
  BIB_BATCH: 20,
  indexAlbumBibsBatch: async (albumId: string) => {
    if (cfg.throwFor.has(albumId)) throw new Error('ResourceNotFoundException: collection missing')
    indexed.push(`bib:${albumId}`)
    return 0
  },
}))
vi.mock('@/lib/server/face-sweep', () => ({
  FACE_BATCH: 20,
  indexAlbumFacesBatch: async (albumId: string) => { indexed.push(`face:${albumId}`); return 0 },
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'or', 'is', 'order']) c[m] = () => c
      c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        cfg.readAttempts++
        const failing = cfg.readError !== null || cfg.readFailures > 0
        if (cfg.readFailures > 0) cfg.readFailures--
        const out = failing
          ? { data: null, error: { message: cfg.readError ?? 'Gateway Timeout' } }
          : { data: cfg.albums, error: null }
        return Promise.resolve(out).then(res, rej)
      }
      return c
    },
  }),
}))

const { POST } = await import('@/app/api/cron/bib-index/route')

const post = () => new Request('https://hushare.space/api/cron/bib-index', {
  method: 'POST', headers: { Authorization: `Bearer ${SECRET}` },
})

beforeEach(() => {
  process.env.ALBUM_RETIREMENT_SECRET = SECRET
  cfg.albums = [
    { id: 'race-1', bib_search_enabled: true, face_finder_enabled: false },
    { id: 'race-2', bib_search_enabled: false, face_finder_enabled: true },
  ]
  cfg.readFailures = 0
  cfg.readError = null
  cfg.readAttempts = 0
  cfg.throwFor = new Set()
  indexed.length = 0
  reports.length = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('the every-minute indexer', () => {
  it('indexes every opted-in album and reports nothing', async () => {
    const res = await POST(post())
    expect(res.status).toBe(200)
    expect([...indexed].sort()).toEqual(['bib:race-1', 'face:race-2'])
    expect(reports).toEqual([])
  })

  it('ONE GATEWAY BLIP IS NOT AN INCIDENT: a failed album read is retried once, and indexing carries on', async () => {
    vi.useFakeTimers()
    cfg.readFailures = 1
    const p = POST(post())
    await vi.advanceTimersByTimeAsync(3_000)
    const res = await p
    expect(res.status).toBe(200)
    expect(cfg.readAttempts).toBe(2)
    expect([...indexed].sort()).toEqual(['bib:race-1', 'face:race-2'])
    expect(reports).toEqual([])
  })

  it('A FAILED READ IS NOT AN EMPTY LIST: a read that keeps failing is answered and reported as a failure', async () => {
    vi.useFakeTimers()
    cfg.readError = 'Gateway Timeout'
    const p = POST(post())
    await vi.advanceTimersByTimeAsync(3_000)
    const res = await p
    expect(res.status).toBe(500)
    expect(cfg.readAttempts).toBe(2)
    expect(indexed).toEqual([])
    expect(reports.map((r) => [r.source, r.message])).toEqual([['cron/bib-index', 'Gateway Timeout']])
  })

  it('an album whose indexing throws is reported against that album, and the others are still indexed', async () => {
    cfg.albums = [
      { id: 'race-1', bib_search_enabled: true, face_finder_enabled: false },
      { id: 'race-2', bib_search_enabled: true, face_finder_enabled: false },
    ]
    cfg.throwFor = new Set(['race-1'])
    const res = await POST(post())
    expect(res.status).toBe(200)
    expect(indexed).toEqual(['bib:race-2'])
    expect(reports).toEqual([{
      source: 'cron/bib-index',
      message: 'Album indexing failed',
      opts: { albumId: 'race-1', context: { reason: 'ResourceNotFoundException: collection missing' } },
    }])
  })
})
