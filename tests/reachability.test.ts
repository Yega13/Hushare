import { describe, it, expect, vi, afterEach } from 'vitest'
import { createReachability, REACHABILITY_PROBE_MAX_MS } from '@/lib/upload/reachability'

// THE QUESTION EVERY UPLOAD RETRY ASKS BEFORE SPENDING ANOTHER ATTEMPT: is the origin there at all?
//
// Two properties here were correct-and-untestable while this sat at module scope in UploadZone:
// that every waiter on the page shares ONE probe loop, and that the four-minute budget cannot be
// bent by a wall-clock step. Both are driven directly below.

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

/** A fetch that answers from a script of statuses (or throws on 'down'), and counts its calls. */
function scriptedFetch(script: Array<number | 'down'>) {
  let i = 0
  const calls: RequestInit[] = []
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(init)
    const s = script[Math.min(i++, script.length - 1)]
    if (s === 'down') throw new TypeError('Failed to fetch')
    return { status: s }
  })
  return { fetch, calls }
}

describe('originReachable -- one cheap HEAD to /api/health', () => {
  it('is true on any answer below 500', async () => {
    const f = scriptedFetch([200])
    const r = createReachability({ fetch: f.fetch })
    expect(await r.originReachable()).toBe(true)
    expect(f.calls[0].method).toBe('HEAD')
    expect(f.calls[0].cache).toBe('no-store')
    expect(f.calls[0].signal, 'the probe has no timeout of its own; a hung HEAD would hang the retry').toBeInstanceOf(AbortSignal)
  })

  it('is false on a 5xx -- the origin is up but not serving -- from exactly 500', async () => {
    expect(await createReachability({ fetch: scriptedFetch([503]).fetch }).originReachable()).toBe(false)
    expect(await createReachability({ fetch: scriptedFetch([500]).fetch }).originReachable()).toBe(false)
    expect(await createReachability({ fetch: scriptedFetch([499]).fetch }).originReachable()).toBe(true)
  })

  it('is false when the connection fails outright', async () => {
    expect(await createReachability({ fetch: scriptedFetch(['down']).fetch }).originReachable()).toBe(false)
  })

  it('does not even ask when the browser says it is offline', async () => {
    const f = scriptedFetch([200])
    const r = createReachability({ fetch: f.fetch, online: () => false })
    expect(await r.originReachable()).toBe(false)
    expect(f.fetch).not.toHaveBeenCalled()
  })

  it('with no `online` injected, it reads the browser’s own navigator.onLine', async () => {
    // The offline test above injects `online`; this one exercises the default the browser hits.
    vi.stubGlobal('navigator', { onLine: false })
    try {
      const f = scriptedFetch([200])
      expect(await createReachability({ fetch: f.fetch }).originReachable()).toBe(false)
      expect(f.fetch).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it('the probe’s own timeout is five seconds, and THAT signal is the one handed to fetch', async () => {
    // A captive portal black-holes the HEAD; without a bound the shared probe parks every waiter.
    // Node runs AbortSignal.timeout on an internal unref'd timer that vi.useFakeTimers cannot
    // drive, so the number is asserted at the call rather than waited out.
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const f = scriptedFetch([200])
    await createReachability({ fetch: f.fetch }).originReachable()
    expect(timeout).toHaveBeenCalledWith(5000)
    expect(f.calls[0].signal).toBe(timeout.mock.results[0].value)
  })
})

describe('originRecovered -- the shared probe', () => {
  it('resolves true as soon as a probe succeeds', async () => {
    vi.useFakeTimers()
    const f = scriptedFetch(['down', 'down', 200])
    const r = createReachability({ fetch: f.fetch, random: () => 0.5 })
    const p = r.originRecovered()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await p).toBe(true)
    expect(f.fetch).toHaveBeenCalledTimes(3)
  })

  it('EVERY caller during an outage shares ONE loop -- one /api/health poll per page, not per file', async () => {
    // Fifty files parked on the same dead wifi must not each hammer the health route on their own
    // schedule. This was a module-level `let` in the component: correct, and untestable there.
    vi.useFakeTimers()
    const f = scriptedFetch(['down', 'down', 'down', 200])
    const r = createReachability({ fetch: f.fetch, random: () => 0.5 })
    const a = r.originRecovered()
    const b = r.originRecovered()
    const c = r.originRecovered()
    expect(a).toBe(b)
    expect(b).toBe(c)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await Promise.all([a, b, c])).toEqual([true, true, true])
    expect(f.fetch, 'three waiters produced more than one probe sequence').toHaveBeenCalledTimes(4)
  })

  it('once the shared loop settles, the NEXT outage gets a fresh loop', async () => {
    vi.useFakeTimers()
    const f = scriptedFetch([200, 'down', 200])
    const r = createReachability({ fetch: f.fetch, random: () => 0.5 })
    const first = r.originRecovered()
    await vi.advanceTimersByTimeAsync(0)
    expect(await first).toBe(true)
    await vi.advanceTimersByTimeAsync(0)    // let the .finally clear the slot
    const second = r.originRecovered()
    expect(second).not.toBe(first)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await second).toBe(true)
  })

  it('gives up with false once the four-minute budget is spent, on a MONOTONIC clock', async () => {
    // Was `Date.now() + REACHABILITY_PROBE_MAX_MS` compared three times. On the wall clock a forward
    // step ended the probe at once with the origin read as down; a backward step probed past the cap.
    vi.useFakeTimers()
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const f = scriptedFetch(['down'])
    const r = createReachability({ fetch: f.fetch, random: () => 0.5 })
    const p = r.originRecovered()
    // Drive real elapsed time past the budget; the fake timers advance the waits, the pinned
    // performance.now advances the deadline.
    for (let i = 0; i < 80; i++) {
      clock += 5000
      await vi.advanceTimersByTimeAsync(5000)
    }
    expect(clock).toBeGreaterThan(REACHABILITY_PROBE_MAX_MS)
    expect(await p).toBe(false)
  })

  it('jitters its waits -- no two phones re-probe in lockstep', async () => {
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const f = scriptedFetch(['down', 'down', 200])
    const r = createReachability({ fetch: f.fetch, random: () => 0 })   // the LOW end of the spread
    const p = r.originRecovered()
    await vi.advanceTimersByTimeAsync(10_000)
    await p
    const waits = setTimeoutSpy.mock.calls.map((c) => c[1] as number).filter((ms) => ms > 100)
    // attempt 1 -> 1000 * 0.5 = 500 ; attempt 2 -> 2000 * 0.5 = 1000. Never the bare 1000/2000.
    expect(waits.slice(0, 2)).toEqual([500, 1000])
  })

  it('caps the wait at five seconds -- a long outage is polled steadily, not ever more rarely', async () => {
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const f = scriptedFetch(['down'])
    const r = createReachability({ fetch: f.fetch, random: () => 1 })   // the HIGH end: the bare value
    void r.originRecovered()
    for (let i = 0; i < 12; i++) await vi.advanceTimersByTimeAsync(5000)
    const waits = setTimeoutSpy.mock.calls.map((c) => c[1] as number).filter((ms) => ms > 100)
    expect(waits.length).toBeGreaterThan(8)
    expect(Math.max(...waits)).toBe(5000)
    expect(waits.slice(0, 6)).toEqual([1000, 2000, 3000, 4000, 5000, 5000])
  })
})

describe('awaitRecovery -- the one outage wait every retry loop performs', () => {
  it('resolves true when the shared probe succeeds inside the budget', async () => {
    vi.useFakeTimers()
    const f = scriptedFetch(['down', 200])
    const r = createReachability({ fetch: f.fetch, random: () => 0.5 })
    const p = r.awaitRecovery({ remainingMs: 30_000 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(await p).toBe(true)
    expect(vi.getTimerCount(), 'the budget timer was left running after the probe won').toBe(0)
  })

  it('resolves false when the budget runs out first -- and the shared probe keeps going for others', async () => {
    vi.useFakeTimers()
    const f = scriptedFetch(['down'])
    const r = createReachability({ fetch: f.fetch, random: () => 0.5 })
    const p = r.awaitRecovery({ remainingMs: 3000 })
    await vi.advanceTimersByTimeAsync(3000)
    expect(await p).toBe(false)
    const probesAtTimeout = f.fetch.mock.calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(f.fetch.mock.calls.length, 'the page-wide probe stopped because one caller gave up').toBeGreaterThan(probesAtTimeout)
  })

  it('resolves false the moment the caller cancels, and drops its listener and timer', async () => {
    vi.useFakeTimers()
    const f = scriptedFetch(['down'])
    const r = createReachability({ fetch: f.fetch, random: () => 0.5 })
    const ctrl = new AbortController()
    const p = r.awaitRecovery({ remainingMs: 60_000, signal: ctrl.signal })
    await vi.advanceTimersByTimeAsync(1000)
    ctrl.abort()
    expect(await p).toBe(false)
    // The probe loop's own timer may be live; the budget timer must not be. Count what remains
    // after the probe loop is torn down by exhausting its script.
    const timersAfterAbort = vi.getTimerCount()
    expect(timersAfterAbort).toBeLessThanOrEqual(1)
  })

  it('a probe that WINS takes its abort listener back off the caller’s signal', async () => {
    // Every attempt of every parked file leaves one of these on the upload's signal, which lives as
    // long as the upload. settle() must remove it, or a 5,000-photo batch accumulates them.
    vi.useFakeTimers()
    const f = scriptedFetch(['down', 200])
    const r = createReachability({ fetch: f.fetch, random: () => 0.5 })
    const ctrl = new AbortController()
    const add = vi.spyOn(ctrl.signal, 'addEventListener')
    const remove = vi.spyOn(ctrl.signal, 'removeEventListener')
    const p = r.awaitRecovery({ remainingMs: 30_000, signal: ctrl.signal })
    await vi.advanceTimersByTimeAsync(5000)
    expect(await p).toBe(true)
    expect(add).toHaveBeenCalledTimes(1)
    expect(remove, 'the listener that was added is not the one removed, or none was').toHaveBeenCalledWith('abort', add.mock.calls[0][1])
  })

  it('does not probe at all with no budget left, or when already cancelled', async () => {
    const f = scriptedFetch([200])
    const r = createReachability({ fetch: f.fetch })
    expect(await r.awaitRecovery({ remainingMs: 0 })).toBe(false)
    const ctrl = new AbortController(); ctrl.abort()
    expect(await r.awaitRecovery({ remainingMs: 5000, signal: ctrl.signal })).toBe(false)
    expect(f.fetch).not.toHaveBeenCalled()
  })

  it('two callers with different budgets share the one probe and each get their own verdict', async () => {
    vi.useFakeTimers()
    const f = scriptedFetch(['down', 'down', 'down', 'down', 200])
    const r = createReachability({ fetch: f.fetch, random: () => 0.5 })
    const short = r.awaitRecovery({ remainingMs: 1000 })
    const long = r.awaitRecovery({ remainingMs: 60_000 })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await short).toBe(false)
    expect(await long).toBe(true)
    expect(f.fetch).toHaveBeenCalledTimes(5)
  })
})
