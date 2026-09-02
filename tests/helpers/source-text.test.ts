import { describe, it, expect } from 'vitest'
import { stripJsComments, stripSqlComments, stripMockPaths } from './source-text'

// THE MACHINERY FOUR GUARDS DEPEND ON, TESTED ON ITS OWN.
//
// These strippers decide what tests/architecture.test.ts, tests/album-video-seconds.test.ts and
// tests/upload-policy.test.ts are allowed to see when they read source as evidence. A hole in one of
// them does not fail — it makes a guard report "all clear" from a blind spot, which is the outcome
// architecture.test.ts itself calls worse than not having the rule (rule 20).
//
// Literal inputs only, so nothing here drifts with the repo's contents.

const NL = String.fromCharCode(10)   // never an escape: rule 24, and this file is scanned for them

describe('a comment can never answer a grep', () => {
  it('removes line and block comments from JS', () => {
    expect(stripJsComments('// see @/lib/x for why')).not.toContain('@/lib/x')
    expect(stripJsComments('/* @/lib/x is stubbed */')).not.toContain('@/lib/x')
    expect(stripJsComments(`/*${NL} @/lib/x${NL}*/`)).not.toContain('@/lib/x')
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
