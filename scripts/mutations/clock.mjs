// Mutation set for src/lib/clock.ts -- run with: node scripts/mutations/run.mjs clock
// Each entry is a change that would make the code WRONG; the tests in tests/clock.test.ts must fail on it.
// Newline via fromCharCode, so this file needs no escape that could be mangled on the way to disk (rule 24).
const NL = String.fromCharCode(10)
export default {
  file: 'src/lib/clock.ts',
  test: 'tests/clock.test.ts',
  mutations: [
  {
    name: 'elapsedSince stops clamping (the negative-duration hang)',
    from: 'return Math.max(0, (monotonicNow() as number) - (start as number))',
    to: 'return (monotonicNow() as number) - (start as number)',
  },
  {
    name: 'the watchdog reschedules after firing (keeps aborting the retry under way)',
    from: '      config.onStall()' + NL + '      return' + NL + '    }',
    to: '      config.onStall()' + NL + '    }',
  },
  {
    name: 'external stop() no longer clears the timer',
    from: '    if (handle !== null) {' + NL + '      timers.clear(handle)',
    to: '    if (handle === null) {' + NL + '      timers.clear(handle as unknown as number)',
  },
  {
    name: 'extendTo overwrites the budget instead of only growing it',
    from: 'extendTo: (atLeastMs: number) => { budget = Math.max(budget, elapsedSince(start) + atLeastMs) },',
    to: 'extendTo: (atLeastMs: number) => { budget = elapsedSince(start) + atLeastMs },',
  },
  {
    name: 'remaining() can go negative',
    from: 'remaining: () => Math.max(0, budget - elapsedSince(start)),',
    to: 'remaining: () => budget - elapsedSince(start),',
  },
  {
    name: 'expired() is off by one at the boundary',
    from: 'expired: () => elapsedSince(start) >= budget,',
    to: 'expired: () => elapsedSince(start) > budget,',
  },
  {
    name: 'wouldOverrun is off by one at the boundary',
    from: 'wouldOverrun: (waitMs: number) => elapsedSince(start) + waitMs >= budget,',
    to: 'wouldOverrun: (waitMs: number) => elapsedSince(start) + waitMs > budget,',
  },
  {
    name: 'poke() does not reset the activity clock',
    from: 'poke: () => { last = monotonicNow() },',
    to: 'poke: () => {},',
  },
  {
    name: 'the stall comparison is off by one',
    from: 'if (elapsedSince(last) >= config.stallMs) {',
    to: 'if (elapsedSince(last) > config.stallMs) {',
  },
  // The two the review ran that SURVIVED the original suite. Both fire the watchdog far too early:
  // the first after 1% of the quiet period, the second after any quiet at all.
  {
    name: 'REVIEW: threshold divided by 100 (fires after 200ms instead of 20s)',
    from: 'if (elapsedSince(last) >= config.stallMs) {',
    to: 'if (elapsedSince(last) >= config.stallMs / 100) {',
  },
  {
    name: 'REVIEW: stallMs ignored entirely (fires after 1ms of quiet)',
    from: 'if (elapsedSince(last) >= config.stallMs) {',
    to: 'if (elapsedSince(last) >= 1) {',
  },
  {
    name: 'REVIEW: reschedule ignores checkEveryMs (polls as fast as it can)',
    from: '    handle = timers.set(tick, config.checkEveryMs)\n  }',
    to: '    handle = timers.set(tick, 0)\n  }',
  },
  {
    name: 'REVIEW: initial arm ignores checkEveryMs',
    from: '  handle = timers.set(tick, config.checkEveryMs)\n\n  return {',
    to: '  handle = timers.set(tick, 0)\n\n  return {',
  },
  {
    name: 'settleWithin leaves its timer running when the promise wins',
    from: '  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))',
    to: '  return Promise.race([p, timeout])',
  },
  {
    name: 'settleWithin resolves the fallback even when the promise wins first',
    from: '  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))',
    to: '  return Promise.race([timeout]).finally(() => clearTimeout(timer))',
  },
  ],
}
