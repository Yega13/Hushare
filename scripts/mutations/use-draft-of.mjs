// Mutation set for src/lib/use-draft-of.ts -- run with:
//   node scripts/mutations/run.mjs use-draft-of
//
// A FIELD SOMEBODY IS TYPING IN, WHOSE VALUE CAN ALSO CHANGE UNDERNEATH THEM. Two requirements that
// pull against each other, and each mutation below breaks exactly one of them: the draft is
// overwritten while it is being typed, or it stops following the real value and the field silently
// shows something that is no longer true.
//
// The render-time adjustment is the part that looks alarming and is not. Its guard is the only
// thing between it and an infinite render loop, so that guard is mutated in both directions.
export default {
  file: 'src/lib/use-draft-of.ts',
  test: 'tests/use-draft-of.test.tsx',
  mutations: [
  { name: 'THE DRAFT STOPS FOLLOWING THE SOURCE, so the field shows a value that is no longer true',
    from: "  if (!Object.is(source, seen)) {", to: "  if (false) {" },
  { name: 'the draft is reset on EVERY render, so nothing can be typed at all',
    from: "  if (!Object.is(source, seen)) {", to: "  if (true) {" },
  { name: 'the guard is never updated, so the render restarts forever',
    from: "    setSeen(source)\n", to: "" },
  { name: 'the draft is not reset when the source changes -- only the guard moves',
    from: "    setDraft(toDraft(source))\n", to: "" },
  { name: 'equality by ===, so a NaN source restarts the render forever',
    from: "  if (!Object.is(source, seen)) {", to: "  if (source !== seen) {" },
  { name: 'the draft is seeded from the raw source rather than formatted',
    from: "  const [draft, setDraft] = useState<D>(() => toDraft(source))",
    to: "  const [draft, setDraft] = useState<D>(source as unknown as D)" },
  { name: 'the formatter is ignored on the follow, so the field shows the unformatted value',
    from: "    setDraft(toDraft(source))", to: "    setDraft(source as unknown as D)" },
  // NOT MUTATED -- seeding the guard with anything but the source is OUTPUT-IDENTICAL. The first
  // render adjusts and restarts for a value it already had, which costs one wasted pass on mount
  // and shows nothing different: React restarts before committing, so there is no DOM state to
  // catch. Every way of counting renders from inside a component is itself what
  // react-hooks/globals, /immutability and /refs forbid, and a test that breaks the rules this
  // module exists to respect proves nothing. What IS pinned is that the module contains no effect
  // at all -- see "the module contains no effect" in the test file.
  { name: 'the setter is not returned, so nothing can be typed',
    from: "  return [draft, setDraft]", to: "  return [draft, () => {}]" },
  ],
}
