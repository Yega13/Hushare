import { describe, it, expect } from 'vitest'
import { createDelayedOnce } from '../src/lib/delayed-once'
import type { Timers } from '../src/lib/settings-sync'

// ONE ACTION AFTER THE LAST REQUEST. The upload refresh's rule and its cancellations, testable.

function fakeTimers() {
  let seq = 0
  const live = new Map<number, { fn: () => void; ms: number }>()
  const timers: Timers = {
    set(fn, ms) { const id = ++seq; live.set(id, { fn, ms }); return id },
    clear(id) { live.delete(id) },
  }
  const runAll = () => { const fns = [...live.values()].map((t) => t.fn); live.clear(); fns.forEach((f) => f()) }
  return { timers, runAll, pending: () => live.size, delays: () => [...live.values()].map((t) => t.ms) }
}

describe('createDelayedOnce', () => {
  it('two requests inside the delay run ONCE, the latest action, after the delay', () => {
    const t = fakeTimers()
    const ran: string[] = []
    const d = createDelayedOnce({ delayMs: 3000, timers: t.timers })
    d.request(() => ran.push('a')); d.request(() => ran.push('a')); d.request(() => ran.push('b'))
    expect(t.pending()).toBe(1)
    expect(t.delays()).toEqual([3000])
    expect(d.pending()).toBe(true)
    t.runAll()
    expect(ran).toEqual(['b'])
    expect(d.pending()).toBe(false)
  })
  it('cancel drops the waiting request and nothing fires', () => {
    const t = fakeTimers()
    let ran = 0
    const d = createDelayedOnce({ delayMs: 3000, timers: t.timers })
    d.request(() => { ran++ })
    d.cancel()
    expect(t.pending()).toBe(0)
    expect(d.pending()).toBe(false)
    t.runAll()
    expect(ran).toBe(0)
  })
  it('a request after cancel fires normally; cancel with nothing waiting is harmless', () => {
    const t = fakeTimers()
    let ran = 0
    const d = createDelayedOnce({ delayMs: 10, timers: t.timers })
    d.cancel()
    d.request(() => { ran++ }); d.cancel(); d.request(() => { ran++ })
    t.runAll()
    expect(ran).toBe(1)
  })
  it('after it fires, a new request is a fresh wait (the handle is released)', () => {
    const t = fakeTimers()
    let ran = 0
    const d = createDelayedOnce({ delayMs: 10, timers: t.timers })
    d.request(() => { ran++ }); t.runAll()
    expect(d.pending()).toBe(false)
    d.request(() => { ran++ }); t.runAll()
    expect(ran).toBe(2)
  })
})
