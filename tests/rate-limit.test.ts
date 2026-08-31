import { describe, it, expect, vi, beforeEach } from 'vitest'

// THE LIMITER'S FAILURE SEMANTICS ARE THE PRODUCT'S FAILURE SEMANTICS.
//
// Every upload, every owner mutation and every search crosses checkRateLimit, and each caller
// chose a failure direction on purpose: failOpen:true where refusing real guests is worse than a
// runaway loop (reading an album), failOpen:false where an open gate is worse (owner mutations,
// presign). Those choices only mean anything if the limiter honours them when its own database
// call breaks — which is exactly the moment nothing else is watching.
//
// The database is mocked at the module boundary; the decisions are real.

type RpcReply = { data: { allowed: boolean; retry_after: number } | null; error: { message: string } | null }
type InsertReply = { data: { id: string } | null; error: { message: string } | null }
type CountReply = { count: number | null; error: { message: string } | null }

const cfg: {
  rpc: RpcReply
  insert: InsertReply
  count: CountReply
  deletes: number
  rpcCalls: number
  throwOnRpc?: boolean
} = {
  rpc: { data: null, error: { message: 'function does not exist' } },
  insert: { data: { id: 'row-1' }, error: null },
  count: { count: 1, error: null },
  deletes: 0,
  rpcCalls: 0,
}

// The delete chain is awaited in one place and fire-and-forgotten in another, and one of its two
// shapes continues with .lt() — so the eq() result must be a promise that also carries .lt.
function deletable() {
  const done = Promise.resolve({ error: null })
  return {
    eq: () => {
      cfg.deletes++
      return Object.assign(done, { lt: () => done })
    },
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: () => ({
      single: async () => {
        cfg.rpcCalls++
        if (cfg.throwOnRpc) throw new Error('network down')
        return cfg.rpc
      },
    }),
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => cfg.insert }) }),
      select: () => ({ eq: () => ({ gte: async () => cfg.count }) }),
      delete: deletable,
    }),
  }),
}))

import { checkRateLimit, ipBucket } from '@/lib/rate-limit'

beforeEach(() => {
  cfg.rpc = { data: null, error: { message: 'function does not exist' } }
  cfg.insert = { data: { id: 'row-1' }, error: null }
  cfg.count = { count: 1, error: null }
  cfg.deletes = 0
  cfg.rpcCalls = 0
  cfg.throwOnRpc = false
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('the counter fast path', () => {
  it('allows and denies on the verdict the database returns', async () => {
    cfg.rpc = { data: { allowed: true, retry_after: 0 }, error: null }
    expect(await checkRateLimit('k', 60, 10)).toEqual({ ok: true })
    cfg.rpc = { data: { allowed: false, retry_after: 42 }, error: null }
    expect(await checkRateLimit('k', 60, 10)).toEqual({ ok: false, retryAfterSeconds: 42 })
  })

  it('never tells a client to retry after zero seconds', async () => {
    // retry_after can legitimately compute to 0 at a window boundary. Passing that through tells
    // every refused client to retry immediately, which is the herd the limiter exists to prevent.
    cfg.rpc = { data: { allowed: false, retry_after: 0 }, error: null }
    const r = await checkRateLimit('k', 60, 10)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })

  it('falls back to the sliding path when the counter is unavailable, rather than refusing', async () => {
    // Mid-migration, before the function exists, the limiter must not become an outage: the
    // fallback answers instead. This is the difference between a slow check and a dead product.
    cfg.rpc = { data: null, error: { message: 'function rate_limit_hit does not exist' } }
    cfg.count = { count: 3, error: null }
    expect(await checkRateLimit('k', 60, 10)).toEqual({ ok: true })
  })

  it('a THROWN rpc also falls back instead of surfacing', async () => {
    cfg.throwOnRpc = true
    cfg.count = { count: 3, error: null }
    expect(await checkRateLimit('k', 60, 10)).toEqual({ ok: true })
  })

  it('sliding callers never touch the counter at all', async () => {
    // photo_notify allows 1 per 600s as a DEBOUNCE. A fixed window can pass two across a boundary,
    // which here means the owner gets two "new photos" emails. Those callers opt out.
    cfg.count = { count: 1, error: null }
    await checkRateLimit('k', 600, 1, { sliding: true })
    expect(cfg.rpcCalls).toBe(0)
  })
})

describe('the sliding path holds its boundary', () => {
  it('admits the request that lands exactly on the limit', async () => {
    // The count INCLUDES the row this request just inserted, so the threshold is strictly-greater:
    // at max the request passes, at max+1 it is refused. Off by one here silently shrinks every
    // ceiling in the app by exactly one request.
    cfg.count = { count: 10, error: null }
    expect(await checkRateLimit('k', 60, 10)).toEqual({ ok: true })
  })

  it('refuses past the limit and removes its own row while doing so', async () => {
    cfg.count = { count: 11, error: null }
    const r = await checkRateLimit('k', 60, 10)
    expect(r).toEqual({ ok: false, retryAfterSeconds: 60 })
    // The refused request's own row must be deleted, or refusals inflate the count for everyone
    // who follows — a limiter that ratchets itself shut.
    expect(cfg.deletes).toBeGreaterThanOrEqual(1)
  })
})

describe('failure honours the direction the caller chose', () => {
  it('failOpen:false refuses when the insert fails — an open gate is worse', async () => {
    cfg.insert = { data: null, error: { message: 'connection reset' } }
    const r = await checkRateLimit('k', 60, 10, { failOpen: false })
    expect(r.ok).toBe(false)
  })

  it('failOpen:true allows when the insert fails — refusing real guests is worse', async () => {
    cfg.insert = { data: null, error: { message: 'connection reset' } }
    expect(await checkRateLimit('k', 60, 10, { failOpen: true })).toEqual({ ok: true })
  })

  it('a failed COUNT cleans up its own insert before answering', async () => {
    // The insert succeeded, the count did not. Leaving the row behind inflates every later count
    // for this key — repeated blips walk innocent callers toward permanent lockout.
    cfg.count = { count: null, error: { message: 'timeout' } }
    const r = await checkRateLimit('k', 60, 10, { failOpen: true })
    expect(r).toEqual({ ok: true })
    expect(cfg.deletes).toBeGreaterThanOrEqual(1)
  })

  it('failOpen defaults to CLOSED', async () => {
    // The safe default: a caller who did not think about failure direction gets the one that
    // cannot silently disable a security limit.
    cfg.insert = { data: null, error: { message: 'x' } }
    const r = await checkRateLimit('k', 60, 10)
    expect(r.ok).toBe(false)
  })
})

describe('ipBucket — an IPv6 client is a network, not an address', () => {
  it('keeps an IPv4 address exactly as it is', () => {
    expect(ipBucket('203.0.113.7')).toBe('203.0.113.7')
    expect(ipBucket('  203.0.113.7  ')).toBe('203.0.113.7')
  })

  it('collapses a /64 so one host cannot become quintillions of buckets', () => {
    // THE BUG. A routed /64 is standard on almost any VPS, so every per-IP limit in the product
    // was effectively per-request for anyone who wanted around it.
    const a = ipBucket('2001:db8:1234:5678:aaaa:bbbb:cccc:dddd')
    const b = ipBucket('2001:db8:1234:5678:1111:2222:3333:4444')
    expect(a).toBe(b)
    expect(a).toBe('2001:db8:1234:5678::/64')
  })

  it('separates genuinely different networks', () => {
    expect(ipBucket('2001:db8:1234:5678::1')).not.toBe(ipBucket('2001:db8:1234:9999::1'))
  })

  it('handles compressed and short forms without inventing groups', () => {
    expect(ipBucket('::1')).toBe('0:0:0:0::/64')
    expect(ipBucket('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(ipBucket('2001:db8::')).toBe('2001:db8:0:0::/64')
  })

  it('ignores a zone index, which is per-interface and not per-network', () => {
    expect(ipBucket('fe80::1%eth0')).toBe(ipBucket('fe80::1%wlan0'))
  })
})
