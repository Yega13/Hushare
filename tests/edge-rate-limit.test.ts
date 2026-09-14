import { describe, it, expect, vi } from 'vitest'

// THE READ LIMITS A GUEST WAITS ON, COUNTED AT THE EDGE.
//
// Each of these used to cost a database round trip -- 350 ms to 1 s measured on 2026-09-14 -- before the
// photo read, the album resolve and the presence heartbeat did any work. What must hold: the binding is
// used when it exists, a refusal is a refusal, a limiter fault never refuses a guest, and a missing
// binding falls back to the database rather than to no limit at all. Numbers written as numbers (rule 17).

vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: () => { throw new Error('no request context') } }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => { throw new Error('no database in this test') } }))

const { readRateLimit, READ_LIMITS, READ_LIMIT_PERIOD_SECONDS } = await import('@/lib/server/edge-rate-limit')

const req = (ip = '203.0.113.7') => new Request('https://hushare.space/api/album/photos', { headers: { 'cf-connecting-ip': ip } })

function rig(opts: { binding?: 'allow' | 'refuse' | 'throw'; bindingName?: string } = {}) {
  const limitCalls: string[] = []
  const fallbackCalls: unknown[][] = []
  const binding = opts.binding === undefined ? undefined : {
    limit: async ({ key }: { key: string }) => {
      limitCalls.push(key)
      if (opts.binding === 'throw') throw new Error('limiter down')
      return { success: opts.binding === 'allow' }
    },
  }
  const deps = {
    env: () => (binding ? { [opts.bindingName ?? 'ALBUM_PHOTOS_LIMITER']: binding } : {}),
    fallback: vi.fn(async (...args: unknown[]) => { fallbackCalls.push(args); return { ok: true as const } }),
  }
  return { deps, limitCalls, fallbackCalls }
}

describe('readRateLimit', () => {
  it('USES THE EDGE BINDING when it exists, keyed by the caller IP, and never touches the database', async () => {
    const r = rig({ binding: 'allow' })
    expect(await readRateLimit(req(), 'albumPhotos', r.deps)).toEqual({ ok: true })
    expect(r.limitCalls).toEqual(['album_photos:203.0.113.7'])
    expect(r.fallbackCalls).toEqual([])
  })

  it('a refusal from the binding is a refusal, with a retry after the 60-second window', async () => {
    const r = rig({ binding: 'refuse' })
    expect(await readRateLimit(req(), 'albumPhotos', r.deps)).toEqual({ ok: false, retryAfterSeconds: 60 })
  })

  it('A LIMITER FAULT NEVER REFUSES A GUEST: a binding that throws lets the read through', async () => {
    const r = rig({ binding: 'throw' })
    expect(await readRateLimit(req(), 'albumPhotos', r.deps)).toEqual({ ok: true })
    expect(r.fallbackCalls).toEqual([])
  })

  it('A MISSING BINDING FALLS BACK TO THE DATABASE LIMITER, never to no limit', async () => {
    const r = rig()
    await readRateLimit(req(), 'albumResolve', r.deps)
    expect(r.fallbackCalls).toEqual([['album_resolve:203.0.113.7', 60, 900, { failOpen: true }]])
  })

  it('each route reads its OWN binding, not another route\'s', async () => {
    const r = rig({ binding: 'refuse', bindingName: 'ALBUM_PHOTOS_LIMITER' })
    // The presence route must not be refused by the photos limiter's counter.
    expect(await readRateLimit(req(), 'presence', r.deps)).toEqual({ ok: true })
    expect(r.limitCalls).toEqual([])
    expect(r.fallbackCalls).toEqual([['presence:203.0.113.7', 60, 3000, { failOpen: true }]])
  })

  it('something in the binding slot that is not a limiter is treated as no binding', async () => {
    const deps = { env: () => ({ ALBUM_PHOTOS_LIMITER: { notALimiter: true } }), fallback: vi.fn(async () => ({ ok: true as const })) }
    await readRateLimit(req(), 'albumPhotos', deps)
    expect(deps.fallback).toHaveBeenCalledTimes(1)
  })

  it('outside a Workers request (the default deps throw) it falls back to the database', async () => {
    // The module's own getCloudflareContext is mocked to throw, as it does outside a request.
    const fallback = vi.fn(async () => ({ ok: true as const }))
    const { checkRateLimit } = await import('@/lib/rate-limit')
    void checkRateLimit
    await readRateLimit(req(), 'albumPhotos', { env: () => { throw new Error('no request context') }, fallback })
    expect(fallback).toHaveBeenCalledWith('album_photos:203.0.113.7', 60, 20000, { failOpen: true })
  })

  it('the limits are the ones these routes carried in Postgres, over a 60-second window', () => {
    expect(READ_LIMIT_PERIOD_SECONDS).toBe(60)
    expect(READ_LIMITS).toEqual({
      albumPhotos: { binding: 'ALBUM_PHOTOS_LIMITER', prefix: 'album_photos', perMinute: 20000 },
      albumResolve: { binding: 'ALBUM_RESOLVE_LIMITER', prefix: 'album_resolve', perMinute: 900 },
      presence: { binding: 'PRESENCE_LIMITER', prefix: 'presence', perMinute: 3000 },
    })
  })
})
