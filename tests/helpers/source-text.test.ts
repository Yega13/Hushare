import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripJsComments, stripSqlComments, stripMockPaths } from './source-text'

// THE MACHINERY FOUR GUARDS DEPEND ON, TESTED ON ITS OWN.
//
// These strippers decide what tests/architecture.test.ts, tests/album-video-seconds.test.ts and
// tests/upload-policy.test.ts are allowed to see when they read source as evidence. A hole in one of
// them does not fail — it makes a guard report "all clear" from a blind spot, which is the outcome
// architecture.test.ts itself calls worse than not having the rule (rule 20).
//
// Literal inputs only, so nothing here drifts with the repo's contents.

const NL = String.fromCharCode(10)
const SEP = String.fromCharCode(92)   // the path separator here; never written as an escape (rule 24)

describe('a comment can never answer a grep', () => {
  it('removes line and block comments from JS', () => {
    expect(stripJsComments('// see @/lib/x for why')).not.toContain('@/lib/x')
    expect(stripJsComments('/* @/lib/x is stubbed */')).not.toContain('@/lib/x')
    expect(stripJsComments(`/*${NL} @/lib/x${NL}*/`)).not.toContain('@/lib/x')
  })

  it('a MULTI-LINE template is copied whole: it does not end at a newline the way a string does', () => {
    // The one line that separates a phantom string (one line lost) from a phantom template
    // (hundreds). A reviewer deleted it and every test stayed green.
    const src = `const t = ${'`'}line one${NL}  // not a comment, this is template text${NL}${'`'}${NL}const keep = 1`
    expect(stripJsComments(src)).toContain('not a comment')
    expect(stripJsComments(src)).toContain('const keep = 1')
  })

  it('an UNTERMINATED string ends at its line, so it cannot swallow the file', () => {
    const src = `const bad = 'oops${NL}const keep = 1 // gone${NL}`
    expect(stripJsComments(src)).toContain('const keep = 1')
    expect(stripJsComments(src)).not.toContain('gone')
  })

  it('a regex literal is not a comment, however many slashes it holds', () => {
    // A backtick inside a character class opened a phantom template in a live file; an escaped
    // slash truncated ten more lines. Both are regex literals the scanner must consume whole.
    expect(stripJsComments("const r = /[`\s]+$/; const keep = 1")).toContain('const keep = 1')
    expect(stripJsComments(String.raw`const u = /^https?:\/\//; const keep = 1`)).toContain('const keep = 1')
    expect(stripJsComments('const c = /[/]/; const keep = 1')).toContain('const keep = 1')
    // ...and division is still division.
    expect(stripJsComments('const half = total / 2 // gone')).toContain('total / 2')
    expect(stripJsComments('const half = total / 2 // gone')).not.toContain('gone')
  })

  it('leaves real code alone, including a trailing comment line', () => {
    // If this ever fails, every module reads as untested and the debt-register rule INVERTS.
    expect(stripJsComments("import { x } from '@/lib/x' // fine")).toContain('@/lib/x')
    expect(stripJsComments("const u = 'https://hushare.space'")).toContain('hushare.space')
  })

  it('removes a TRAILING SQL comment, not only a whole-line one', () => {
    // The gap that mattered. A whole-line strip leaves this, and it still answers a
    // toContain("media_type = 'video'") assertion while the real filter is gone:
    const sneaky = "  and true -- and media_type = 'video'"
    expect(stripSqlComments(sneaky)).not.toContain('media_type')
    expect(stripSqlComments(sneaky)).toContain('and true')
  })

  it('removes a whole-line SQL comment too', () => {
    expect(stripSqlComments(`-- select 1 from photos where media_type = 'video'${NL}select 2`))
      .not.toContain('media_type')
  })
})

describe('a mocked module is never counted as a tested one', () => {
  it('strips the ordinary forms', () => {
    expect(stripMockPaths("vi.mock('@/lib/x', () => ({}))")).not.toContain('@/lib/x')
    expect(stripMockPaths('vi.mock("@/lib/x")')).not.toContain('@/lib/x')
    expect(stripMockPaths("vi.doMock('@/lib/x', () => ({}))")).not.toContain('@/lib/x')
    expect(stripMockPaths(`vi.mock(${NL}  '@/lib/x',${NL}  () => ({}),${NL})`)).not.toContain('@/lib/x')
  })

  it("strips vitest's own type-safe import() form", () => {
    // THE BLIND SPOT. The previous regex required a quote immediately after `(`, so this — the form
    // vitest's docs recommend for type safety, supported since 2.1, and this repo is on 4.1.11 —
    // went straight through with the path intact. A brand-new src/lib module with no test of its own
    // would then have passed the debt-register rule purely because some OTHER test stubbed it.
    expect(stripMockPaths("vi.mock(import('@/lib/x'))")).not.toContain('@/lib/x')
    expect(stripMockPaths("vi.mock(import('@/lib/x'), () => ({}))")).not.toContain('@/lib/x')
    expect(stripMockPaths("vi.mock(await import('@/lib/x'))")).not.toContain('@/lib/x')
  })

  it('strips unmock as well', () => {
    expect(stripMockPaths("vi.unmock('@/lib/x')")).not.toContain('@/lib/x')
    expect(stripMockPaths("vi.doUnmock('@/lib/x')")).not.toContain('@/lib/x')
  })

  it('leaves a REAL import standing', () => {
    // The direction that matters most: over-stripping would make every module read as untested,
    // which fails loudly; under-stripping is the silent one.
    expect(stripMockPaths("import { x } from '@/lib/x'")).toContain('@/lib/x')
    expect(stripMockPaths("const { y } = await import('@/lib/x')")).toContain('@/lib/x')
  })
})

// THE WHOLE-REPO GUARD. Every blind spot this helper has had was a comment SURVIVING the strip in
// one particular file, and each was found only when something else broke: a `/*` inside a line
// comment erased 622 lines of UploadZone, and a backtick inside a regex character class opened a
// phantom template that copied 77 lines of the support-chat route out with their comments intact.
// Neither was reachable by an example-based test, because neither shape had been imagined. So this
// runs the stripper over every source file in the repository and asserts the property directly.
describe('stripJsComments over the whole repository', () => {
  const roots = ['src', 'tests', 'scripts']
  function files(dir: string): string[] {
    const out: string[] = []
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) out.push(...files(full))
      else if (/\.(ts|tsx|mjs)$/.test(e.name)) out.push(full)
    }
    return out
  }
  const all = roots.flatMap((r) => files(join(process.cwd(), r)))

  it('scans a real number of files (a broken walker would assert nothing)', () => {
    expect(all.length).toBeGreaterThan(300)
  })

  it('leaves NO comment line standing, in any file', () => {
    const survivors: string[] = []
    for (const f of all) {
      const stripped = stripJsComments(readFileSync(f, 'utf8'))
      stripped.split(NL).forEach((line, i) => {
        // A line whose first non-space characters are `//`. Inside a template literal that is
        // legitimate text, so a handful of files carry one on purpose -- but not many, and never
        // in a file a guard reads. The count is what matters: a phantom string or template shows
        // up as dozens at once.
        if (/^\s*\/\//.test(line)) survivors.push(`${f.replace(process.cwd(), '').split(SEP).join('/')}:${i + 1}`)
      })
    }
    // The only legitimate survivors are lines inside a TEMPLATE LITERAL that holds source code to
    // be injected elsewhere -- they are string content, not this file's comments. Listed exactly,
    // so a new one fails: a phantom string or template shows up as a burst of them at once.
    expect(survivors, 'comment lines that survived stripping').toEqual([
      '/scripts/patch-opennext.mjs:101',
      '/scripts/patch-opennext.mjs:102',
      '/scripts/patch-opennext.mjs:103',
      '/scripts/patch-opennext.mjs:104',
    ])
  })

  it('deletes no line of plain code (the quieter direction, and how the truncation hid)', () => {
    // Restricted to lines that carry no comment or regex syntax at all, so they cannot legitimately
    // be shortened: whatever they hold must still be in the output somewhere. Line NUMBERS shift
    // when a block comment collapses, so membership is the assertion, not position. This is what a
    // phantom comment erasing hundreds of lines looks like from the outside.
    const lost: string[] = []
    for (const f of all) {
      const text = readFileSync(f, 'utf8')
      const kept = new Set(stripJsComments(text).split(NL).map((l) => l.trim()))
      text.split(NL).forEach((line, i) => {
        const t = line.trim()
        // Plain code only: no comment or quote syntax anywhere on it, and ENDING in a statement
        // terminator or a brace. Prose wrapped inside a block comment carries no marker of its own
        // and can contain anything, but it does not end that way -- and the erasure this guards
        // against takes hundreds of ordinary statements with it, so the sample stays large.
        if (!t || t.length < 8 || /[/*`'"]/.test(t) || !/[;{}]$/.test(t)) return
        if (!kept.has(t)) lost.push(`${f.replace(process.cwd(), '')}:${i + 1} ${t.slice(0, 40)}`)
      })
    }
    expect(lost, 'plain code lines the stripper lost').toEqual([])
  })
})
