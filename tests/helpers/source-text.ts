// READING SOURCE AS EVIDENCE, WITHOUT LETTING THE PROSE ANSWER.
//
// Several guards in this suite work by grepping a source file: which modules are stubbed rather than
// tested, which SQL a migration really runs, where a classifier is called from. Every one of them has
// now been defeated the same way — by a COMMENT in the file it was searching:
//
//   * tests/architecture.test.ts explained that mocking @/lib/report-server-error must not count as
//     coverage, and the explanation's own mention of the path marked it covered;
//   * tests/error-spike-email.test.ts asserted toContain('23') against a fixture whose slug was
//     abc123, so the assertion was answered by the link;
//   * the album_video_seconds migration opens by quoting the query it replaces, so deleting the real
//     `media_type = 'video'` filter left the test green — the header answered for it.
//
// Three occurrences in one day (MISTAKES entry 21). The lesson is not "write better comments", it is
// that a grep over a file has to be scoped to the thing it means to inspect. These helpers do the
// scoping, in one place, so a fix to one of them fixes all four callers (rule 13).
//
// DIRECTION OF ERROR, deliberately chosen: both strippers only ever REMOVE text. So a mistake here
// makes a guard report something as untested/absent — which fails loudly and gets looked at — rather
// than silently passing something that should have failed (rule 19).

/**
 * JavaScript/TypeScript source with comments removed.
 *
 * The `[^:]` guard before `//` keeps `https://` inside a string literal from being treated as the
 * start of a comment. A URL later in such a line still gets clipped; nothing that uses this searches
 * for one.
 */
export function stripJsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * SQL source with comments removed — TRAILING ones too.
 *
 * A whole-line strip (`^\s*--.*$`) is not enough, and the gap is not theoretical: it leaves
 *
 *     and true -- and media_type = 'video'
 *
 * which still answers a `toContain("media_type = 'video'")` assertion while the real filter is gone.
 * That is the migration-header bug moved one line to the right.
 */
export function stripSqlComments(src: string): string {
  return src.replace(/--[^\n]*/g, '')
}

/**
 * Test source with every `vi.mock(...)` / `vi.doMock(...)` / `vi.unmock(...)` MODULE PATH removed.
 *
 * MOCKING A MODULE IS NOT TESTING IT. `vi.mock('@/lib/x')` replaces x with a stub so something else
 * can be tested; it asserts nothing whatsoever about x. Counting those references marked
 * lib/report-server-error "tested, take it off the register" the moment an unrelated test stubbed it.
 *
 * IT ACCEPTS A CALL EXPRESSION, NOT JUST A QUOTE, and that is the fix for a real blind spot. The
 * previous version required a quote immediately after `(`, so vitest's own recommended type-safe
 * form — `vi.mock(import('@/lib/x'))`, supported since 2.1, and this repo is on 4.1.11 — sailed
 * through with the path intact and would have marked a brand-new untested module as covered. So did
 * `vi.mock(await import('...'))` and `vi.unmock('...')`. Verified by running the old regex against
 * all three before changing it.
 */
export function stripMockPaths(src: string): string {
  return src.replace(
    // `[uU]n` because vitest spells it `unmock` on its own and `doUnmock` when prefixed — a
    // lowercase-only `un` matched the first and missed the second, which the helper's own test
    // caught on its first run.
    /\bvi\s*\.\s*(?:do)?[uU]?n?[Mm]ock(?:Require)?\s*\(\s*(?:await\s+)?(?:import\s*\(\s*)?(['"`])(?:[^'"`\\]|\\.)*\1/g,
    "vi.mock('<stubbed>'",
  )
}
