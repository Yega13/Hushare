// Mutation set for src/lib/use-on-value-change.ts -- run with:
//   node scripts/mutations/run.mjs use-on-value-change
//
// THE RESET THAT RUNS WHEN THE LIGHTBOX MOVES TO ANOTHER PHOTO. Two ways to be wrong, and both are
// silent: the reset never happens, so the new photo wears the old one's zoom, flip and offset; or it
// happens on every render, which is an infinite loop. The guard is mutated in both directions, and
// the NaN case is here because `!==` on a failed measurement hangs the render rather than failing it.
export default {
  file: 'src/lib/use-on-value-change.ts',
  test: 'tests/use-on-value-change.test.tsx',
  mutations: [
  { name: 'THE RESET NEVER RUNS: the next photo keeps the previous one state',
    from: "  if (!Object.is(value, seen)) {", to: "  if (false) {" },
  { name: 'the reset runs on EVERY render, so nothing can be changed at all',
    from: "  if (!Object.is(value, seen)) {", to: "  if (true) {" },
  { name: 'equality by ===, so a NaN measurement restarts the render forever',
    from: "  if (!Object.is(value, seen)) {", to: "  if (value !== seen) {" },
  { name: 'the guard is never updated, so the render restarts forever',
    from: "    setSeen(value)\n", to: "" },
  { name: 'the callback is never called -- only the guard moves',
    from: "    onChange(value, seen)\n", to: "" },
  { name: 'the callback is handed the new value as its previous one',
    from: "    onChange(value, seen)", to: "    onChange(value, value)" },
  { name: 'the state is seeded with something other than the first value, so it resets on mount',
    from: "  const [seen, setSeen] = useState<T>(value)", to: "  const [seen, setSeen] = useState<T>(undefined as T)" },
  ],
}
