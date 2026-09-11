import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripJsComments } from './helpers/source-text'
import { acceptedBibs, bibDigitsOf, MAX_BIB_DIGITS, MIN_BIB_CONFIDENCE, type DetectedWord } from '@/lib/bib-filter'

// WHAT THIS GUARDS, in one sentence: a runner searching 44 was handed 485 photographs of a
// billboard, because OCR reads every number in the frame and the old rule kept all of them.
//
// The fixture is REAL DetectText output from two races, pseudonymised. Every digit string is
// replaced by a different string of the same length and the same leading-zero shape; every word
// that is not a number becomes TEXT unless it is generic race vocabulary. That matters twice: the
// repository is public and bib numbers are not anonymous (race results publish bib-to-name), and a
// filter tested only against hand-written words is tested against words written to make it pass
// (AGENTS.md rule 17). Line membership, word counts and confidences are untouched, and those are
// the only things the rule reads.

type Case = { name: string; note: string; words: DetectedWord[] }
const CASES: Case[] = JSON.parse(
  readFileSync(join(process.cwd(), 'tests', 'fixtures', 'bib-detections.json'), 'utf8'),
)
function photo(name: string): Case {
  const found = CASES.find((c) => c.name === name)
  // A renamed fixture case must fail loudly rather than silently testing nothing.
  expect(found, `no fixture case named "${name}"`).toBeDefined()
  return found as Case
}
/** The words sharing each line, as the rule sees them. */
function lines(c: Case): DetectedWord[][] {
  const m = new Map<number, DetectedWord[]>()
  for (const w of c.words) {
    if (w.lineId === null || w.lineId === undefined) continue
    const at = m.get(w.lineId) ?? []
    at.push(w)
    m.set(w.lineId, at)
  }
  return [...m.values()]
}
const numeric = (w: DetectedWord) => bibDigitsOf(w.text) !== null
const numbersOn = (l: DetectedWord[]) => l.filter(numeric).map((w) => bibDigitsOf(w.text) as string)

describe('acceptedBibs — the rule, on hand-built words', () => {
  const word = (text: string, lineId: number, confidence = 95): DetectedWord => ({ text, confidence, lineId })

  it('keeps a number that is alone on its line', () => {
    expect(acceptedBibs([word('2102', 1)]).map((b) => b.number)).toEqual(['2102'])
  })

  it('drops every number on a line it shares — the billboard', () => {
    // "044 499 700" comes back as ONE line of three words, because DetectText groups equally
    // spaced aligned text. That is the shape of a phone number and not the shape of a bib.
    expect(acceptedBibs([word('044', 1), word('499', 1), word('700', 1)])).toEqual([])
  })

  it('drops a number sharing its line with WORDS, not just with other numbers', () => {
    // The line-word count is over EVERY word. "2144 HALF MARRATHON" must go for the same reason
    // the billboard does: something else is printed beside it.
    expect(acceptedBibs([word('2144', 1), word('HALF', 1), word('MARRATHON', 1)])).toEqual([])
  })

  it('judges each line independently, keeping the isolated one', () => {
    const out = acceptedBibs([word('044', 1), word('499', 1), word('700', 1), word('2102', 2)])
    expect(out.map((b) => b.number)).toEqual(['2102'])
  })

  it('strips a leading # or N, which bibs print', () => {
    expect(acceptedBibs([word('#2102', 1)]).map((b) => b.number)).toEqual(['2102'])
  })

  it('keeps leading zeros, because a padded bib is a different string', () => {
    // bibSearchCandidates pads a typed query across widths to match these, so flattening them here
    // would break the join between what is stored and what a runner types.
    expect(acceptedBibs([word('00522', 1)]).map((b) => b.number)).toEqual(['00522'])
  })

  it('refuses a word with no line at all', () => {
    // Measured across 8,939 real detections on two albums, ParentId was present on every one, so
    // this is unreachable today. It stays the safe direction rather than a convenient default:
    // missing information is not evidence of isolation.
    expect(acceptedBibs([{ text: '2102', confidence: 99, lineId: null }])).toEqual([])
    expect(acceptedBibs([{ text: '2102', confidence: 99, lineId: undefined }])).toEqual([])
  })
})

describe('acceptedBibs — the boundaries', () => {
  const at = (text: string, confidence: number): DetectedWord[] => [{ text, confidence, lineId: 1 }]

  it('rejects a reading below the confidence floor', () => {
    expect(acceptedBibs(at('2102', MIN_BIB_CONFIDENCE - 0.1))).toEqual([])
  })

  it('accepts a reading exactly at the floor', () => {
    expect(acceptedBibs(at('2102', MIN_BIB_CONFIDENCE)).map((b) => b.number)).toEqual(['2102'])
  })

  it('accepts the ordinary middle, well above the floor', () => {
    // The boring case. A suite of only boundaries lets a flipped comparison live.
    expect(acceptedBibs(at('2102', 93.4)).map((b) => b.number)).toEqual(['2102'])
  })

  it('rejects a number longer than a bib can be', () => {
    expect(bibDigitsOf('1'.repeat(MAX_BIB_DIGITS))).toBe('1'.repeat(MAX_BIB_DIGITS))
    expect(bibDigitsOf('1'.repeat(MAX_BIB_DIGITS + 1))).toBeNull()
  })

  it('rejects anything that is not digits after the prefix', () => {
    for (const junk of ['', '  ', 'HALF', '12A', '1.2', '-5', '2 1']) {
      expect(bibDigitsOf(junk), junk).toBeNull()
    }
  })

  it('refuses a non-finite confidence rather than comparing against it', () => {
    expect(acceptedBibs([{ text: '2102', confidence: Number.NaN, lineId: 1 }])).toEqual([])
  })
})

// THE ORDERING THAT IS NOT AN IMPLEMENTATION DETAIL.
//
// One number can be read twice on one photograph -- once on a bib and once on a banner. The
// highest-confidence reading is kept and the line rule is applied to THAT one. Asking instead
// "was ANY reading isolated?" readmits the banner year: measured on the real sample the two
// orderings differ on 3 of 712 tags, and 2 of the 3 are exactly that.
// ONE RUNNER IS ONE NUMBER, WHATEVER OCR SPELLED IT.
//
// The per-photograph map was keyed on the digit STRING, so "945" and "0945" were two entries for
// one runner and one photograph was counted twice in the owner's signage tallies -- measured at 2
// of 4,697 indexed photographs. That count decides whether a number is offered for exclusion at
// all, and the over-count only ever pushes toward "this is signage", which is the direction that
// hides a runner from their own search.
describe('acceptedBibs — two spellings of one number are one bib', () => {
  it('stores a padded and an unpadded reading of one number ONCE', () => {
    const out = acceptedBibs([
      { text: '945', confidence: 95, lineId: 1 }, { text: '0945', confidence: 90, lineId: 2 },
    ])
    expect(out).toHaveLength(1)
  })

  it('keeps the spelling of the most confident reading', () => {
    const out = acceptedBibs([
      { text: '945', confidence: 90, lineId: 1 }, { text: '0945', confidence: 95, lineId: 2 },
    ])
    expect(out.map((b) => b.number)).toEqual(['0945'])
    expect(out[0].confidence).toBe(95)
  })

  it('still keeps two genuinely different numbers apart', () => {
    const out = acceptedBibs([
      { text: '945', confidence: 95, lineId: 1 }, { text: '9450', confidence: 95, lineId: 2 },
    ])
    expect(out.map((b) => b.number).sort()).toEqual(['945', '9450'])
  })

  it('applies the line rule to the winning reading, not to whichever spelling was isolated', () => {
    // The measured ordering below decides this, and keying by value must not quietly reverse it:
    // the most confident reading of the NUMBER faces the line test, even when a different spelling
    // of it happened to stand alone.
    const out = acceptedBibs([
      { text: '02026', confidence: 99, lineId: 1 }, { text: 'AUGUST', confidence: 98, lineId: 1 },
      { text: '2026', confidence: 84, lineId: 2 },
    ])
    expect(out).toEqual([])
  })
})

describe('acceptedBibs — the max-confidence reading decides', () => {
  it('drops a number whose BEST reading is on a shared line, though a worse one was alone', () => {
    const out = acceptedBibs([
      { text: '2026', confidence: 99, lineId: 1 }, { text: 'AUGUST', confidence: 98, lineId: 1 },
      { text: '2026', confidence: 84, lineId: 2 },
    ])
    expect(out).toEqual([])
  })

  it('keeps a number whose BEST reading is alone, though a worse one was crowded', () => {
    const out = acceptedBibs([
      { text: '2102', confidence: 99, lineId: 2 },
      { text: '2102', confidence: 84, lineId: 1 }, { text: 'TEXT', confidence: 90, lineId: 1 },
    ])
    expect(out.map((b) => b.number)).toEqual(['2102'])
  })

  it('reports the confidence of the reading it kept', () => {
    // Both readings sit on lines of their OWN. The first draft put them on the same lineId, which
    // makes that line two words long and correctly rejects the number — the test failed against
    // correct code, and the fixture was the thing that was wrong (MISTAKES 23).
    const out = acceptedBibs([
      { text: '2102', confidence: 91, lineId: 1 },
      { text: '2102', confidence: 97, lineId: 2 },
    ])
    expect(out).toEqual([{ number: '2102', confidence: 97 }])
  })

  it('returns each number once, however many times it was read', () => {
    const out = acceptedBibs([
      { text: '2102', confidence: 91, lineId: 1 },
      { text: '2102', confidence: 97, lineId: 2 },
      { text: '2102', confidence: 88, lineId: 3 },
    ])
    expect(out).toHaveLength(1)
  })
})

describe('acceptedBibs — against real OCR from two races', () => {
  it('rejects every number on the billboard that produced 1,444 wrong tags', () => {
    const c = photo('billboard phone number: three numbers share one line')
    const plate = lines(c).find((l) => l.length >= 3 && l.every(numeric)) as DetectedWord[]
    const kept = acceptedBibs(c.words).map((b) => b.number)
    for (const n of numbersOn(plate)) {
      expect(kept, `${n} is one word of a printed phone number`).not.toContain(n)
    }
  })

  it('rejects the year printed across the finish arch', () => {
    const c = photo('event banner: a year merged with the date')
    const banner = lines(c).find((l) => l.length > 1 && l.some(numeric) && l.some((w) => !numeric(w)))
    const kept = acceptedBibs(c.words).map((b) => b.number)
    for (const n of numbersOn(banner as DetectedWord[])) expect(kept).not.toContain(n)
  })

  it('rejects a licence plate on a parked car', () => {
    const c = photo('a parked car licence plate')
    const plate = lines(c).find((l) => l.length >= 2 && l.filter(numeric).length >= 2) as DetectedWord[]
    const kept = acceptedBibs(c.words).map((b) => b.number)
    for (const n of numbersOn(plate)) expect(kept).not.toContain(n)
  })

  it('keeps a bib that is alone on its line', () => {
    const c = photo('a real bib alone on its line')
    const solo = lines(c).find((l) => l.length === 1 && numeric(l[0]) && l[0].confidence >= MIN_BIB_CONFIDENCE)
    const kept = acceptedBibs(c.words).map((b) => b.number)
    expect(kept).toContain(numbersOn(solo as DetectedWord[])[0])
  })

  it('keeps zero-padded bibs from the second race with their padding intact', () => {
    const c = photo('zero-padded bibs from a different race')
    const kept = acceptedBibs(c.words).map((b) => b.number)
    const padded = kept.filter((n) => n.startsWith('0'))
    expect(padded.length, 'the second race numbers its runners 00xxx').toBeGreaterThan(0)
  })

  it('finds nothing on a photograph that carries no numbers', () => {
    expect(acceptedBibs(photo('a photograph with no numbers at all').words)).toEqual([])
  })

  // THE TWO HONEST LIMITS, asserted so they are recorded rather than discovered.
  it('LOSES a real bib whose own printed event text merges its line', () => {
    // The measured cost of the rule: one tag in 456 candidates. Face Finder is the product's
    // answer to a number that cannot be read, and it is offered exactly when a bib search comes
    // back empty. If this ever starts passing, the rule changed and the trade must be re-measured.
    const c = photo('a real bib whose own printed event text merges its line')
    const merged = lines(c).find((l) => l.length > 1 && l.filter(numeric).length === 1 && l.some((w) => !numeric(w)))
    const kept = acceptedBibs(c.words).map((b) => b.number)
    for (const n of numbersOn(merged as DetectedWord[])) expect(kept).not.toContain(n)
  })

  it('KEEPS a year printed alone on its own line — no line rule can reach this', () => {
    // Stated as a test rather than left implied. About 75 photos of the big album still answer to
    // the arch year after this filter, and the owner-confirmed exclusion list is what removes them.
    // Asserting it here means a future change that claims to fix it has to update this test.
    const c = photo('event banner: a year ALONE on its own line')
    const solo = lines(c).find(
      (l) => l.length === 1 && numeric(l[0]) && l[0].confidence >= MIN_BIB_CONFIDENCE
        && (bibDigitsOf(l[0].text) as string).length === 4,
    )
    const kept = acceptedBibs(c.words).map((b) => b.number)
    expect(kept).toContain(numbersOn(solo as DetectedWord[])[0])
  })
})

// THE MODULE IS PROVEN; THIS PINS THE TWO LINES THAT FEED IT.
//
// 14 mutations die inside bib-filter, and none of them says anything about the mapping in
// rekognition.ts that turns a DetectText response into DetectedWord. Measured before this existed:
//
//     lineId: null          type-checks, passes all 27 tests, and stores NO bib ever
//     lineId: d.Id          every word becomes its own line -- every number in the frame accepted
//
// The second is caught by tsc, because TextResult is typed to only the fields the mapping uses and
// Id is not one of them. The first is not caught by anything. AGENTS.md MISTAKES entry 10 is this
// failure recorded five times: the decision moves somewhere testable and the two lines that decide
// whether it runs stay where nothing can see them.
//
// Reads the source rather than importing it, deliberately: rekognition.ts is I/O around a signed
// AWS call and sits on the UNTESTED_LEGACY register for that reason. Importing it here would mark
// it "tested" to tests/architecture.test.ts and take a truthful debt entry off the register.
describe('the OCR path actually hands the filter real line identity', () => {
  const SOURCE = join(process.cwd(), 'src', 'lib', 'rekognition.ts')
  // Comments stripped: three guards in this suite have been defeated by prose in the file they
  // were searching (MISTAKES 21), and the comment above detectBibNumbers names ParentId.
  //
  // THROUGH THE SHARED HELPER, not a local copy. This carried its own inline
  // `.replace(/\/\*[\s\S]*?\*\//g, ' ')` pair — the same two regexes helpers/source-text has since
  // replaced with a real scanner, because a `/*` inside a line comment made the first one eat
  // everything up to the next `*/`, hundreds of lines away. A guard reading a file through that
  // sees a fraction of it and passes for the wrong reason. One copy, in one place (rule 13).
  const source = () => stripJsComments(readFileSync(SOURCE, 'utf8'))

  it('maps ParentId into lineId, not a constant', () => {
    const m = /lineId:\s*([^\n,]+)/.exec(source())
    expect(m, 'the words handed to acceptedBibs carry no lineId at all').not.toBeNull()
    const value = (m as RegExpExecArray)[1].trim()
    expect(['null', 'undefined', '0', '1'], `lineId is hardcoded as ${value}`).not.toContain(value)
    expect(value, 'line identity must come from ParentId — Id is the WORD, not its line').toContain('ParentId')
  })

  it('keeps only WORD detections, because LINE entries repeat their own words', () => {
    // Counting LINE rows too would inflate every line's width and reject everything.
    expect(source()).toContain("d.Type === 'WORD'")
  })

  it('delegates the decision rather than re-implementing it', () => {
    // If a digit regex or a confidence comparison ever reappears in this file, the rule has two
    // homes again and the mutation set only guards one of them (rule 13).
    const src = source()
    expect(src, 'the filter must be called').toContain('acceptedBibs(')
    // Scoped to the BIB digit shape, not to regexes in general: this file legitimately carries a
    // UUID pattern for face ids, and a first draft of this assertion failed against it. The bib
    // rule is the 1-to-MAX_BIB_DIGITS quantifier, and that belongs in bib-filter alone.
    expect(src, 'a second digit-shape rule has appeared in the I/O layer').not.toMatch(/\{1,\s*6\}/)
  })
})

describe('the fixture is worth trusting', () => {
  it('carries every named case', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(8)
    for (const c of CASES) {
      expect(c.name.length, 'a case needs a name').toBeGreaterThan(0)
      expect(c.words.length, `${c.name} has no words`).toBeGreaterThan(0)
    }
  })

  it('contains no non-ASCII and no control characters', () => {
    // The real OCR carried Armenian and Cyrillic shop signage. It is scrubbed, which keeps
    // tests/source-hygiene honest and keeps other people's business names out of a public repo.
    const raw = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'bib-detections.json'), 'utf8')
    for (let i = 0; i < raw.length; i++) {
      const code = raw.charCodeAt(i)
      const ok = code === 10 || code === 13 || (code >= 32 && code <= 126)
      expect(ok, `code point ${code} at index ${i}`).toBe(true)
    }
  })
})
