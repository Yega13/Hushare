import { describe, it, expect } from 'vitest'
import { bibMatches, bibSearchCandidates, MAX_BIB_DIGITS } from '../src/lib/bib-match'
import type { Photo } from '../src/types'

// TWO MATCHERS, ONE ANSWER.
//
// A runner's photos are found twice: the phone filters what it has already loaded, so typing feels
// instant, and the database searches the whole album, so the answer is complete. They must agree.
// If they ever stop agreeing the failure is horrible to notice — the grid shows one set of photos
// and then, a beat later, a different one — so this file proves them equal by exhaustion rather
// than trusting that two pieces of code written on the same afternoon say the same thing.
//
// The database cannot compare "00945" to 945 through a GIN index, so bibSearchCandidates hands it
// every spelling instead. That translation is the part that can silently go wrong.

const photo = (bibs: string[] | null): Photo =>
  ({ id: 'p', bib_numbers: bibs } as unknown as Photo)

/** What the database would return for `bib_numbers && candidates`. */
function sqlWouldMatch(stored: string[] | null, candidates: string[] | null): boolean {
  if (candidates === null) return true            // no query: everything is shown
  if (candidates.length === 0) return false       // cannot match anything
  return (stored ?? []).some((b) => candidates.includes(b))
}

describe('the phone and the database agree on every bib', () => {
  // Every digit string OCR is allowed to store is /^\d{1,6}$/, so these cover the shapes that
  // actually reach the column: bare, zero-padded, the maximum width, and the empty column.
  const STORED: (string[] | null)[] = [
    null, [], ['945'], ['0945'], ['00945'], ['000945'], ['945', '12'],
    ['1'], ['000001'], ['999999'], ['0'], ['000000'], ['14', '2026'],
  ]
  const QUERIES = ['', '945', '0945', '00945', '9450', '1', '01', '14', '2026', '0', '999999', '1234567', 'abc', '9 4 5', '#945',
    '1'.repeat(22), '9'.repeat(30), '000000000945']
  const RANGES = [
    undefined,
    { min: null, max: null },
    { min: 1, max: 500 },
    { min: 1, max: 999999 },
    { min: 900, max: 1000 },
  ]

  it('gives the same verdict for every combination', () => {
    const disagreements: string[] = []
    for (const stored of STORED) {
      for (const query of QUERIES) {
        for (const range of RANGES) {
          const client = bibMatches(photo(stored), query, range)
          const server = sqlWouldMatch(stored, bibSearchCandidates(query, range))
          if (client !== server) {
            disagreements.push(
              `stored=${JSON.stringify(stored)} query=${JSON.stringify(query)} ` +
              `range=${JSON.stringify(range)} → phone:${client} database:${server}`,
            )
          }
        }
      }
    }
    expect(disagreements, 'the two matchers must never disagree').toEqual([])
  })

  it('proves it can fail', () => {
    // A guard on the guard: if sqlWouldMatch were vacuously true the sweep above would pass while
    // testing nothing. This is a real disagreement, and the harness must see it.
    expect(sqlWouldMatch(['945'], ['946'])).toBe(false)
    expect(bibMatches(photo(['945']), '945')).toBe(true)
  })
})

describe('candidate lists stay small and indexable', () => {
  it('covers every leading-zero spelling and no more', () => {
    expect(bibSearchCandidates('945')).toEqual(['945', '0945', '00945', '000945'])
    expect(bibSearchCandidates('000945')).toEqual(['945', '0945', '00945', '000945'])
  })

  it('never exceeds the width OCR can store', () => {
    for (const q of ['1', '12', '123456', '000001']) {
      for (const c of bibSearchCandidates(q) ?? []) {
        expect(c.length).toBeLessThanOrEqual(MAX_BIB_DIGITS)
      }
    }
  })

  it('separates "no query" from "cannot match"', () => {
    // These two must never be confused: null means show the whole album, [] means show nothing.
    // Treating [] as null would hand a runner every photo in the race.
    expect(bibSearchCandidates('')).toBeNull()
    expect(bibSearchCandidates('   ')).toBeNull()
    expect(bibSearchCandidates('9999999')).toEqual([])          // longer than a bib can be
    // String(Number(...)) gives "1e+21" here — short enough to slip a naive length check, and a
    // value that must never be handed to the query.
    expect(bibSearchCandidates('1'.repeat(22))).toEqual([])
    expect(bibSearchCandidates('600', { min: 1, max: 500 })).toEqual([])  // outside the race
  })
})

// The whole point of moving this to the server. Kept as a statement of intent: if someone puts the
// filter back on the phone, the album's loaded window becomes the answer again and a runner past
// it is told they were not photographed.
describe('a match outside the loaded window is still a match', () => {
  it('does not depend on how many photos the phone holds', () => {
    const candidates = bibSearchCandidates('3400', { min: 1, max: 5000 })
    expect(candidates).not.toBeNull()
    expect(sqlWouldMatch(['3400'], candidates)).toBe(true)
  })
})
