import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripJsComments } from './helpers/source-text'

// THE MODULES ARE PROVEN. THIS PINS THE LINES THAT DECIDE WHETHER THEY RUN.
//
// lib/resolve-outcome and lib/grid-visibility each have tests and a mutation set. Neither says
// anything about the call site, and MISTAKES entry 10 is that failure recorded four times:
// "extracting logic into src/lib moves the thing I can test and leaves behind the thing that
// decides whether it runs". A call site passing `true` for `res.ok`, or `[]` for the photos, is
// green in every module test and wrong on every album.
//
// As in album-page-search-wiring.test.ts: names are not pinned, derivation is. Each argument must
// be a property read or a call, never a literal. Comments are stripped first.

const SOURCE = join(process.cwd(), 'src', 'app', '[slug]', 'AlbumPageClient.tsx')
const src = () => stripJsComments(readFileSync(SOURCE, 'utf8'))

function singleCall(text: string, marker: string): string {
  const start = text.indexOf(marker)
  expect(start, `AlbumPageClient must call ${marker} exactly once`).toBeGreaterThan(-1)
  expect(text.indexOf(marker, start + 1), `a second ${marker} call means this guard pins only one of them`).toBe(-1)
  // The call's argument list, up to the matching close paren.
  let depth = 0
  for (let i = start + marker.length - 1; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') { depth--; if (depth === 0) return text.slice(start, i + 1) }
  }
  throw new Error(`unbalanced call at ${marker}`)
}

describe('AlbumPageClient wires the resolve outcome from the real response', () => {
  it('classifyResolve gets the status, the ok flag, and the parsed body -- no literals', () => {
    const call = singleCall(src(), 'classifyResolve(')
    expect(call).toMatch(/classifyResolve\(\s*res\.status\s*,\s*res\.ok\s*,\s*\w+\s*\)/)
    expect(call).not.toMatch(/\b(true|false|\d{3})\b/)
  })
  it('every outcome kind is handled, and only the album kind falls through', () => {
    const text = src()
    for (const kind of ['not-found', 'error', 'password', 'reveal', 'album']) {
      expect(text, `outcome '${kind}' has no case`).toContain(`case '${kind}':`)
    }
    // The gate cases must set the gate the outcome carries, not something else.
    expect(text).toMatch(/case 'password':\s*setPasswordGate\(\{\s*slug:\s*outcome\.slug/)
    expect(text).toMatch(/case 'reveal':\s*setRevealGate\(\{\s*revealAt:\s*outcome\.revealAt/)
  })
})

describe('AlbumPageClient wires the grid visibility from the real state', () => {
  it('partitionPending gets the photos and a DERIVED owner flag and approval flag', () => {
    const call = singleCall(src(), 'partitionPending(')
    expect(call).toMatch(/partitionPending\(\s*photos\s*,\s*\{\s*isOwner:\s*\w+\s*,\s*requireApproval:?\s*\w*\s*\}\s*\)/)
    expect(call).not.toMatch(/\b(true|false)\b/)
  })
  it('the requireApproval flag is read from the album, not assumed', () => {
    expect(src()).toMatch(/const requireApproval = album\?\.require_approval === true/)
  })
  it('visiblePhotos gets the server answer flag and the server rows, derived', () => {
    const call = singleCall(src(), 'visiblePhotosOf(')
    for (const key of ['published:', 'pendingIds', 'bibEnabled', 'query:', 'serverAnswered:', 'serverPhotos:', 'range:']) {
      expect(call, `${key} is missing from the visiblePhotos input`).toContain(key)
    }
    expect(call).not.toMatch(/\b(true|false)\b|\[\]/)
  })
  it('the published count the guest-facing label uses comes from the module', () => {
    expect(src()).toMatch(/publishedCountOf\(\s*total\s*,\s*pendingPhotos\.length\s*\)/)
  })
})
