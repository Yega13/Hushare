import { describe, it, expect } from 'vitest'
import {
  exclusionCandidates, isExcludedNumber, numericKey, normalizeExclusions,
  CANDIDATE_MIN_PHOTOS, CANDIDATE_MAX, MAX_EXCLUSIONS, type NumberTally,
} from '@/lib/bib-exclusions'
import { bibMatches, bibSearchCandidates, queryOutsideRange, type BibRange } from '@/lib/bib-match'
import type { Photo } from '@/types'

// THE LAST 3.7%, AND WHY A PERSON HAS TO DECIDE IT.
//
// lib/bib-filter refuses any number sharing its OCR line, which removes 96.3% of the noise. What it
// cannot reach is a number printed ALONE -- the year across a finish arch is typographically
// identical to a bib on a chest. On the measured race that left "2026" answering on about 75
// photographs, plus low integers off podium boards and kilometre markers.
//
// Frequency looks like the fix and is not, and that is measured rather than argued: on the 69-photo
// album the banner year and the real bib 00663 appeared on exactly 4 photographs each. Any
// album-relative threshold that is safe on 4,566 photos sits below the entire real-bib population
// on 69. So frequency nominates and the owner confirms.

const photo = (bibs: string[]): Photo => ({ bib_numbers: bibs } as unknown as Photo)

describe('numericKey — what makes two numbers the same number', () => {
  it('ignores the leading zeros OCR reads off a bib', () => {
    // The same runner is "00945" on one photograph and "945" on another. An owner excluding one
    // means both, and bibMatches already compares this way.
    expect(numericKey('00945')).toBe(numericKey('945'))
    expect(numericKey('02026')).toBe(numericKey('2026'))
  })

  it('ignores a printed # or N prefix', () => {
    expect(numericKey('#2026')).toBe(numericKey('2026'))
  })

  it('refuses anything that is not a bib-shaped number', () => {
    for (const junk of ['', '   ', 'MARATHON', '12A', '1.5', '-4', '1234567']) {
      expect(numericKey(junk), junk).toBeNull()
    }
  })
})

describe('isExcludedNumber — has the owner said this is not a runner?', () => {
  it('matches by VALUE, so a padded stored number goes with it', () => {
    expect(isExcludedNumber('02026', ['2026'])).toBe(true)
    expect(isExcludedNumber('2026', ['02026'])).toBe(true)
  })

  it('does not match a different number', () => {
    expect(isExcludedNumber('2027', ['2026'])).toBe(false)
    // Substrings must not match: 202 is a real bib on the measured album AND a banner misread.
    expect(isExcludedNumber('202', ['2026'])).toBe(false)
  })

  it('is false for an empty list, without inspecting anything', () => {
    expect(isExcludedNumber('2026', [])).toBe(false)
  })

  it('ERRS TOWARD NOT EXCLUDED on junk, in both directions', () => {
    // Rule 19. A wrong exclusion hides a runner's photographs and they never learn to complain;
    // a missed one shows them a banner they can see is a banner.
    expect(isExcludedNumber('MARATHON', ['2026'])).toBe(false)
    expect(isExcludedNumber('2026', ['MARATHON'])).toBe(false)
    expect(isExcludedNumber('2026', [''])).toBe(false)
  })
})

describe('exclusionCandidates — frequency NOMINATES, it never removes', () => {
  const tallies: NumberTally[] = [
    { number: '2026', photos: 1145 }, { number: '700', photos: 508 },
    { number: '044', photos: 485 }, { number: '499', photos: 451 },
    { number: '2020', photos: 76 }, { number: '202', photos: 67 },
    { number: '2188', photos: 61 }, { number: '999', photos: 1 },
  ]

  it('offers the most-seen first', () => {
    const out = exclusionCandidates(tallies)
    expect(out.map((t) => t.number).slice(0, 4)).toEqual(['2026', '700', '044', '499'])
  })

  it('goes deep enough to reach the QUIET noise, not just the loud', () => {
    // The real finding behind CANDIDATE_MAX being 20 rather than 5: behind the four loudest sat
    // 2020 (76 photos) and 202 (67), banner misreads a short list leaves behind while the owner
    // believes they have cleared it.
    const out = exclusionCandidates(tallies).map((t) => t.number)
    expect(out).toContain('2020')
    expect(out).toContain('202')
  })

  it('offers a real bib too, because only a person can tell the difference', () => {
    // 2188 is a runner on the measured album. It appears here BY DESIGN: a list that pre-filtered
    // it would be the automatic rule this whole module exists to avoid.
    expect(exclusionCandidates(tallies).map((t) => t.number)).toContain('2188')
  })

  it('drops one-off misreads below the asking floor', () => {
    expect(exclusionCandidates(tallies).map((t) => t.number)).not.toContain('999')
    expect(exclusionCandidates([{ number: '5', photos: CANDIDATE_MIN_PHOTOS }])).toHaveLength(1)
    expect(exclusionCandidates([{ number: '5', photos: CANDIDATE_MIN_PHOTOS - 1 }])).toHaveLength(0)
  })

  it('does not offer what is already excluded, by VALUE', () => {
    const out = exclusionCandidates(tallies, ['02026']).map((t) => t.number)
    expect(out).not.toContain('2026')
    expect(out).toContain('700')
  })

  it('is bounded, and the bound is the exported one', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ number: String(100 + i), photos: 60 - i }))
    expect(exclusionCandidates(many)).toHaveLength(CANDIDATE_MAX)
  })

  it('orders ties stably, so the panel does not reshuffle under the owner', () => {
    const tied: NumberTally[] = [{ number: '77', photos: 9 }, { number: '11', photos: 9 }]
    expect(exclusionCandidates(tied).map((t) => t.number)).toEqual(['11', '77'])
    expect(exclusionCandidates([...tied].reverse()).map((t) => t.number)).toEqual(['11', '77'])
  })

  it('does not mutate the tallies it was handed', () => {
    const input = [...tallies]
    exclusionCandidates(input)
    expect(input.map((t) => t.number)).toEqual(tallies.map((t) => t.number))
  })
})

describe('normalizeExclusions — what gets stored', () => {
  it('collapses the same number written two ways', () => {
    expect(normalizeExclusions(['2026', '02026', '#2026'])).toEqual(['2026'])
  })

  it('drops anything that is not a number, rather than storing it', () => {
    expect(normalizeExclusions(['2026', 'MARATHON', '', null, 7, {}])).toEqual(['2026'])
  })

  it('is bounded', () => {
    const many = Array.from({ length: MAX_EXCLUSIONS + 50 }, (_, i) => String(1000 + i))
    expect(normalizeExclusions(many)).toHaveLength(MAX_EXCLUSIONS)
  })
})

// THE TWO HALVES OF ONE FACT.
//
// The phone filters the photographs it already holds; the database answers for the whole album.
// bib-match exists because two matchers answering one question drift, and the runner sees one
// answer and then a different one. An exclusion has to reach both or it has reopened exactly that.
describe('an exclusion reaches the phone AND the database', () => {
  const range = (excluded: string[]): BibRange => ({ min: null, max: null, excluded })

  it('the local filter stops matching an excluded number', () => {
    expect(bibMatches(photo(['2026']), '2026', { min: null, max: null })).toBe(true)
    expect(bibMatches(photo(['2026']), '2026', range(['2026']))).toBe(false)
  })

  it('the local filter stops matching a PADDED stored form of it', () => {
    // The rows still carry what OCR read; nothing was re-indexed. That is the point.
    expect(bibMatches(photo(['02026']), '2026', range(['2026']))).toBe(false)
  })

  it('the database is never asked for an excluded number', () => {
    expect(bibSearchCandidates('2026', { min: null, max: null })).not.toEqual([])
    expect(bibSearchCandidates('2026', range(['2026']))).toEqual([])
  })

  it('and that refusal is reported as a refusal, not as an absence', () => {
    // Empty candidates mean "no photos", NOT "no filter" — queryOutsideRange is what keeps the
    // message layer from saying "No photos with that number" about a search nobody ran.
    expect(queryOutsideRange('2026', range(['2026']))).toBe(true)
    expect(queryOutsideRange('2188', range(['2026']))).toBe(false)
  })

  it('leaves every other number alone, in both halves', () => {
    expect(bibMatches(photo(['2188']), '2188', range(['2026']))).toBe(true)
    expect(bibSearchCandidates('2188', range(['2026']))).not.toEqual([])
  })

  it('an empty or absent list changes nothing', () => {
    for (const r of [{ min: null, max: null }, range([])] as BibRange[]) {
      expect(bibMatches(photo(['2026']), '2026', r)).toBe(true)
      expect(bibSearchCandidates('2026', r)).not.toEqual([])
    }
  })

  it('still honours the range alongside the list', () => {
    const both: BibRange = { min: 100, max: 3000, excluded: ['2026'] }
    expect(bibSearchCandidates('50', both), 'below the range').toEqual([])
    expect(bibSearchCandidates('2026', both), 'excluded').toEqual([])
    expect(bibSearchCandidates('2188', both), 'a runner').not.toEqual([])
  })
})
