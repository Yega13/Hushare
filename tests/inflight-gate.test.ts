import { describe, it, expect } from 'vitest'
import { afterInFlight } from '../src/lib/inflight-gate'

// ONE WRITE AT A TIME PER KEY. A reviewer closed and reopened Settings inside one round trip and
// the reopened panel's request overtook the closed one's. Every case here asserts "started" flags
// after flushing microtasks rather than awaiting a promise a wrong implementation might never
// settle.

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
const macrotask = () => new Promise<void>((r) => setTimeout(r, 0))

describe('afterInFlight', () => {
  it('an idle key runs AT ONCE, synchronously, and resolves with the run value', async () => {
    let started = false
    const p = afterInFlight('idle-1', async () => { started = true; return 7 })
    expect(started).toBe(true)      // before any await: the request goes out in the tick it was planned
    await expect(p).resolves.toBe(7)
  })

  it('a second call on the same key does not start until the first has resolved', async () => {
    const a = deferred<void>()
    const log: string[] = []
    void afterInFlight('k2', () => { log.push('start1'); return a.promise })
    void afterInFlight('k2', async () => { log.push('start2') })
    await flush()
    expect(log).toEqual(['start1'])
    a.resolve()
    await flush()
    expect(log).toEqual(['start1', 'start2'])
  })

  it('a first call that REJECTS does not hold the queue, and the rejection reaches only its own caller', async () => {
    const a = deferred<void>()
    const log: string[] = []
    const p1 = afterInFlight('k3', () => { log.push('start1'); return a.promise })
    const p2 = afterInFlight('k3', async () => { log.push('start2'); return 'ok' })
    p1.catch(() => {})
    a.reject(new Error('boom'))
    await flush()
    expect(log).toEqual(['start1', 'start2'])
    await expect(p1).rejects.toThrow('boom')
    await expect(p2).resolves.toBe('ok')
  })

  it('a synchronous throw inside run is a rejection of that call, and the queue continues', async () => {
    const log: string[] = []
    const p1 = afterInFlight('k4', () => { throw new Error('sync') })
    p1.catch(() => {})
    const p2 = afterInFlight('k4', async () => { log.push('start2'); return 1 })
    await expect(p1).rejects.toThrow('sync')
    await flush()
    expect(log).toEqual(['start2'])
    await expect(p2).resolves.toBe(1)
  })

  it('different keys do not wait for each other', async () => {
    const a = deferred<void>()
    let bStarted = false
    void afterInFlight('k5-a', () => a.promise)
    void afterInFlight('k5-b', async () => { bStarted = true })
    expect(bStarted).toBe(true)
    a.resolve()
  })

  it('three calls on one key run in call order, each after the previous ended', async () => {
    const a = deferred<void>(), b = deferred<void>()
    const log: string[] = []
    void afterInFlight('k6', () => { log.push('1'); return a.promise })
    void afterInFlight('k6', () => { log.push('2'); return b.promise })
    void afterInFlight('k6', async () => { log.push('3') })
    await flush()
    expect(log).toEqual(['1'])
    a.resolve(); await flush()
    expect(log).toEqual(['1', '2'])
    b.resolve(); await flush()
    expect(log).toEqual(['1', '2', '3'])
  })

  it('a call made after the first has landed still waits for the second', async () => {
    const a = deferred<void>(), b = deferred<void>()
    const log: string[] = []
    void afterInFlight('k7', () => { log.push('1'); return a.promise })
    void afterInFlight('k7', () => { log.push('2'); return b.promise })
    a.resolve(); await flush()
    expect(log).toEqual(['1', '2'])
    void afterInFlight('k7', async () => { log.push('3') })
    await flush()
    expect(log).toEqual(['1', '2'])
    b.resolve(); await flush()
    expect(log).toEqual(['1', '2', '3'])
  })

  it('once the queue drains the key is forgotten: the next call starts synchronously again', async () => {
    await afterInFlight('k8', async () => {})
    await macrotask()
    let started = false
    void afterInFlight('k8', async () => { started = true })
    expect(started).toBe(true)
  })
})
