import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripJsComments } from './helpers/source-text'

// THE MODULE IS PROVEN. THIS PINS THE TWO LINES THAT DECIDE WHETHER IT RUNS.
//
// lib/search-answer.ts has 24 tests and a mutation set in which all nine mutations are killed. None
// of that says anything about the call site — and the call site is where the runner's screen is
// actually decided. Measured on 2026-09-07, before this file existed:
//
//     AlbumPageClient.tsx:  indexComplete: true          (hardcoded, replacing the real call)
//     result:               38 tests passed
//
// That single-token change reinstates the entire bug the indexing state was added for: the album
// always looks fully read, 'indexing' can never be returned, and the grid states absence over a
// half-read album exactly as before. AGENTS.md MISTAKES entry 10 is this failure recorded four
// times already — "extracting logic into src/lib moves the thing I can test and leaves behind the
// thing that decides whether it runs".
//
// WHAT THIS ASSERTS, and what it deliberately does not. It does not pin variable names or
// formatting; renaming bibIndexedCount is a refactor, not a regression. It asserts only that each
// input to searchPhase is DERIVED — a call or a property read — rather than a constant. A literal
// there is the whole failure mode, because a constant cannot be wrong at runtime and therefore
// cannot be caught by any test of the module.
//
// Comments are stripped first (see helpers/source-text): three guards in this suite have already
// been defeated by prose in the file they were searching.

const SOURCE = join(process.cwd(), 'src', 'app', '[slug]', 'AlbumPageClient.tsx')

/** The argument object of the single `searchPhase({ ... })` call, comments removed. */
function searchPhaseCall(): string {
  const src = stripJsComments(readFileSync(SOURCE, 'utf8'))
  const start = src.indexOf('searchPhase({')
  expect(start, 'AlbumPageClient must call searchPhase({...}) exactly once').toBeGreaterThan(-1)
  expect(
    src.indexOf('searchPhase({', start + 1),
    'a second searchPhase call means this guard is only pinning one of them',
  ).toBe(-1)
  const end = src.indexOf('})', start)
  expect(end, 'could not find the end of the searchPhase call').toBeGreaterThan(start)
  return src.slice(start, end)
}

/**
 * The expression a given key is assigned, inside that call.
 *
 * Reads to END OF LINE, not to the first comma. The first version stopped at a comma and so
 * truncated `indexComplete(bibIndexedCount, totalImageCount)` to `indexComplete(bibIndexedCount` —
 * which failed against correct code and would have been "fixed" by weakening the assertion. Each
 * property in this call sits on its own line, which is what makes end-of-line the right boundary.
 */
function valueOf(call: string, key: string): string {
  const m = new RegExp(`\\b${key}\\s*:\\s*([^\\n]+)`).exec(call)
  expect(m, `searchPhase is not passed ${key} at all`).not.toBeNull()
  return (m as RegExpExecArray)[1].trim().replace(/,$/, '')
}

describe('the album page actually feeds searchPhase real values', () => {
  const LITERALS = ['true', 'false', 'null', 'undefined', '0', "''", '""']

  it('passes a DERIVED indexComplete, not a constant', () => {
    // The exact mutation that survived 38 tests. `indexComplete: true` means the page can never
    // report a half-read album, which is the state that exists for most of a live race.
    const value = valueOf(searchPhaseCall(), 'indexComplete')
    expect(LITERALS, `indexComplete is hardcoded as ${value}`).not.toContain(value)
    expect(
      value.includes('('),
      'indexComplete must be computed from the album counts, not asserted',
    ).toBe(true)
  })

  it('passes a DERIVED excludedByAlbum, not a constant', () => {
    // `excludedByAlbum: false` reinstates the live defect in one token: an out-of-range number goes
    // back to being reported as "No photos with that number" about a search that never ran.
    const value = valueOf(searchPhaseCall(), 'excludedByAlbum')
    expect(LITERALS, `excludedByAlbum is hardcoded as ${value}`).not.toContain(value)
    expect(value, 'it must be computed from the album range').toContain('(')
  })

  it('passes a DERIVED answerIsEmpty, not a constant', () => {
    // The mirror mutation: `answerIsEmpty: false` also disables the gate, because the indexing
    // branch requires BOTH an empty answer and an incomplete index.
    const value = valueOf(searchPhaseCall(), 'answerIsEmpty')
    expect(LITERALS, `answerIsEmpty is hardcoded as ${value}`).not.toContain(value)
  })

  it('still passes the three inputs the earlier bugs were about', () => {
    // Regression cover for the original defect: query/answeredQuery/failedQuery are what make the
    // phase describe THIS number rather than an older one.
    const call = searchPhaseCall()
    for (const key of ['query', 'answeredQuery', 'failedQuery']) {
      expect(LITERALS).not.toContain(valueOf(call, key))
    }
  })

  it('gates on the SERVER stats, never the loaded-window fallback', () => {
    // THE HOLE A REVIEW FOUND, pinned so it cannot be reopened by a helpful refactor.
    //
    // bibIndexedCount/totalImageCount fall back to counting the loaded window when the server's
    // figures have not arrived — and albums default to oldest-first, so that window is exactly the
    // photos OCR finished first and reads as 100% indexed. Feeding those to the gate licenses "No
    // photos with that number" on a half-read album, which is the bug the gate exists to stop.
    //
    // The stats request is also fetched ONLY when the box is empty and is aborted by the first
    // keystroke, so absent stats are the common case during a search, not a rare one.
    const indexArg = valueOf(searchPhaseCall(), 'indexComplete')
    for (const fallback of ['bibIndexedCount', 'totalImageCount']) {
      expect(
        indexArg,
        `the gate must not read ${fallback} — it is a guess derived from the loaded window`,
      ).not.toContain(fallback)
    }
    expect(indexArg, 'the gate must read the server stats').toContain('bibStats')
  })

  it('still hands the display counts to the bar, derived exactly once', () => {
    // The bar's "Still reading photos (x of y)" hint keeps the merged counts — it is displaying
    // them, not gating on them. What must not happen is a second derivation drifting from this one.
    const src = stripJsComments(readFileSync(SOURCE, 'utf8'))
    for (const name of ['bibIndexedCount', 'totalImageCount']) {
      expect(
        (src.match(new RegExp(`const ${name}\\s*=`, 'g')) ?? []).length,
        `${name} must be derived exactly once`,
      ).toBe(1)
      expect(src, `the bar must receive ${name}`).toContain(`={${name}}`)
    }
  })
})
