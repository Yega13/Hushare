import { describe, it, expect } from 'vitest'
import {
  exclusionCandidates, exclusionRows, isExcludedNumber, mergeTalliesByValue, numericKey,
  normalizeExclusions,
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

describe('exclusionRows — what an exclusion can be undone from', () => {
  // AN EXCLUDED NUMBER IS NOT A CANDIDATE, and it is still on screen. The owner reopened the panel
  // and found the number they had switched off reduced to a struck-through digit string: blank
  // square where its photograph had been, no count, and last in the list. Every one of those is
  // load-bearing -- a wrong exclusion hides a runner from their own search and produces no
  // complaint, so the evidence for undoing it has to stay in front of the person who made it.

  const tallies = [
    { number: '2026', photos: 1145, sampleThumb: 'https://cdn/arch.jpg' },
    { number: '700', photos: 508, sampleThumb: 'https://cdn/board.jpg' },
    { number: '2188', photos: 61, sampleThumb: 'https://cdn/runner.jpg' },
  ]

  it('keeps an excluded number, with its count and its photograph', () => {
    const rows = exclusionRows(tallies, ['2026'])
    const row = rows.find((r) => r.number === '2026')
    expect(row).toBeTruthy()
    expect(row!.photos).toBe(1145)
    expect(row!.sampleThumb).toBe('https://cdn/arch.jpg')
  })

  it('orders excluded and offered numbers together, so a row does not move when it is tapped', () => {
    // Appending the excluded set sent the loudest number on the album -- always the first thing an
    // owner excludes -- to the far end of the list on the next open, which reads as "gone".
    expect(exclusionRows(tallies, ['2026']).map((r) => r.number)).toEqual(['2026', '700', '2188'])
    expect(exclusionRows(tallies, []).map((r) => r.number)).toEqual(['2026', '700', '2188'])
  })

  it('shows a number ONCE, however it is spelled in the stored list', () => {
    // The bug the owner photographed in the first version: one number rendered twice, dark and
    // again beside it still offering its count.
    const rows = exclusionRows(tallies, ['02026'])
    expect(rows.filter((r) => numericKey(r.number) === '2026')).toHaveLength(1)
  })

  it('shows it once even when the stored list holds two spellings of it', () => {
    // The route normalises before storing, but the column is guarded only by a length limit, and
    // a list written before that normalisation existed can hold both. Two rows for one number is
    // the exact thing the owner photographed -- and tapping one would not switch the other off.
    const rows = exclusionRows(tallies, ['2026', '02026', '#2026'])
    expect(rows.filter((r) => numericKey(r.number) === '2026')).toHaveLength(1)
  })

  it('labels that row with the STORED spelling, never the one OCR read', () => {
    // Anything comparing text -- and the panel's own aria-pressed did -- would not recognise a row
    // labelled "02026" as the excluded "2026", so it would render as still switched on.
    const rows = exclusionRows([{ number: '02026', photos: 1145 }], ['2026'])
    expect(rows.map((r) => r.number)).toEqual(['2026'])
    expect(rows[0].photos).toBe(1145)
  })

  it('still gives a row to an exclusion with no photographs behind it', () => {
    // An exclusion made before this panel existed, or one whose photographs have been deleted.
    // Dropping it would make it permanent and invisible.
    const rows = exclusionRows(tallies, ['9999'])
    const row = rows.find((r) => r.number === '9999')
    expect(row).toBeTruthy()
    expect(row!.photos).toBe(0)
    expect(row!.sampleThumb).toBeNull()
  })

  it('ignores an unparseable entry in the stored list rather than rowing it', () => {
    expect(exclusionRows(tallies, ['not-a-number']).map((r) => r.number))
      .toEqual(['2026', '700', '2188'])
  })

  it('caps the numbers it OFFERS, and never caps what is already excluded', () => {
    // The cap is a floor on the question, not on the answer: a hidden exclusion is unremovable.
    const many = Array.from({ length: 40 }, (_, i) => ({ number: String(i + 1), photos: 100 - i }))
    const excluded = ['31', '32', '33']
    const rows = exclusionRows(many, excluded)
    expect(rows).toHaveLength(CANDIDATE_MAX + excluded.length)
    for (const e of excluded) expect(rows.map((r) => r.number)).toContain(e)
  })

  it('applies the same floor as the candidate list to what it offers', () => {
    expect(exclusionRows([{ number: '5', photos: CANDIDATE_MIN_PHOTOS - 1 }], [])).toHaveLength(0)
  })

  it('does not mutate the tallies it was given', () => {
    const input = [{ number: '2188', photos: 61 }, { number: '2026', photos: 1145 }]
    exclusionRows(input, ['700'])
    expect(input.map((t) => t.number)).toEqual(['2188', '2026'])
  })
})

describe('mergeTalliesByValue — the tallies count spellings, the panel counts numbers', () => {
  // The RPC groups by the literal string OCR read, and OCR keeps leading zeros. An arch year read
  // as "2026" on most frames and "02026" on the rest arrives as two tallies of one number.

  it('collapses two spellings into one row', () => {
    const out = mergeTalliesByValue([{ number: '2026', photos: 1105 }, { number: '02026', photos: 40 }])
    expect(out).toHaveLength(1)
  })

  it('adds their counts, because the count is the argument the owner decides on', () => {
    const out = mergeTalliesByValue([{ number: '2026', photos: 1105 }, { number: '02026', photos: 40 }])
    expect(out[0].photos).toBe(1145)
  })

  it('labels the row with the spelling seen on the most photographs', () => {
    const out = mergeTalliesByValue([{ number: '02026', photos: 40 }, { number: '2026', photos: 1105 }])
    expect(out[0].number).toBe('2026')
  })

  it('takes a photograph from whichever spelling has one', () => {
    const out = mergeTalliesByValue([
      { number: '2026', photos: 1105, sampleThumb: null },
      { number: '02026', photos: 40, sampleThumb: 'https://cdn/arch.jpg' },
    ])
    expect(out[0].sampleThumb).toBe('https://cdn/arch.jpg')
  })

  it('drops a non-finite count BEFORE summing, so one bad row cannot poison a number', () => {
    const out = mergeTalliesByValue([
      { number: '2026', photos: Number.NaN }, { number: '02026', photos: 40 },
    ])
    expect(out[0].photos).toBe(40)
  })

  it('leaves unrelated numbers alone', () => {
    const out = mergeTalliesByValue([{ number: '2026', photos: 10 }, { number: '2027', photos: 10 }])
    expect(out).toHaveLength(2)
  })

  it('feeds the candidate list, so one number never takes two of the twenty slots', () => {
    const out = exclusionCandidates([{ number: '2026', photos: 1105 }, { number: '02026', photos: 40 }])
    expect(out).toHaveLength(1)
    expect(out[0].photos).toBe(1145)
  })

  it('feeds an EXCLUDED row too, so it shows the same count it was offered with', () => {
    const rows = exclusionRows(
      [{ number: '2026', photos: 1105 }, { number: '02026', photos: 40 }], ['2026'])
    expect(rows).toHaveLength(1)
    expect(rows[0].photos).toBe(1145)
  })
})
