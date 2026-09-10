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
 * A SCANNER, not a pipeline of regexes, and it tracks REGEX LITERALS -- which is not fussiness.
 * Two live blind spots came from not doing it:
 *
 *   * stripping block comments before line comments let `// accept="video/*"` in UploadZone open a
 *     block that ran 622 lines to the next closing marker, erasing everything between from every
 *     guard that reads that file;
 *   * a backtick inside a regex character class -- `.replace(/[`\s]+$/, '')` in the support-chat
 *     route -- opened a phantom TEMPLATE, and a template does not end at a newline, so 77 lines
 *     were copied out verbatim WITH their comments. That is the "a comment answers the grep"
 *     failure this helper exists to prevent (three occurrences, MISTAKES 21), through a new door.
 *
 * So: one pass that knows whether it is inside a string, a template, a regex literal, a line
 * comment or a block comment. A `/` starts a regex when the last significant character cannot end
 * an expression (`(`, `,`, `=`, `:`, an operator, a `{`), and is division otherwise -- the standard
 * heuristic. It misreads a regex that FOLLOWS an expression-ending token -- `return /^x$/.test(s)`
 * and `if (f(x)) /^y$/.test(s)` both look like division -- and two such lines exist today
 * (api/album/background/route.ts, lib/album-delete.ts). The cost is usually a truncated line,
 * which is loud; but if such a regex contained a backtick the scanner would open a phantom
 * template and keep every comment to the end of the file, which is the silent direction. What
 * actually holds this closed is not the heuristic: it is the whole-repo property test below.
 *
 * DIRECTION OF ERROR, deliberately chosen: keeping a comment is the failure that makes a guard read
 * prose and pass; deleting real code makes a guard report something absent, which fails loudly
 * (rule 19). tests/helpers/source-text.test.ts holds BOTH directions over every file in the repo.
 */
export function stripJsComments(src: string): string {
  let out = ''
  let i = 0
  const n = src.length
  /** The last character that was code, ignoring whitespace: what decides regex versus division. */
  let lastSignificant = ''
  while (i < n) {
    const c = src[i]
    const next = src[i + 1]
    if (c === '"' || c === "'" || c === '`') {
      // A string or template, copied verbatim, escapes honoured, up to the matching quote. A plain
      // string also ends at a newline: an unterminated one must not swallow the rest of the file.
      const quote = c
      let j = i + 1
      while (j < n && src[j] !== quote) {
        if (src[j] === '\\') j++
        else if (quote !== '`' && src[j] === '\n') break
        j++
      }
      out += src.slice(i, j + 1)
      i = j + 1
      lastSignificant = quote
      continue
    }
    if (c === '/' && next === '/') {
      // A URL is not a comment: `https://x` has its ':' IMMEDIATELY before the slashes. The last
      // SIGNIFICANT character is the wrong test -- a `case 'x':` label sits behind every comment
      // on the following line, and eleven real comments survived the strip that way.
      if (src[i - 1] === ':') { out += c; i++; continue }
      let j = i
      while (j < n && src[j] !== '\n') j++
      i = j
      continue
    }
    if (c === '/' && next === '*') {
      // Replaced by one space, so the tokens either side stay apart.
      const end = src.indexOf('*/', i + 2)
      out += ' '
      i = end === -1 ? n : end + 2
      lastSignificant = ' '
      continue
    }
    if (c === '/' && !CAN_END_EXPRESSION.test(lastSignificant)) {
      // A regex literal: copied verbatim to its closing slash. Inside a character class a slash is
      // literal, which is how `/[/]/` and `/^https?:\/\//` reach their real end.
      let j = i + 1
      let inClass = false
      while (j < n) {
        const d = src[j]
        if (d === '\\') { j += 2; continue }
        if (d === '\n') break               // an unterminated regex: it was division after all
        if (d === '[') inClass = true
        else if (d === ']') inClass = false
        else if (d === '/' && !inClass) break
        j++
      }
      out += src.slice(i, j + 1)
      i = j + 1
      lastSignificant = '/'
      continue
    }
    out += c
    i++
    if (!/\s/.test(c)) lastSignificant = c
  }
  return out
}

/** Characters that can END an expression, so a `/` after one of them is division, not a regex. */
const CAN_END_EXPRESSION = /[\w$)\]'"`]/

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
