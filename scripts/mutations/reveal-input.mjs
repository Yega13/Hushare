// Mutation set for src/lib/reveal-input.ts -- run with: node scripts/mutations/run.mjs reveal-input
export default {
  file: 'src/lib/reveal-input.ts',
  test: 'tests/reveal-input.test.ts',
  mutations: [
  { name: 'month is not offset (January shows as 00)',
    from: "${pad(d.getMonth() + 1)}", to: "${pad(d.getMonth())}" },
  { name: 'no zero-padding',
    from: "  const pad = (n: number) => String(n).padStart(2, '0')", to: "  const pad = (n: number) => String(n)" },
  { name: 'an invalid stored timestamp renders as NaN text instead of empty',
    from: "  if (isNaN(d.getTime())) return ''\n  const pad", to: "  const pad" },
  { name: 'an invalid input is sent anyway (the Saving... forever bug)',
    from: "  if (isNaN(parsed.getTime())) return { ok: false, error: 'invalid' }\n", to: "" },
  { name: 'a clear sends the current input instead of null',
    from: "  if (action === 'clear' || !input) return { ok: true, revealAt: null }", to: "  if (!input) return { ok: true, revealAt: null }" },
  { name: 'an empty set is refused instead of clearing',
    from: "  if (action === 'clear' || !input) return { ok: true, revealAt: null }", to: "  if (action === 'clear') return { ok: true, revealAt: null }" },
  { name: 'the exact instant counts as future',
    from: "  return at > now ? 'future' : 'past'", to: "  return at >= now ? 'future' : 'past'" },
  { name: 'an unparseable reveal counts as future (album sealed forever)',
    from: "  if (isNaN(at.getTime())) return 'none'\n", to: "" },
  ],
}
