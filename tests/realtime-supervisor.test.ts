import { describe, it, expect, vi } from 'vitest'
import {
  RECONNECT_CAP_MS, REFETCH_MAX_WAIT_MS, createChannelSupervisor, reconnectDelay, refetchDebounceDelay,
  watchPhotosChannel, type PhotosChannelPort,
} from '../src/lib/realtime-supervisor'
import { FORCED_REFRESH_MIN_GAP_MS } from '../src/lib/album-freshness'
import type { Timers } from '../src/lib/settings-sync'

// THE PHOTOS CHANNEL'S TIMERS AND ITS LIFECYCLE. Each rule here is a shipped bug: reconnect loops
// that accumulated per drop (167023e), a second fallback poll per retry, a fixed delay that made a
// room of phones reconnect and refetch in the same instant, and a debounce that a steady stream of
// pings could hold off forever. Timers are fake and named by delay, so "one timer" is an assertion
// rather than a hope.

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

/** Timers on a virtual clock, for the one rule that is about elapsed time rather than which timer. */
function clockTimers() {
  let now = 0
  let seq = 0
  const due = new Map<number, { fn: () => void; at: number }>()
  const timers: Timers = {
    set(fn, ms) { const id = ++seq; due.set(id, { fn, at: now + ms }); return id },
    clear(id) { due.delete(id) },
  }
  function advance(ms: number) {
    const end = now + ms
    for (;;) {
      let next: [number, { fn: () => void; at: number }] | undefined
      for (const entry of due) if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry
      if (!next) break
      due.delete(next[0])
      now = next[1].at
      next[1].fn()
    }
    now = end
  }
  return { timers, advance, now: () => now }
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

// rand = 1 is the top of the jitter band: 1.25x the nominal value.
const DEBOUNCE_AT_RAND_1 = 3125
const MAX_WAIT_AT_RAND_1 = REFETCH_MAX_WAIT_MS * 1.25

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
  it('the poll keeps running while the channel is down, one PROBE-FIRST refresh per interval, re-armed once', () => {
    const r = rig()
    r.sup.onStatus('CHANNEL_ERROR')
    const pollId = () => [...r.live.entries()].find(([, t]) => t.ms === 15000)![0]
    r.fire(pollId())
    expect(r.refresh).toHaveBeenCalledTimes(1)
    // force:false: a forced poll skips the 40-byte probe and pulls the whole window on every
    // websocket-refused phone, every interval -- the herd the probe exists to prevent.
    expect(r.refresh).toHaveBeenCalledWith({ force: false })
    expect(r.delays().filter((d) => d === 15000)).toHaveLength(1)
    r.fire(pollId())
    expect(r.refresh).toHaveBeenCalledTimes(2)
  })
})

describe('the supervisor -- broadcasts', () => {
  it('five broadcasts inside the debounce produce ONE refresh, forced', () => {
    const r = rig()
    for (let i = 0; i < 5; i++) r.sup.onChanged()
    expect(r.pending(), 'one debounce and one max wait').toBe(2)
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
  it('the debounce and the max wait both use the jittered delay', () => {
    const r = rig({ rand: () => 0 })
    r.sup.onChanged()
    expect(r.delays()).toEqual([1875, REFETCH_MAX_WAIT_MS * 0.75])
  })
})

describe('the supervisor -- a stream of broadcasts can never hold the refresh off', () => {
  const maxWaitTimers = (r: ReturnType<typeof rig>) => [...r.live.entries()].filter(([, t]) => t.ms === MAX_WAIT_AT_RAND_1)

  it('A PING EVERY SECOND FOR A MINUTE -- an upload stream, or a script with the album link -- still refreshes', () => {
    // The debounce alone never fires here: every ping replaces it before it is due. This is the
    // frozen album and the frozen wall the review of 2026-09-14 found.
    const c = clockTimers()
    const refresh = vi.fn()
    const sup = createChannelSupervisor({ connect: () => {}, refresh, now: () => c.now() + 1_000_000, debounceMs: 2500, timers: c.timers, rand: () => 1 })
    for (let s = 0; s < 60; s++) { sup.onChanged(); c.advance(1000) }
    expect(refresh.mock.calls.length, 'at least one refresh per jittered max wait')
      .toBeGreaterThanOrEqual(Math.floor(60_000 / MAX_WAIT_AT_RAND_1))
  })
  it('the FIRST broadcast of a burst starts the max wait, and later ones do not move it', () => {
    const r = rig()
    r.sup.onChanged()
    expect(maxWaitTimers(r)).toHaveLength(1)
    const [firstId] = maxWaitTimers(r)[0]
    for (let i = 0; i < 20; i++) r.sup.onChanged()
    expect(maxWaitTimers(r), 'still one max-wait timer').toHaveLength(1)
    expect(maxWaitTimers(r)[0][0], 'and the same one: a ping must not re-arm it').toBe(firstId)
    expect(r.pending(), 'one debounce and one max wait, however many pings').toBe(2)
  })
  it('when the max wait fires first it refreshes ONCE and cancels the debounce', () => {
    const r = rig()
    for (let i = 0; i < 5; i++) r.sup.onChanged()
    r.fire(maxWaitTimers(r)[0][0])
    expect(r.refresh).toHaveBeenCalledTimes(1)
    expect(r.pending(), 'the pending debounce is gone too, or the burst costs two refreshes').toBe(0)
  })
  it('when the debounce fires first it cancels the max wait', () => {
    const r = rig()
    r.sup.onChanged()
    const [id] = [...r.live.entries()].find(([, t]) => t.ms === DEBOUNCE_AT_RAND_1)!
    r.fire(id)
    expect(r.refresh).toHaveBeenCalledTimes(1)
    expect(r.pending()).toBe(0)
  })
  it('after a refresh the next broadcast starts a NEW max wait', () => {
    const r = rig()
    r.sup.onChanged(); r.fireAll()
    r.sup.onChanged()
    expect(r.delays().sort((a, b) => a - b)).toEqual([DEBOUNCE_AT_RAND_1, MAX_WAIT_AT_RAND_1])
  })
})

describe('the supervisor -- its DEFAULT random source and poll cadence, the path 300 phones take', () => {
  // The rig injects rand; these build supervisors WITHOUT it. A reviewer replaced the default
  // with a constant and every test stayed green, because the free functions' defaults were
  // tested but the supervisor never reached them.
  it('reconnect delays differ across supervisors built with no rand', () => {
    const delays = new Set<number>()
    for (let i = 0; i < 25; i++) {
      const t = fakeTimers()
      const sup = createChannelSupervisor({ connect: () => {}, refresh: () => {}, now: () => 0, debounceMs: 2500, timers: t.timers })
      sup.onStatus('CHANNEL_ERROR')
      const reconnect = t.delays().find((d) => d >= 1000 && d <= 2000)
      expect(reconnect, 'a reconnect in the jittered 1-2 s band').toBeDefined()
      delays.add(reconnect!)
    }
    expect(delays.size).toBeGreaterThan(1)
  })
  it('poll delays differ across supervisors built with no pollDelay', () => {
    const delays = new Set<number>()
    for (let i = 0; i < 25; i++) {
      const t = fakeTimers()
      const sup = createChannelSupervisor({ connect: () => {}, refresh: () => {}, now: () => 0, debounceMs: 2500, timers: t.timers })
      sup.onStatus('CHANNEL_ERROR')
      const poll = t.delays().find((d) => d > 2000)
      expect(poll, 'a poll beyond the reconnect band').toBeDefined()
      delays.add(poll!)
    }
    expect(delays.size).toBeGreaterThan(1)
  })
  it('debounce AND max-wait delays differ across supervisors built with no rand', () => {
    const debounces = new Set<number>()
    const maxWaits = new Set<number>()
    for (let i = 0; i < 25; i++) {
      const t = fakeTimers()
      const sup = createChannelSupervisor({ connect: () => {}, refresh: () => {}, now: () => 0, debounceMs: 2500, timers: t.timers })
      sup.onChanged()
      const [debounce, maxWait] = t.delays()
      debounces.add(debounce)
      maxWaits.add(maxWait)
    }
    expect(debounces.size).toBeGreaterThan(1)
    expect(maxWaits.size, 'every viewer got the first ping together, so the max wait must spread them too').toBeGreaterThan(1)
  })
})

describe('the supervisor -- dispose', () => {
  it('clears the reconnect, the debounce, the max wait and the poll; nothing fires afterwards', () => {
    const r = rig()
    r.sup.onStatus('CHANNEL_ERROR')
    r.sup.onChanged()
    expect(r.pending()).toBe(4)
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
    r.sup.onChanged()
    const fns = [...r.live.values()].map((t) => t.fn)
    r.sup.dispose()
    fns.forEach((f) => f())
    expect(r.connect).not.toHaveBeenCalled()
    expect(r.refresh).not.toHaveBeenCalled()
  })
})

// A fake of the three Supabase calls that echoes the way the real client does: removing a channel
// fires CLOSED into that channel's own status callback, synchronously.
type FakeChannel = { id: number; onChanged: () => void; onStatus: ((status: string) => void) | null }

function fakePort(opts: { statusOnSubscribe?: string } = {}) {
  let seq = 0
  const channels: FakeChannel[] = []
  const log: string[] = []
  const port: PhotosChannelPort<FakeChannel> = {
    create(onChanged) {
      const ch: FakeChannel = { id: ++seq, onChanged, onStatus: null }
      channels.push(ch)
      log.push(`create ${ch.id}`)
      return ch
    },
    subscribe(ch, onStatus) {
      ch.onStatus = onStatus
      log.push(`subscribe ${ch.id}`)
      if (opts.statusOnSubscribe) onStatus(opts.statusOnSubscribe)
    },
    remove(ch) {
      log.push(`remove ${ch.id}`)
      ch.onStatus?.('CLOSED')
    },
  }
  return { port, channels, log }
}

function watchRig(opts: { statusOnSubscribe?: string } = {}) {
  const t = fakeTimers()
  const refresh = vi.fn()
  const p = fakePort(opts)
  const stop = watchPhotosChannel(p.port, {
    refresh, now: () => 1_000_000, debounceMs: 2500, pollDelay: () => 15_000, timers: t.timers, rand: () => 1,
  })
  return { ...t, ...p, refresh, stop }
}

describe('watchPhotosChannel -- one live channel, and only its own events count', () => {
  it('opens one channel and subscribes it', () => {
    const r = watchRig()
    expect(r.log).toEqual(['create 1', 'subscribe 1'])
  })
  it('a broadcast on the channel reaches the debounce, and SUBSCRIBED refreshes', () => {
    const r = watchRig()
    r.channels[0].onChanged()
    expect(r.pending()).toBe(2)
    r.channels[0].onStatus!('SUBSCRIBED')
    expect(r.refresh).toHaveBeenCalledWith({ force: false })
  })
  it('THE OLD CHANNEL IS FORGOTTEN BEFORE IT IS REMOVED: its synchronous CLOSED echo schedules nothing (167023e)', () => {
    const r = watchRig()
    r.channels[0].onStatus!('CHANNEL_ERROR')           // one reconnect (2000) and the poll (15000)
    const [reconnectId] = [...r.live.entries()].find(([, t]) => t.ms === 2000)!
    r.fire(reconnectId)                                 // removes channel 1, which echoes CLOSED at once
    expect(r.log).toEqual(['create 1', 'subscribe 1', 'remove 1', 'create 2', 'subscribe 2'])
    expect(r.delays(), 'the echo must not schedule a second reconnect').toEqual([15000])
  })
  it("a replaced channel's late status events are ignored", () => {
    const r = watchRig()
    r.channels[0].onStatus!('CHANNEL_ERROR')
    r.fire([...r.live.entries()].find(([, t]) => t.ms === 2000)![0])
    r.channels[0].onStatus!('CHANNEL_ERROR')
    r.channels[0].onStatus!('SUBSCRIBED')
    expect(r.delays(), "the dead channel's error re-arms nothing").toEqual([15000])
    expect(r.refresh, "and its SUBSCRIBED does not refresh on the live one's behalf").not.toHaveBeenCalled()
  })
  it('THE NEW CHANNEL IS RECORDED BEFORE IT SUBSCRIBES: a SUBSCRIBED that arrives synchronously counts', () => {
    const r = watchRig({ statusOnSubscribe: 'SUBSCRIBED' })
    expect(r.refresh).toHaveBeenCalledTimes(1)
  })
  it('a status the supervisor does not know is not passed on as a failure', () => {
    const r = watchRig()
    r.channels[0].onStatus!('JOINING')
    expect(r.pending()).toBe(0)
    expect(r.refresh).not.toHaveBeenCalled()
  })
  it('cleanup removes the live channel, clears every timer, and nothing after it does anything', () => {
    const r = watchRig()
    r.channels[0].onStatus!('CHANNEL_ERROR')
    r.channels[0].onChanged()
    expect(r.pending()).toBe(4)
    r.stop()
    expect(r.log.at(-1)).toBe('remove 1')
    expect(r.pending()).toBe(0)
    r.channels[0].onChanged()
    r.channels[0].onStatus!('SUBSCRIBED')
    expect(r.pending()).toBe(0)
    expect(r.refresh).not.toHaveBeenCalled()
  })
})
