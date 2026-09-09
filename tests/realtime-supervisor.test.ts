import { describe, it, expect, vi } from 'vitest'
import {
  RECONNECT_CAP_MS, createChannelSupervisor, reconnectDelay, refetchDebounceDelay,
} from '../src/lib/realtime-supervisor'
import { FORCED_REFRESH_MIN_GAP_MS } from '../src/lib/album-freshness'
import type { Timers } from '../src/lib/settings-sync'

// THE PHOTOS CHANNEL'S THREE TIMERS. Each rule here is a shipped bug: reconnect loops that
// accumulated per drop (167023e), a second fallback poll per retry, and a fixed delay that made a
// room of phones reconnect and refetch in the same instant. Timers are fake and named by delay,
// so "one timer" is an assertion rather than a hope.

function fakeTimers() {
  let seq = 0
  const live = new Map<number, { fn: () => void; ms: number }>()
  const timers: Timers = {
    set(fn, ms) { const id = ++seq; live.set(id, { fn, ms }); return id },
    clear(id) { live.delete(id) },
  }
  const fire = (id: number) => { const t = live.get(id); live.delete(id); t?.fn() }
  const fireAll = () => { for (const id of [...live.keys()]) fire(id) }
  return { timers, live, fire, fireAll, pending: () => live.size, delays: () => [...live.values()].map((t) => t.ms) }
}

function rig(over: { rand?: () => number; now?: () => number } = {}) {
  const t = fakeTimers()
  const connect = vi.fn()
  const refresh = vi.fn()
  let clock = 1_000_000
  const sup = createChannelSupervisor({
    connect, refresh, now: over.now ?? (() => clock), debounceMs: 2500,
    pollDelay: () => 15_000, timers: t.timers, rand: over.rand ?? (() => 1),
  })
  return { ...t, connect, refresh, sup, tick: (ms: number) => { clock += ms } }
}

describe('reconnectDelay -- exponential, capped, jittered', () => {
  it('grows 2, 4, 8, 16 s and caps at 30 s (rand = 1 is the nominal value)', () => {
    expect([0, 1, 2, 3, 4, 5].map((n) => reconnectDelay(n, () => 1))).toEqual([2000, 4000, 8000, 16000, 30000, 30000])
    expect(reconnectDelay(10, () => 1)).toBe(RECONNECT_CAP_MS)
  })
  it('is never below half the nominal value', () => {
    expect(reconnectDelay(0, () => 0)).toBe(1000)
    expect(reconnectDelay(4, () => 0)).toBe(15000)
  })
  it('ALWAYS jitters with the real random source: two calls differ (the thundering-herd guard)', () => {
    // Not an injected rand: this is the default path, the one 300 phones actually take.
    const seen = new Set<number>()
    for (let i = 0; i < 25; i++) seen.add(reconnectDelay(0))
    expect(seen.size).toBeGreaterThan(1)
    for (const d of seen) { expect(d).toBeGreaterThanOrEqual(1000); expect(d).toBeLessThanOrEqual(2000) }
  })
})

describe('refetchDebounceDelay', () => {
  it('spreads the debounce across 0.75x to 1.25x of the base, and jitters by default', () => {
    expect(refetchDebounceDelay(2500, () => 0)).toBe(1875)
    expect(refetchDebounceDelay(2500, () => 1)).toBe(3125)
    const seen = new Set<number>()
    for (let i = 0; i < 25; i++) seen.add(refetchDebounceDelay(2500))
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('the supervisor -- status events', () => {
  it('SUBSCRIBED refetches without force, resets the backoff, and arms nothing', () => {
    const r = rig()
    r.sup.onStatus('SUBSCRIBED')
    expect(r.refresh).toHaveBeenCalledTimes(1)
    expect(r.refresh).toHaveBeenCalledWith({ force: false })
    expect(r.pending()).toBe(0)
  })
  it('a failure schedules ONE reconnect at the backoff delay and arms the poll once', () => {
    const r = rig()
    r.sup.onStatus('CHANNEL_ERROR')
    expect(r.delays().sort()).toEqual([15000, 2000])
    expect(r.sup.pollArmed()).toBe(true)
  })
  it('CHANNEL_ERROR then TIMED_OUT for one failed join schedules ONE reconnect, not two', () => {
    const r = rig()
    r.sup.onStatus('CHANNEL_ERROR')
    r.sup.onStatus('TIMED_OUT')
    const reconnects = r.delays().filter((d) => d !== 15000)
    expect(reconnects).toHaveLength(1)
    expect(reconnects[0]).toBe(4000)             // the backoff advanced; the first timer is gone
    expect(r.sup.pollArmed()).toBe(true)
    expect(r.delays().filter((d) => d === 15000)).toHaveLength(1)   // still one poll
  })
  it('the reconnect timer calls connect, once, and only while alive', () => {
    const r = rig()
    r.sup.onStatus('CLOSED')
    const [id] = [...r.live.entries()].find(([, t]) => t.ms === 2000)!
    r.fire(id)
    expect(r.connect).toHaveBeenCalledTimes(1)
  })
  it('the backoff climbs across failures and SUBSCRIBED resets it', () => {
    const r = rig()
    r.sup.onStatus('CLOSED'); r.fireAll()
    r.sup.onStatus('CLOSED')
    expect(r.delays()).toContain(4000)
    r.fireAll()
    r.sup.onStatus('SUBSCRIBED')
    r.sup.onStatus('CLOSED')
    expect(r.delays()).toContain(2000)
  })
  it('SUBSCRIBED after a failure clears the poll, and no poll fires afterwards', () => {
    const r = rig()
    r.sup.onStatus('CHANNEL_ERROR')
    r.sup.onStatus('SUBSCRIBED')
    expect(r.sup.pollArmed()).toBe(false)
    expect(r.delays()).not.toContain(15000)
    r.fireAll()
    expect(r.refresh).toHaveBeenCalledTimes(1)   // the SUBSCRIBED refetch only
  })
  it('the poll keeps running while the channel is down, one refresh per interval, re-armed once', () => {
    const r = rig()
    r.sup.onStatus('CHANNEL_ERROR')
    const pollId = () => [...r.live.entries()].find(([, t]) => t.ms === 15000)![0]
    r.fire(pollId())
    expect(r.refresh).toHaveBeenCalledTimes(1)
    expect(r.delays().filter((d) => d === 15000)).toHaveLength(1)
    r.fire(pollId())
    expect(r.refresh).toHaveBeenCalledTimes(2)
  })
})

describe('the supervisor -- broadcasts', () => {
  it('five broadcasts inside the debounce produce ONE refresh, forced', () => {
    const r = rig()
    for (let i = 0; i < 5; i++) r.sup.onChanged()
    expect(r.pending()).toBe(1)
    r.fireAll()
    expect(r.refresh).toHaveBeenCalledTimes(1)
    expect(r.refresh).toHaveBeenCalledWith({ force: true })
  })
  it('a second broadcast inside the forced-refresh gap is NOT forced (a forged ping cannot herd a full fetch)', () => {
    const r = rig()
    r.sup.onChanged(); r.fireAll()
    r.tick(FORCED_REFRESH_MIN_GAP_MS - 1)
    r.sup.onChanged(); r.fireAll()
    expect(r.refresh.mock.calls.map((c) => c[0])).toEqual([{ force: true }, { force: false }])
    r.tick(2)
    r.sup.onChanged(); r.fireAll()
    expect(r.refresh.mock.calls[2][0]).toEqual({ force: true })
  })
  it('the debounce uses the jittered delay', () => {
    const r = rig({ rand: () => 0 })
    r.sup.onChanged()
    expect(r.delays()).toEqual([1875])
  })
})

describe('the supervisor -- dispose', () => {
  it('clears the reconnect, the debounce and the poll; nothing fires afterwards', () => {
    const r = rig()
    r.sup.onStatus('CHANNEL_ERROR')
    r.sup.onChanged()
    expect(r.pending()).toBe(3)
    r.sup.dispose()
    expect(r.pending()).toBe(0)
    r.sup.onStatus('CLOSED')
    r.sup.onChanged()
    expect(r.pending()).toBe(0)
    expect(r.connect).not.toHaveBeenCalled()
    expect(r.refresh).not.toHaveBeenCalled()
  })
  it('a timer that was already taken from the queue does nothing after dispose', () => {
    const r = rig()
    r.sup.onStatus('CHANNEL_ERROR')
    const fns = [...r.live.values()].map((t) => t.fn)
    r.sup.dispose()
    fns.forEach((f) => f())
    expect(r.connect).not.toHaveBeenCalled()
    expect(r.refresh).not.toHaveBeenCalled()
  })
})
