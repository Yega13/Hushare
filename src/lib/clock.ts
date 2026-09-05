// ONE ORIGIN FOR EVERY DURATION IN THE CLIENT.
//
// Date.now() is a WALL clock. It steps when a phone takes an NTP or NITZ correction, when someone
// sets the time by hand, or when a device with a wrong RTC (flat battery, long power-off) corrects
// on boot — forwards or BACKWARDS.
//
// NOT when it crosses a timezone: Date.now() is UTC epoch milliseconds and a timezone change does
// not move it. AGENTS.md rule 22 and an earlier version of this comment both said it does. The bug
// is entirely real; that one mechanism was wrong, and it matters because it changes how often you
// would expect this to fire — routine drift correction is small and frequent, a wrong RTC joining
// wifi is large and rare, and a timezone flight is neither. Every duration in this product is a
// difference of two readings, and AGENTS.md rule 22 exists because one of them deferred a refresh by
// the size of an hour-long jump and never recovered.
//
// The two that matter most are the upload stall watchdogs, and they fail in opposite directions:
//
//   `if (Date.now() - lastActivity > STALL_TIMEOUT_MS)`
//
//   step BACKWARDS -> the difference goes NEGATIVE, the comparison never becomes true, and the
//     watchdog never fires. A stalled upload hangs forever with a spinner, at an event.
//   step FORWARDS  -> it fires immediately and aborts an upload that was perfectly healthy.
//
// performance.now() is monotonic from page load. It cannot step and cannot go backwards.
//
// BRANDED, so the mistake is a compile error rather than a review finding: Date.now() returns
// `number`, which is not assignable to Millis, so `elapsedSince(Date.now())` does not compile. The
// brand is the enforcement; the comment is only the reason.
//
// The precedent already existed in exactly one place — PackageThanksBanner's "a monotonic origin, so
// a clock correction during checkout cannot make this negative" — written once, used once, while 35
// other sites kept using the wall clock. That is rule 13: the idea was known and unshared.

declare const MONOTONIC: unique symbol

/** A reading from the monotonic clock. Not interchangeable with a Date.now() timestamp. */
export type Millis = number & { readonly [MONOTONIC]: true }

/**
 * Now, on a clock that cannot go backwards.
 *
 * Falls back to Date.now() only where performance is genuinely absent. That is not a real browser
 * or a real Worker — it is an old test environment — and a fallback that throws instead would turn
 * a missing global into a blank page.
 */
export function monotonicNow(): Millis {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()) as Millis
}

/**
 * How long since a monotonic reading.
 *
 * NEVER NEGATIVE. Monotonicity already guarantees that, and the clamp is the belt to those braces —
 * it also states the direction this errs in: a duration that reads 0 makes a caller act EARLY
 * (retry sooner, treat something as stale sooner), never never.
 */
export function elapsedSince(start: Millis): number {
  return Math.max(0, (monotonicNow() as number) - (start as number))
}

/**
 * A budget, WITH the arithmetic that enforces it.
 *
 * Callers ask it questions instead of doing subtraction at the call site — rule 15: a rule whose
 * enforcement stays behind at the call site is a rule with nothing testing it. Four retry loops in
 * UploadZone each compute `Date.now() + wait >= deadline` by hand today.
 */
export function createDeadline(budgetMs: number) {
  const start = monotonicNow()
  let budget = budgetMs
  return {
    expired: () => elapsedSince(start) >= budget,
    remaining: () => Math.max(0, budget - elapsedSince(start)),
    /** Would waiting this long overrun the budget? The question every retry loop actually asks. */
    wouldOverrun: (waitMs: number) => elapsedSince(start) + waitMs >= budget,
    /** Grant more time — used after a recovery, so a network that came back gets a fair attempt. */
    extendTo: (atLeastMs: number) => { budget = Math.max(budget, elapsedSince(start) + atLeastMs) },
  }
}

/** Injectable timers, so a test drives the watchdog without waiting in real time. */
export type Timers = {
  set(fn: () => void, ms: number): number
  clear(id: number): void
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clear: (id) => clearTimeout(id),
}

/**
 * A stall watchdog: the decision AND the interval that enforces it, in one object.
 *
 * Both existing copies keep the timer in the caller and the comparison inline, so neither can be
 * tested and both are on the wall clock. Moving the timer in here is what makes `stop()` observable
 * and what stops the next copy being written (rule 15).
 *
 * `poke()` is called on every sign of life. `onStall` fires at most once.
 *
 * ONE BEHAVIOUR CHANGE FROM THE WALL-CLOCK VERSION, stated because a review found it unmentioned:
 * performance.now() does not advance while the device is SUSPENDED (Chromium on Android is
 * CLOCK_MONOTONIC, which stops across sleep; WebKit is mach_absolute_time, which also pauses).
 * Date.now() kept counting. So a guest who locks and pockets the phone mid-upload and comes back
 * five minutes later used to get an abort on the first tick; now the watchdog needs a further full
 * quiet window of AWAKE time (20s image, 45s video) before it fires. The progress bar sits frozen
 * that much longer before the automatic retry. It is not a hang -- it still fires -- and the error
 * is in the safe direction: this can delay a retry, the old code could abort a healthy upload and,
 * worse, never fire at all. Replacing hang-forever with wait-longer is the right trade. The cheap
 * mitigation, when it is worth doing, is a visibilitychange listener that fires the stall on return
 * if nothing poked while hidden -- RevealCountdown.tsx already does exactly this for its own timer.
 */
export function createStallWatch(config: {
  stallMs: number
  checkEveryMs: number
  onStall: () => void
  timers?: Timers
}): { poke: () => void; stop: () => void } {
  const timers = config.timers ?? realTimers
  let last = monotonicNow()
  let handle: number | null = null

  // FIRING IS TERMINAL BY CONSTRUCTION: this returns without rescheduling, so there is never a
  // second timer to fire a second time.
  //
  // An earlier version also carried `if (fired) return` at the top and a stop() in the fire branch.
  // A mutation run showed both could be deleted with the suite still green — because neither can be
  // reached, not because the tests were weak. Defensive code that cannot execute is worse than none:
  // it reads as the thing keeping the invariant, so the next person changes the code above it and
  // trusts a guard that was never doing anything. The invariant is the `return` below.
  const tick = () => {
    if (elapsedSince(last) >= config.stallMs) {
      handle = null
      config.onStall()
      return
    }
    handle = timers.set(tick, config.checkEveryMs)
  }

  function stop() {
    if (handle !== null) {
      timers.clear(handle)
      handle = null
    }
  }

  handle = timers.set(tick, config.checkEveryMs)

  return {
    poke: () => { last = monotonicNow() },
    stop,
  }
}
