import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// THE PHOTO DOWNLOAD, ON A DATABASE THAT BLINKS.
//
// Row 1242 (2026-09-13): a guest's download failed with "Gateway Timeout" from the photos read, and the
// row could not say which read it was. Next to it sat a worse answer: a failed ALBUM read returned 404
// "Not found" -- a guest told that the photo in front of them does not exist (rule 20).
//
// The database, rate limiter, cookies, signer and reporter are mocked at the module boundary. The
// route's own decisions, the retry and the error responder are real.

const PHOTO_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const ALBUM_ID = '11111111-2222-3333-4444-555555555555'

type Report = { source: string; message: string; opts?: { context?: Record<string, unknown> } }
const reports: Report[] = []
const reads: string[] = []
const cfg = {
  photo: null as Record<string, unknown> | null,
  album: null as Record<string, unknown> | null,
  photoFailures: 0,
  albumFailures: 0,
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.maybeSingle = () => ({
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          reads.push(table)
          const failing = table === 'photos' ? cfg.photoFailures > 0 : cfg.albumFailures > 0
          if (table === 'photos' && cfg.photoFailures > 0) cfg.photoFailures--
          if (table === 'albums' && cfg.albumFailures > 0) cfg.albumFailures--
          const out = failing
            ? { data: null, error: { message: 'Gateway Timeout' } }
            : { data: table === 'photos' ? cfg.photo : cfg.album, error: null }
          return Promise.resolve(out).then(res, rej)
        },
      })
      return b
    },
  }),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ ok: true }),
  clientIpKey: (_req: unknown, prefix: string) => `${prefix}:test`,
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/cloudflare/r2', () => ({ createPresignedGet: async (key: string) => `https://r2.example.test/${key}?signed=1` }))
vi.mock('@/lib/analytics', () => ({ track: () => {} }))
vi.mock('@/lib/album-password', () => ({ cookieNameForAlbum: (id: string) => `pw_${id}`, verifyAccessToken: async () => false }))
vi.mock('@/lib/report-server-error', () => ({
  reportServerError: (source: string, message: string, opts?: Report['opts']) => { reports.push({ source, message, opts }) },
}))

const { GET } = await import('@/app/api/download/photo/route')

const get = () => new Request(`https://hushare.space/api/download/photo?id=${PHOTO_ID}`)

beforeEach(() => {
  reports.length = 0
  reads.length = 0
  cfg.photo = { url: 'https://cdn.example/p.jpg', storage_path: `albums/${ALBUM_ID}/p.jpg`, storage_backend: 'r2', album_id: ALBUM_ID, hidden: false }
  cfg.album = { id: ALBUM_ID, owner_token: 'owner-token', allow_guest_downloads: true, password_hash: null, reveal_at: null, retired_at: null }
  cfg.photoFailures = 0
  cfg.albumFailures = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

async function settle(p: Promise<Response>): Promise<Response> {
  await vi.advanceTimersByTimeAsync(3_000)
  return p
}

describe('downloading a photo', () => {
  it('a guest is redirected to a signed link for the file', async () => {
    const res = await GET(get())
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`https://r2.example.test/albums/${ALBUM_ID}/p.jpg?signed=1`)
    expect(reports).toEqual([])
  })

  it('ONE BLIP IS RETRIED: a photo read that fails once still downloads', async () => {
    vi.useFakeTimers()
    cfg.photoFailures = 1
    const res = await settle(GET(get()))
    expect(res.status).toBe(302)
    expect(reads.filter((t) => t === 'photos')).toHaveLength(2)
    expect(reports).toEqual([])
  })

  it('a photo read that keeps failing is a reported 500 that names the read', async () => {
    vi.useFakeTimers()
    cfg.photoFailures = 99
    const res = await settle(GET(get()))
    expect(res.status).toBe(500)
    expect(reports).toEqual([{ source: 'download-photo', message: 'Gateway Timeout', opts: expect.objectContaining({ context: { step: 'photo-read' } }) }])
  })

  it('an album read that fails once is retried', async () => {
    vi.useFakeTimers()
    cfg.albumFailures = 1
    const res = await settle(GET(get()))
    expect(res.status).toBe(302)
    expect(reads.filter((t) => t === 'albums')).toHaveLength(2)
  })

  it('A FAILED ALBUM READ IS NOT "NOT FOUND": it is a reported 500 that names the read', async () => {
    vi.useFakeTimers()
    cfg.albumFailures = 99
    const res = await settle(GET(get()))
    expect(res.status).toBe(500)
    expect(reports).toEqual([{ source: 'download-photo', message: 'Gateway Timeout', opts: expect.objectContaining({ context: { step: 'album-read' } }) }])
  })

  it('a photo that does not exist, or whose album was retired, is still a quiet 404', async () => {
    cfg.photo = null
    expect((await GET(get())).status).toBe(404)
    cfg.photo = { url: 'u', storage_path: 'albums/x/p.jpg', storage_backend: 'r2', album_id: ALBUM_ID, hidden: false }
    cfg.album = { ...cfg.album!, retired_at: '2026-09-01T00:00:00.000Z' }
    expect((await GET(get())).status).toBe(404)
    expect(reports).toEqual([])
  })
})
