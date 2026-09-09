import { describe, it, expect, vi } from 'vitest'
import { ownerLoginVerdict, ownerTokenFromHash, verifyOwnerToken } from '../src/lib/owner-login'

// THE OWNER LINK. One reader for the fragment (it was read three ways), and the retry verdict
// that ended "sometimes owner, sometimes guest".

describe('ownerTokenFromHash', () => {
  it('reads the token with or without the leading hash', () => {
    expect(ownerTokenFromHash('#owner=abc123')).toBe('abc123')
    expect(ownerTokenFromHash('owner=abc123')).toBe('abc123')
    expect(ownerTokenFromHash('#x=1&owner=abc123&y=2')).toBe('abc123')
  })
  it('no fragment, another fragment, or an empty token is null, never an empty string', () => {
    expect(ownerTokenFromHash('')).toBeNull()
    expect(ownerTokenFromHash('#top')).toBeNull()
    expect(ownerTokenFromHash('#owner=')).toBeNull()
  })
})

describe('ownerLoginVerdict', () => {
  it('any 2xx proves ownership (res.ok, not one status number)', () => {
    expect(ownerLoginVerdict(200, true)).toBe('owner')
    expect(ownerLoginVerdict(204, true)).toBe('owner')
  })
  it('403 and 404 are definitive: not the owner, do not try again', () => {
    expect(ownerLoginVerdict(403, false)).toBe('not-owner')
    expect(ownerLoginVerdict(404, false)).toBe('not-owner')
  })
  it('anything else is the network, worth one more try', () => {
    for (const status of [429, 500, 502, 503, 504, 0]) expect(ownerLoginVerdict(status, false), String(status)).toBe('retry')
  })
})

describe('verifyOwnerToken -- the loop', () => {
  const noSleep = { sleep: async () => {} }
  it('a first answer that proves ownership asks once', async () => {
    const post = vi.fn(async () => ({ ok: true, status: 200 }))
    expect(await verifyOwnerToken(post, noSleep)).toBe(true)
    expect(post).toHaveBeenCalledTimes(1)
  })
  it('a 403 is NOT retried', async () => {
    const post = vi.fn(async () => ({ ok: false, status: 403 }))
    expect(await verifyOwnerToken(post, noSleep)).toBe(false)
    expect(post).toHaveBeenCalledTimes(1)
  })
  it('a 500 then a 200 is the owner (the blip that used to drop them to guest view)', async () => {
    const post = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }).mockResolvedValueOnce({ ok: true, status: 200 })
    expect(await verifyOwnerToken(post, noSleep)).toBe(true)
    expect(post).toHaveBeenCalledTimes(2)
  })
  it('a thrown network error then a 200 is the owner', async () => {
    const post = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ ok: true, status: 200 })
    expect(await verifyOwnerToken(post, noSleep)).toBe(true)
  })
  it('two transient failures is not the owner, and the page is not blocked forever', async () => {
    const post = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    expect(await verifyOwnerToken(post, noSleep)).toBe(false)
    expect(post).toHaveBeenCalledTimes(2)
  })
  it('a 500 then a 403 stops at the definitive answer', async () => {
    const post = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }).mockResolvedValueOnce({ ok: false, status: 403 })
    expect(await verifyOwnerToken(post, noSleep)).toBe(false)
    expect(post).toHaveBeenCalledTimes(2)
  })
  it('waits the retry delay between attempts, and not after the last one', async () => {
    const sleep = vi.fn(async () => {})
    const post = vi.fn(async () => ({ ok: false, status: 500 }))
    await verifyOwnerToken(post, { sleep, retryDelayMs: 600 })
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(600)
  })
  it('each attempt gets its own signal, aborted at the attempt timeout', async () => {
    vi.useFakeTimers()
    try {
      const signals: AbortSignal[] = []
      const post = vi.fn((signal: AbortSignal) => new Promise<{ ok: boolean; status: number }>((resolve, reject) => {
        signals.push(signal)
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        if (signals.length === 2) resolve({ ok: true, status: 200 })
      }))
      const done = verifyOwnerToken(post, { sleep: async () => {}, attemptTimeoutMs: 10_000 })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(signals[0].aborted).toBe(true)
      expect(await done).toBe(true)
      expect(signals).toHaveLength(2)
      expect(signals[1].aborted).toBe(false)
    } finally { vi.useRealTimers() }
  })
})
