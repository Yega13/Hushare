import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'

// NO INVISIBLE CONTROL CHARACTERS IN SOURCE.
//
// This has now shipped twice, both times inside a regular expression, both times because a `\b` or
// a `\0` was written through something that treated the backslash as its own escape. The result is
// a pattern containing a LITERAL backspace or NUL byte: it compiles, it type-checks, it matches
// nothing, and it is invisible in a diff, in grep output and in a code review. The first lived in
// api/log/engagement until it broke grep; the second turned a translation detector into a regex
// that could never fire.
//
// A character nobody can see is not something to be careful about — it is something to make
// impossible.
//
// CHECKED BY CODE POINT, NOT BY A REGEX. The obvious version of this test is a character class of
// escapes, and writing THAT file put the forbidden bytes straight into the test itself, which then
// failed on its own source. Numbers cannot be mangled on the way to disk, so numbers are what this
// uses — there is not one escape sequence in this file.
const TAB = 9
const LINE_FEED = 10
const CARRIAGE_RETURN = 13
const SPACE = 32
const DELETE = 127

// Zero-width and bidirectional marks: not control characters, but equally invisible, and they
// arrive by pasting from documents and chat. A zero-width space inside an identifier is its own
// afternoon.
const INVISIBLE_MARKS = new Set([
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, // zero-width space/non-joiner/joiner, LTR/RTL marks
  0x2028, 0x2029, // line/paragraph separators
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, // bidi embedding/override
  0xfeff, // byte-order mark, flagged even as the first byte: a BOM ahead of a 'use client'
          // directive is a known way to make a bundler stop recognising it, and nothing in
          // this repo needs one. src/components/BrandPreloader.tsx carried one for months.
])

function firstInvisible(source: string): { index: number; code: number } | null {
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i)
    if (code === TAB || code === LINE_FEED || code === CARRIAGE_RETURN) continue
    if (code < SPACE || code === DELETE) return { index: i, code }
    if (INVISIBLE_MARKS.has(code)) return { index: i, code }
  }
  return null
}

const ROOTS = ['src', 'tests', 'scripts']
const EXTENSIONS = /\.(ts|tsx|mjs|css)$/

function walk(dir: string, out: string[] = []): string[] {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (EXTENSIONS.test(entry.name)) out.push(full)
  }
  return out
}

describe('source files contain no invisible characters', () => {
  const files = ROOTS.flatMap((root) => walk(join(process.cwd(), root)))

  it('scans a meaningful number of files', () => {
    // A guard on the guard: an empty file list would make the assertion below pass while checking
    // nothing, which is the exact failure mode this file exists to prevent.
    expect(files.length).toBeGreaterThan(50)
  })

  // 30s, not the 5s default: this walks and reads EVERY source file, which is disk I/O that
  // slows with machine load, not with the code under test. It timed out at 8s during a fully
  // parallel run on a busy machine while passing in 200ms alone — a flake that would teach
  // people to re-run red suites until green, which is how real failures start being ignored.
  it('has no file carrying one', () => {
    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const found = firstInvisible(source)
      if (!found) continue
      const line = source.slice(0, found.index).split('\n').length
      const hex = found.code.toString(16).toUpperCase().padStart(4, '0')
      offenders.push(`${file.split(sep).slice(-3).join('/')}:${line} contains U+${hex}`)
    }
    expect(
      offenders,
      'Invisible character in source. It is almost always a backslash escape that a shell, ' +
        'heredoc or editor interpreted before the file reached disk — check the regex or string ' +
        'literal on that line and write the escape so it survives.',
    ).toEqual([])
  }, 30_000)
})

// PAGINATION MUST BE ORDERED. `.range()` without `.order()` is not pagination — it is two
// independent queries, and Postgres is free to return them in different orders.
//
// A row can therefore land in NEITHER page and be skipped silently. Found on 2026-08-28 in
// src/lib/album-delete.ts, which pages through an album's photos to collect the R2 objects and
// Stream videos to delete: a skipped row meant its file was never deleted, and the album row was
// removed moments later, so nothing was left pointing at it. Billed forever, unfindable.
//
// Reachable today — it only bites past the 1000-row page size, and the largest live album is 1,378.
describe('every paginated read is ordered', () => {
  const files = ROOTS.flatMap((root) => walk(join(process.cwd(), root)))

  it('has no .range() without a preceding .order()', () => {
    const offenders: string[] = []
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        // A CHAINED CALL, not the characters ".range(" anywhere on the line. Substring matching
        // flagged two false positives in a row: first the comment written above the fix (which
        // quotes ".range()" to explain the rule) and then this test's own source. A real query
        // chain in this codebase always puts the call at the start of its own line.
        const code = line.trim()
        if (!code.startsWith('.range(')) return
        // The order() may sit a few lines above in the same query chain.
        const window = lines.slice(Math.max(0, i - 8), i + 1).join('\n')
        if (window.includes('.order(')) return
        offenders.push(`${file.split(sep).slice(-3).join('/')}:${i + 1}`)
      })
    }
    expect(
      offenders,
      'A .range() with no .order() can skip rows entirely. Add a stable order — the primary key ' +
        'is always safe — or the page boundary is undefined.',
    ).toEqual([])
  })
})
