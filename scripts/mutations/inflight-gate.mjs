// Mutation set for src/lib/inflight-gate.ts -- run with: node scripts/mutations/run.mjs inflight-gate
export default {
  file: 'src/lib/inflight-gate.ts',
  test: 'tests/inflight-gate.test.ts',
  mutations: [
  { name: 'the second call does not wait (no chain)',
    from: "  const result = prev ? prev.then(run) : new Promise<T>((resolve) => resolve(run()))\n",
    to: "  const result = new Promise<T>((resolve) => resolve(run()))\n" },
  { name: 'the idle path also waits a microtask (the request no longer leaves in the tick it was planned)',
    from: "prev ? prev.then(run) : new Promise<T>((resolve) => resolve(run()))",
    to: "(prev ?? Promise.resolve()).then(run)" },
  { name: 'a failed run blocks the key forever',
    from: "  const tail = result.then(() => undefined, () => undefined)\n", to: "  const tail = result.then(() => undefined)\n" },
  { name: 'the tail is never recorded (every call runs at once)',
    from: "  tails.set(key, tail)\n", to: "" },
  { name: 'keys share one queue',
    from: "  const prev = tails.get(key)\n", to: "  const prev = Array.from(tails.values()).pop()\n" },
  { name: 'forgetting the key forgets a newer queue too',
    from: "    if (tails.get(key) === tail) tails.delete(key)\n", to: "    tails.delete(key)\n" },
  { name: 'the key is never forgotten',
    from: "    if (tails.get(key) === tail) tails.delete(key)\n", to: "\n" },
  ],
}
