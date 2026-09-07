import { describe, it, expect } from 'vitest'
import { searchPhase, mayStateAbsence, attemptIsOver, indexKnownComplete, indexKnownIncomplete, type SearchPhase } from '@/lib/search-answer'

// THE BUG THIS EXISTS FOR, stated as a test rather than a comment.
//
// A runner on a 5,000-photo album types their bib number. The first window holds ~500 rows, so the
// local filter finds nothing while the server request is still in flight. PhotoGrid was handed
// `filtered = bibEnabled && !!bibDigits` -- true on keystroke one -- and printed "No photos with
// that number" underneath a bar that was simultaneously saying "Searching…".
//
// Every case below is one of the states that boolean could not tell apart.

// answerIsEmpty/indexComplete default to the FINISHED album, so every pre-existing case below keeps
// testing exactly what it tested before: a fully-read album where emptiness is a real answer.
const base = {
  enabled: true, query: '3400', answeredQuery: null, failedQuery: null,
  answerIsEmpty: true, indexComplete: true,
}

describe('searchPhase — do we hold the answer to the question in the box?', () => {
  it('is SEARCHING when nothing has come back yet', () => {
    // The live bug. If this ever returns 'answered', the grid states a negative mid-flight.
    expect(searchPhase(base)).toBe('searching')
  })

  it('is SEARCHING when the held answer is for a DIFFERENT question', () => {
    // The runner typed 3400; the reply for "340" arrives first. It is an answer, but not to this.
    expect(searchPhase({ ...base, answeredQuery: '340' })).toBe('searching')
  })

  it('is ANSWERED only when the held answer matches the question exactly', () => {
    expect(searchPhase({ ...base, answeredQuery: '3400' })).toBe('answered')
  })

  it('is FAILED when the request for THIS question failed', () => {
    // Before the fix a failure left the grid on the empty local filter, so it stated absence for a
    // search that never actually ran.
    expect(searchPhase({ ...base, failedQuery: '3400' })).toBe('failed')
  })

  it('is SEARCHING when an OLDER question failed but this one is still in flight', () => {
    // A stale failure must not describe the current attempt.
    expect(searchPhase({ ...base, failedQuery: '340' })).toBe('searching')
  })

  it('prefers FAILED over a stale held answer for the same question', () => {
    // THIS ENCODES A PRECONDITION, and it is worth naming because the first version of the app code
    // did not meet it. The order is only right while a failure tag describes the LATEST attempt.
    // The caller originally tagged failures and never retired them, so this branch fired for a
    // number whose successful results were on screen — the held answer was NEWER than the failure,
    // and this said "could not search" over twelve photos. The caller now clears the tag on a
    // matching success; that is what makes preferring the failure the safe direction rather than a
    // stale one.
    expect(searchPhase({ ...base, answeredQuery: '3400', failedQuery: '3400' })).toBe('failed')
  })

  it('a failure for an older question does not outrank the current answer', () => {
    // The shape the caller's fix produces: "3400" failed, the runner retyped it, the retry
    // succeeded and retired the tag. Nothing stale is left to prefer.
    expect(searchPhase({ ...base, answeredQuery: '3400', failedQuery: null })).toBe('answered')
  })

  it('is OFF with an empty box, so an empty grid means an empty album', () => {
    expect(searchPhase({ ...base, query: '' })).toBe('off')
  })

  it('is OFF when the album has no bib search, whatever else is set', () => {
    expect(searchPhase({ ...base, enabled: false, answeredQuery: '3400' })).toBe('off')
  })
})

// THE SECOND SURFACE OF THE SAME BUG, found on 2026-09-07.
//
// searchPhase originally took four inputs and indexing progress was not one of them, so a search
// that COMPLETED against a half-read album returned 'answered' and the grid stated absence. The bar
// above it knew better and printed "Still reading photos (1,200 of 5,000)" at the same moment,
// because `stillIndexing` was a private const inside BibSearchBar that nothing else could read.
//
// During a race this is the normal state: the photographer uploads continuously and OCR chains
// behind in batches, so `indexed < total` holds for most of the event.
describe('searchPhase — a half-read album has not earned a negative', () => {
  const answered = { ...base, answeredQuery: '3400' }

  it('is INDEXING when the answer is empty and the album is still being read', () => {
    // The defect. Before indexComplete existed this returned 'answered' and the grid printed
    // "No photos with that number" to a runner whose photo simply had not been read yet.
    expect(searchPhase({ ...answered, answerIsEmpty: true, indexComplete: false })).toBe('indexing')
  })

  it('is ANSWERED when the answer is empty and the album IS fully read', () => {
    // The other direction, and it matters: on a finished album an empty answer is a real answer
    // and withholding it forever would be the mirror lie — an unbacked "not yet".
    expect(searchPhase({ ...answered, answerIsEmpty: true, indexComplete: true })).toBe('answered')
  })

  it('is ANSWERED for a NON-EMPTY result even while the album is still being read', () => {
    // The deliberate carve-out. "12 photos" is true the moment it is known, and holding it back
    // until every photo is read would hide results the runner already has.
    expect(searchPhase({ ...answered, answerIsEmpty: false, indexComplete: false })).toBe('answered')
  })

  it('still prefers FAILED over an incomplete index', () => {
    // Ordering: a failed request tells us nothing about the index, and 'failed' offers a retry
    // where 'indexing' does not.
    expect(searchPhase({ ...answered, failedQuery: '3400', answerIsEmpty: true, indexComplete: false }))
      .toBe('failed')
  })

  it('is SEARCHING, not INDEXING, when no answer is held at all', () => {
    // An incomplete index must not upgrade "nothing has come back" into a statement about reading.
    expect(searchPhase({ ...base, answeredQuery: null, answerIsEmpty: true, indexComplete: false }))
      .toBe('searching')
  })
})

describe('the index predicates — what we KNOW, not what we assume', () => {
  it('knows it is complete when every image has been indexed', () => {
    expect(indexKnownComplete({ indexed: 4565, totalImages: 4565 })).toBe(true)
    expect(indexKnownIncomplete({ indexed: 4565, totalImages: 4565 })).toBe(false)
  })

  it('knows it is INCOMPLETE partway through — the ordinary state during an event', () => {
    // The boring middle case. A suite built only from the boundaries lets a wrong comparison live:
    // `indexed > totalImages` would pass both the equal case and the zero case.
    expect(indexKnownComplete({ indexed: 1200, totalImages: 5000 })).toBe(false)
    expect(indexKnownIncomplete({ indexed: 1200, totalImages: 5000 })).toBe(true)
  })

  it('one photo short is still incomplete', () => {
    expect(indexKnownComplete({ indexed: 4564, totalImages: 4565 })).toBe(false)
  })

  it('a count running past the total is complete, not still reading', () => {
    // A photo deleted mid-sweep can leave indexed above total.
    expect(indexKnownComplete({ indexed: 4566, totalImages: 4565 })).toBe(true)
    expect(indexKnownIncomplete({ indexed: 4566, totalImages: 4565 })).toBe(false)
  })

  it('an album the server says holds NO images is complete, not forever-reading', () => {
    // Saying "still reading photos (0 of 0)" makes a guest wait for something already finished —
    // the mirror of rule 20's forbidden negative.
    expect(indexKnownComplete({ indexed: 0, totalImages: 0 })).toBe(true)
    expect(indexKnownIncomplete({ indexed: 0, totalImages: 0 })).toBe(false)
  })

  // THE HOLE A REVIEW FOUND. The album page falls back to counting the LOADED WINDOW when the
  // server's stats have not arrived, and albums default to oldest-first — so that window is exactly
  // the photos OCR finished first and reads as fully indexed. The stats request is also issued only
  // when the search box is empty and is aborted by the first keystroke, so absent stats are common
  // during a search rather than rare. Passing null must therefore claim NOTHING, in both directions.
  it('KNOWS NOTHING when the server stats are absent — and says so both ways', () => {
    for (const absent of [null, undefined]) {
      expect(indexKnownComplete(absent), 'unknown must not license the negative').toBe(false)
      expect(indexKnownIncomplete(absent), 'unknown must not license "still reading"').toBe(false)
    }
  })

  it('claims nothing from counts it cannot read', () => {
    // Rule 19: an unreadable count must withhold, never license. Being wrong here costs a spinner;
    // being wrong the other way tells a runner they were not photographed.
    for (const bad of [
      { indexed: Number.NaN, totalImages: 4565 },
      { indexed: 1200, totalImages: Number.NaN },
      { indexed: Number.POSITIVE_INFINITY, totalImages: 4565 },
    ]) {
      expect(indexKnownComplete(bad)).toBe(false)
      expect(indexKnownIncomplete(bad)).toBe(false)
    }
  })

  it('the two are NEVER both true — that would be a contradiction on screen', () => {
    // They are deliberately not complements (unknown makes both false), but they must never both
    // fire: the bar would say "still reading" while the grid stated the album fully searched.
    const cases: Array<{ indexed: number; totalImages: number }> = [
      { indexed: 0, totalImages: 0 }, { indexed: 0, totalImages: 5000 },
      { indexed: 1200, totalImages: 5000 }, { indexed: 4565, totalImages: 4565 },
      { indexed: 4566, totalImages: 4565 }, { indexed: -1, totalImages: 10 },
    ]
    for (const c of cases) {
      expect(indexKnownComplete(c) && indexKnownIncomplete(c), JSON.stringify(c)).toBe(false)
    }
  })
})

// EVERY PHASE IS LISTED, AND THE COMPILER ENFORCES THAT.
//
// This list used to be written out by hand as ['off','searching','failed','answered']. Adding a
// fifth member to SearchPhase would have left it green while testing nothing about the new state —
// the exact shape of a test that cannot see what it claims to cover. The conditional type below
// resolves to `never` the moment a phase is missing, so the assignment stops compiling.
const ALL_PHASES = ['off', 'searching', 'failed', 'indexing', 'answered'] as const
type Uncovered = Exclude<SearchPhase, (typeof ALL_PHASES)[number]>
type AllCovered = [Uncovered] extends [never] ? true : never
const everyPhaseIsListed: AllCovered = true

describe('mayStateAbsence — the guard the grid asks', () => {
  it('permits "nothing found" ONLY on a final answer', () => {
    expect(everyPhaseIsListed).toBe(true)
    expect([...ALL_PHASES].filter(mayStateAbsence)).toEqual(['answered'])
  })

  it('refuses while searching — this is the assertion the shipped bug violated', () => {
    expect(mayStateAbsence(searchPhase(base))).toBe(false)
  })

  it('refuses after a failure', () => {
    expect(mayStateAbsence(searchPhase({ ...base, failedQuery: '3400' }))).toBe(false)
  })

  it('refuses while the album is still being read', () => {
    expect(mayStateAbsence(searchPhase({
      ...base, answeredQuery: '3400', answerIsEmpty: true, indexComplete: false,
    }))).toBe(false)
  })
})

// TWO QUESTIONS THAT USED TO HAVE ONE ANSWER.
//
// With four phases, "may I say nothing was found" and "is the attempt finished" were the same
// predicate, so BibSearchBar used mayStateAbsence for both — the count label AND the Face Finder
// escape hatch. Adding 'indexing' split them: the request IS over, it simply returned nothing while
// the album is still being read. Reusing the old predicate hid the escape hatch for the whole of a
// half-read album and pinned the label on "Searching…" with nothing left to re-fetch.
//
// A review caught it before it shipped. These assertions are the difference between the two.
describe('attemptIsOver — are we still waiting, as opposed to may we claim absence?', () => {
  it('covers every phase, and disagrees with mayStateAbsence on exactly one', () => {
    expect(everyPhaseIsListed).toBe(true)
    expect([...ALL_PHASES].filter(attemptIsOver)).toEqual(['indexing', 'answered'])
    const disagree = [...ALL_PHASES].filter((p) => attemptIsOver(p) !== mayStateAbsence(p))
    expect(disagree, 'if these ever agree everywhere, one of them is redundant').toEqual(['indexing'])
  })

  it('is TRUE while indexing — the escape hatch must be offered', () => {
    // The regression. False here hides "Find me by face" at the moment a runner most needs it.
    expect(attemptIsOver('indexing')).toBe(true)
  })

  it('is FALSE while genuinely searching, so the spinner still means something', () => {
    expect(attemptIsOver('searching')).toBe(false)
  })

  it('is FALSE on failure, which has its own retry affordance', () => {
    expect(attemptIsOver('failed')).toBe(false)
  })
})
