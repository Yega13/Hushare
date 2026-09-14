import { describe, it, expect, vi, beforeEach } from 'vitest'

// THE RESOLVE ROUTE ANSWERS A FAILED READ WITH 503, NEVER 404.
//
// The album page's client reads a 404 as "this album does not exist" and anything else as a retry
// (lib/resolve-outcome). resolveAlbum now tells a failed database read apart from a missing album; this
// pins that the route keeps the two apart on the way out.

const state = { result: { kind: 'unavailable' } as Record<string, unknown> }

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ ok: true }),
  clientIpKey: (_req: unknown, prefix: string) => `${prefix}:test`,
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/server/album-access', () => ({ resolveAlbum: async () => state.result }))

const { GET } = await import('@/app/api/album/resolve/route')
const get = () => GET(new Request('https://hushare.space/api/album/resolve?slug=abcd1234&owner=0'))

beforeEach(() => { state.result = { kind: 'unavailable' } })

describe('GET /api/album/resolve', () => {
  it('A FAILED READ IS A 503 the page can retry, not a 404 that says the album is gone', async () => {
    const res = await get()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Could not load this album right now' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('an album that does not exist is still a 404', async () => {
    state.result = { kind: 'notfound' }
    expect((await get()).status).toBe(404)
  })

  it('an album that resolves is returned', async () => {
    state.result = { kind: 'album', album: { id: 'a1', slug: 'abcd1234' } }
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'a1', slug: 'abcd1234' })
  })
})
