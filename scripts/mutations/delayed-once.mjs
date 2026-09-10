// Mutation set for src/lib/delayed-once.ts -- run with: node scripts/mutations/run.mjs delayed-once
export default {
  file: 'src/lib/delayed-once.ts',
  test: 'tests/delayed-once.test.ts',
  mutations: [
  { name: 'requests stack instead of replacing (one refetch per upload)',
    from: "      if (handle !== null) timers.clear(handle)\n      handle = timers.set(", to: "      handle = timers.set(" },
  { name: 'cancel does not clear the timer (album A refetches over album B)',
    from: "    cancel() {\n      if (handle !== null) timers.clear(handle)\n      handle = null", to: "    cancel() {\n      handle = null" },
  { name: 'cancel forgets the handle but a later request cannot replace the still-live timer',
    from: "    cancel() {\n      if (handle !== null) timers.clear(handle)\n      handle = null\n    },", to: "    cancel() {\n    }," },
  { name: 'the handle is never released after firing',
    from: "      handle = timers.set(() => { handle = null; action() }, config.delayMs)", to: "      handle = timers.set(() => { action() }, config.delayMs)" },
  { name: 'the delay is ignored',
    from: "      handle = timers.set(() => { handle = null; action() }, config.delayMs)", to: "      handle = timers.set(() => { handle = null; action() }, 0)" },
  ],
}
