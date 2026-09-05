import { describe, it, expect, vi, afterEach } from 'vitest'
import { monotonicNow, elapsedSince, createDeadline, createStallWatch, type Timers } from '@/lib/clock'

// THE FAILURE THIS MODULE EXISTS FOR, DRIVEN DIRECTLY.
//
// `if (Date.now() - lastActivity > STALL_TIMEOUT_MS)` is the upload stall watchdog. On a wall clock
// it breaks in BOTH directions: a backward step makes the difference negative so it never fires and
// the upload hangs forever, and a forward step fires it immediately and aborts a healthy upload.
// AGENTS.md rule 22.
//
// These tests move the clock on purpose, which is only safe because the clock is injectable — the
// mutation harness cannot check a rule whose enforcement lives at the call site (rule 15).

/** A hand-driven timer queue: no real waiting, and every scheduled callback is visible. */
function fakeTimers() {
  let next = 1
  const queue = new Map<number, { fn: () => void; at: number }>()
  let now = 0
  let lastRequested = -1
  const timers: Timers = {
    set: (fn, ms) => { lastRequested = ms; const id = next++; queue.set(id, { fn, at: now + ms }); return id },
    clear: (id) => { queue.delete(id) },
  }
  return {
    timers,
    /** Advance, firing anything due. Callbacks may schedule more; those run on later advances. */
    advance(ms: number) {
      now += ms
      for (const [id, t] of [...queue]) {
        if (t.at <= now) { queue.delete(id); t.fn() }
      }
    },
    pending: () => queue.size,
    /** The delay most recently REQUESTED — what proves checkEveryMs is honoured. */
    lastDelay: () => lastRequested,
  }
}

afterEach(() => { vi.restoreAllMocks() })

/**
 * A settable monotonic clock.
 *
 * The first version of this helper fed a FIXED ARRAY of readings, one per call — which meant every
 * test silently depended on how many times the code under test happens to call performance.now().
 * Two tests failed for that reason and neither failure was about the behaviour being tested. A
 * settable value has no such coupling.
 */
function pinClock(initial = 0) {
  const state = { now: initial }
  vi.spyOn(performance, 'now').mockImplementation(() => state.now)
  return state
}

describe('elapsedSince never goes backwards', () => {
  it('is zero rather than negative if a reading ever regresses', () => {
    // performance.now cannot regress, so this is the belt to the braces — and it pins the DIRECTION
    // the clamp errs in: a duration of 0 makes a caller act early, never never.
    const clock = pinClock(1000)
    const start = monotonicNow()
    clock.now = 500
    expect(elapsedSince(start)).toBe(0)
  })

  it('measures a real interval', () => {
    const clock = pinClock(1000)
    const start = monotonicNow()
    clock.now = 1750
    expect(elapsedSince(start)).toBe(750)
  })
})

describe('the stall watchdog fires on a stall', () => {
  it('fires once the quiet period passes', () => {
    const t = fakeTimers()
    const clock = pinClock(0)
    const onStall = vi.fn()
    createStallWatch({ stallMs: 4000, checkEveryMs: 1000, onStall, timers: t.timers })
    clock.now = 5000
    t.advance(1000)
    expect(onStall).toHaveBeenCalledTimes(1)
  })

  it('fires when the quiet period is reached EXACTLY, not a tick later', () => {
    // Without a case sitting precisely on the threshold, `>=` and `>` are indistinguishable and a
    // mutation swapping them survives. One check interval of extra silence is the difference
    // between catching a stall and letting it run another second on a venue connection.
    const t = fakeTimers()
    const clock = pinClock(0)
    const onStall = vi.fn()
    createStallWatch({ stallMs: 4000, checkEveryMs: 1000, onStall, timers: t.timers })
    clock.now = 4000
    t.advance(1000)
    expect(onStall, 'elapsed exactly equal to stallMs must count as stalled').toHaveBeenCalledTimes(1)
  })

  it('does NOT fire PART-WAY through the quiet period', () => {
    // THE GAP A REVIEW FOUND. Every other test here sits at elapsed 0 or past the threshold, so
    // nothing covered the middle — and a mutant changing `>= stallMs` to `>= stallMs / 100` passed
    // the whole suite. In production that makes the image watchdog fire after 200ms of quiet
    // instead of 20 seconds: every PUT on venue wifi aborted at the first poll and re-queued until
    // the deadline expires, and the photo reported failed. That is precisely the "a forward step
    // aborts a healthy upload" failure this module exists to prevent, and it was invisible.
    const t = fakeTimers()
    const clock = pinClock(0)
    const onStall = vi.fn()
    createStallWatch({ stallMs: 20_000, checkEveryMs: 4000, onStall, timers: t.timers })
    for (const elapsed of [200, 4000, 12_000, 19_999]) {
      clock.now = elapsed
      t.advance(4000)
      expect(onStall, `fired after only ${elapsed}ms of quiet`).not.toHaveBeenCalled()
    }
    clock.now = 20_000
    t.advance(4000)
    expect(onStall).toHaveBeenCalledTimes(1)
  })

  it('polls on the interval it was given, not as fast as it can', () => {
    // `checkEveryMs` being ignored survived a mutation too. setTimeout(0) clamps to ~4ms after five
    // nesting levels, so an in-flight upload would wake ~250 times a second — on a cheap phone,
    // times seven concurrent uploads. Battery and jank rather than data loss, but nothing checked it.
    const t = fakeTimers()
    pinClock(0)
    createStallWatch({ stallMs: 20_000, checkEveryMs: 4000, onStall: () => {}, timers: t.timers })
    expect(t.lastDelay(), 'the watchdog did not arm on checkEveryMs').toBe(4000)
    t.advance(4000)
    expect(t.lastDelay(), 'the reschedule ignored checkEveryMs').toBe(4000)
  })

  it('does NOT fire while activity keeps arriving', () => {
    const t = fakeTimers()
    const clock = pinClock(0)
    const onStall = vi.fn()
    const watch = createStallWatch({ stallMs: 4000, checkEveryMs: 1000, onStall, timers: t.timers })
    for (let i = 0; i < 10; i++) {
      clock.now += 1000
      watch.poke()
      t.advance(1000)
    }
    expect(onStall).not.toHaveBeenCalled()
  })

  it('A CLOCK THAT JUMPS BACKWARDS DOES NOT DISABLE IT — the hang-forever bug', () => {
    // The shipped shape: `Date.now() - lastActivity` goes negative after an NTP correction, the
    // comparison never becomes true, and the guest watches a spinner until they give up. Here the
    // reading regresses and elapsedSince clamps to 0, so the watchdog simply keeps watching and
    // still fires once real quiet time passes.
    const t = fakeTimers()
    const clock = pinClock(10_000)
    const onStall = vi.fn()
    createStallWatch({ stallMs: 4000, checkEveryMs: 1000, onStall, timers: t.timers })
    clock.now = 500          // the clock steps BACKWARDS, as an NTP correction does
    t.advance(1000)          // clamped to 0 -> no fire, and crucially still armed
    expect(onStall, 'a backward step disarmed the watchdog — the hang-forever bug').not.toHaveBeenCalled()
    clock.now = 20_000       // now real quiet time has passed
    t.advance(1000)
    expect(onStall).toHaveBeenCalledTimes(1)
  })

  it('schedules nothing further once it has fired', () => {
    // A watchdog that kept polling would abort the retry already under way. This is guaranteed by
    // construction — the fire branch returns without rescheduling — so the assertion is on the
    // TIMER QUEUE, which is the observable consequence, rather than on a flag.
    const t = fakeTimers()
    const clock = pinClock(0)
    const onStall = vi.fn()
    createStallWatch({ stallMs: 1000, checkEveryMs: 500, onStall, timers: t.timers })
    clock.now = 5000
    t.advance(500)
    expect(onStall).toHaveBeenCalledTimes(1)
    expect(t.pending(), 'the watchdog left a timer running after firing').toBe(0)
    // And advancing further changes nothing, because nothing is scheduled.
    t.advance(5000)
    expect(onStall).toHaveBeenCalledTimes(1)
  })

  it('stop() leaves nothing scheduled', () => {
    // The enforcement half of rule 15: an unmounted component must not keep a timer alive.
    const t = fakeTimers()
    const watch = createStallWatch({ stallMs: 1000, checkEveryMs: 500, onStall: () => {}, timers: t.timers })
    expect(t.pending()).toBe(1)
    watch.stop()
    expect(t.pending()).toBe(0)
  })
})

describe('a deadline owns its own arithmetic', () => {
  it('expires when the budget is spent', () => {
    const clock = pinClock(0)
    const d = createDeadline(5000)
    clock.now = 4999
    expect(d.expired()).toBe(false)
    clock.now = 5000
    expect(d.expired()).toBe(true)
  })

  it('answers the question a retry loop actually asks', () => {
    // Four loops compute `Date.now() + wait >= deadline` by hand today. Asking instead of
    // subtracting is what stops the fifth copy.
    const clock = pinClock(0)
    const d = createDeadline(5000)
    clock.now = 3000
    expect(d.wouldOverrun(1000)).toBe(false)
    expect(d.wouldOverrun(2500)).toBe(true)
    // EXACTLY at the boundary. Without this, `>` and `>=` are indistinguishable and a mutation
    // swapping them survived — a retry that lands precisely on the deadline is the case the
    // operator sees as "it tried once more than it should have".
    expect(d.wouldOverrun(2000), 'a wait that exactly consumes the budget must count as overrunning').toBe(true)
    expect(d.wouldOverrun(1999)).toBe(false)
    expect(d.remaining()).toBe(2000)
  })

  it('extendTo grants time after a recovery, and never TAKES time away', () => {
    // A network that came back deserves a fair attempt; but an extendTo smaller than what is left
    // must not shorten the budget, or a recovery would punish the upload it just rescued.
    const clock = pinClock(0)
    const d = createDeadline(5000)
    clock.now = 4000
    d.extendTo(3000)
    expect(d.remaining()).toBe(3000)
    d.extendTo(100)
    expect(d.remaining(), 'a small extendTo shortened the budget').toBe(3000)
  })

  it('remaining() never goes negative', () => {
    const clock = pinClock(0)
    const d = createDeadline(1000)
    clock.now = 9999
    expect(d.remaining()).toBe(0)
  })
})
