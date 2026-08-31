import { describe, it, expect, vi } from 'vitest'
import { retryImport, lazyRetryDelay } from '../src/lib/lazy-retry'

describe('retryImport', () => {
  it('recovers from a transient failure — the whole point', () => {
    // A dropped packet on venue WiFi used to mean the component never appeared: no error the
    // guest could act on, just a button that did nothing.
    vi.useFakeTimers()
    let calls = 0
    const load = async () => {
      calls++
      if (calls < 2) throw new TypeError('Load failed')
      return 'component'
    }
    const p = retryImport(load)()
    return vi.runAllTimersAsync().then(async () => {
      await expect(p).resolves.toBe('component')
      expect(calls).toBe(2)
      vi.useRealTimers()
    })
  })

  it('does not retry what already worked', async () => {
    let calls = 0
    const out = await retryImport(async () => { calls++; return 'x' })()
    expect(out).toBe('x')
    expect(calls).toBe(1)
  })

  it('gives up and rethrows the LAST error, so a missing chunk still surfaces', () => {
    // An open tab across a deploy fails identically every time. Those attempts must end, and the
    // real error must reach the panel rather than being swallowed by the retry.
    vi.useFakeTimers()
    let calls = 0
    const p = retryImport(async () => { calls++; throw new Error(`boom ${calls}`) })()
    const assertion = expect(p).rejects.toThrow('boom 3')
    return vi.runAllTimersAsync().then(async () => {
      await assertion
      expect(calls).toBe(3)
      vi.useRealTimers()
    })
  })
})

describe('lazyRetryDelay', () => {
  it('JITTERS BY DEFAULT — a deploy makes every open tab fail in the same instant', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 60; i++) seen.add(lazyRetryDelay(1))
    expect(seen.size).toBeGreaterThan(5)
  })

  it('backs off, but stays short because a person is waiting behind it', () => {
    expect(lazyRetryDelay(1, () => 0)).toBe(125)
    expect(lazyRetryDelay(2, () => 1)).toBe(500)
    expect(lazyRetryDelay(3, () => 1)).toBeLessThanOrEqual(1000)
  })
})
