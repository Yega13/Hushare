import { describe, it, expect } from 'vitest'
import {
  searchPhase, mayStateAbsence, attemptIsOver, indexKnownComplete, indexKnownIncomplete,
  emptyStateTitleKey, emptyStateSubtitleKey, type SearchPhase,
} from '@/lib/search-answer'

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
// excludedByAlbum defaults to false for the same reason: every case below is a number the album's
// own range accepts, so the search actually runs. It was missing from this object entirely when the
// field was added to searchPhase, which broke `tsc --noEmit` across nineteen call sites here while
// every test still passed — vitest does not type-check, so nothing could notice from a green run.
const base = {
  enabled: true, query: '3400', answeredQuery: null, failedQuery: null,
  answerIsEmpty: true, indexComplete: true, excludedByAlbum: false,
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

// THE PHASE THAT HAD NO TESTS AT ALL, found on 2026-09-08 by the exhaustiveness guard below.
//
// 'excluded' means the album's own bib range filtered the number out, so no search ever ran.
// bibSearchCandidates returns an empty candidate list, the server short-circuits to zero rows, and
// before this phase existed the client read that as a real answer — a number the ORGANISER excluded
// was reported to the runner as "No photos with that number", definitively.
//
// It is reachable on any album whose range is wrong. bib_max typed as 300 for a race numbered to
// 2200 tells every runner above 300 that they were not photographed.
describe('searchPhase — a number the album itself refused is not an answer about the runner', () => {
  const excluded = { ...base, excludedByAlbum: true }

  it('is EXCLUDED when the album filtered the number out', () => {
    expect(searchPhase(excluded)).toBe('excluded')
  })

  // Deliberately ahead of 'failed': nothing was sent, so a stale failure tag cannot be about this
  // question, and offering "Try again" would invite a retry that is refused identically every time.
  it('outranks a stale failure tag for the same question', () => {
    expect(searchPhase({ ...excluded, failedQuery: '3400' })).toBe('excluded')
  })

  it('outranks a held answer for the same question', () => {
    expect(searchPhase({ ...excluded, answeredQuery: '3400', answerIsEmpty: false })).toBe('excluded')
  })

  // 'off' still wins, because an empty box is not a refused number.
  it('does not apply when there is no question in the box', () => {
    expect(searchPhase({ ...excluded, query: '' })).toBe('off')
  })

  it('never licenses the grid to say nothing was found', () => {
    expect(mayStateAbsence('excluded')).toBe(false)
  })

  // The attempt IS over, which is what lets the bar offer Face Finder instead of spinning forever.
  // Conflating this with mayStateAbsence is the bug that left a runner on a spinner with no way
  // forward, at a race, on the primary path.
  it('counts as finished, so the escape hatch appears', () => {
    expect(attemptIsOver('excluded')).toBe(true)
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
// 'excluded' was added to SearchPhase and NOT added here, and this guard fired exactly as designed.
// Nobody saw it: `tsc --noEmit` was already failing on nineteen errors in this same file, so the one
// real finding sat underneath the noise. A type-check that is always red reports nothing.
const ALL_PHASES = ['off', 'searching', 'failed', 'indexing', 'excluded', 'answered'] as const
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
// THE SENTENCE AN EMPTY GRID PRINTS, which is the whole point of every phase above.
//
// This was a ternary chain inside PhotoGrid, and its SHAPE was the defect rather than its contents:
// it named the safe phases and let everything else fall through to "No photos with that number".
// So each new phase printed the forbidden negative on the day it was added, with tsc perfectly
// happy, until somebody noticed. As a function over the union the default stops existing — a new
// phase is a compile error here instead of a false sentence on a runner's screen.
describe('emptyStateTitleKey — no phase may fall through to the negative', () => {
  it('gives every phase a key, and only ANSWERED gets the negative', () => {
    expect(everyPhaseIsListed).toBe(true)
    const negatives = [...ALL_PHASES].filter((p) => emptyStateTitleKey(p) === 'pg.noMatches')
    expect(negatives, 'only a final answer may say "no photos with that number"').toEqual(['answered'])
  })

  it('says nothing negative about a number the album itself filtered out', () => {
    // The live defect this phase exists for: an out-of-range number was reported as absent.
    expect(emptyStateTitleKey('excluded')).toBe('bib.outOfRange')
  })

  it('says nothing negative while the album is still being read', () => {
    expect(emptyStateTitleKey('indexing')).toBe('bib.searching')
  })

  it('keeps the two states that were already right', () => {
    expect(emptyStateTitleKey('off')).toBe('pg.empty')
    expect(emptyStateTitleKey('failed')).toBe('bib.failed')
    expect(emptyStateTitleKey('searching')).toBe('bib.searching')
  })

  it('never returns an empty key for any phase', () => {
    for (const p of ALL_PHASES) expect(emptyStateTitleKey(p).length, p).toBeGreaterThan(0)
  })
})

describe('emptyStateSubtitleKey — only a final answer earns an instruction', () => {
  it('offers advice on exactly two phases, and they are the two that hold an answer', () => {
    const withAdvice = [...ALL_PHASES].filter((p) => emptyStateSubtitleKey(p) !== null)
    // 'off' is a genuinely empty album ("be the first to upload"); 'answered' is a real negative.
    expect(withAdvice).toEqual(['off', 'answered'])
  })

  it('does NOT tell a runner to try a different number when we never looked', () => {
    // "Try a different number" under an excluded or half-indexed search sends someone away from a
    // question that was never asked, or one about to succeed.
    expect(emptyStateSubtitleKey('excluded')).toBeNull()
    expect(emptyStateSubtitleKey('indexing')).toBeNull()
    expect(emptyStateSubtitleKey('searching')).toBeNull()
  })

  it('does NOT blame the runner for our own failure', () => {
    expect(emptyStateSubtitleKey('failed')).toBeNull()
  })

  it('still says both things it should', () => {
    expect(emptyStateSubtitleKey('off')).toBe('pg.emptySub')
    expect(emptyStateSubtitleKey('answered')).toBe('pg.noMatchesSub')
  })

  it('tracks mayStateAbsence rather than repeating it', () => {
    // If these two ever disagree, one surface is claiming something the other refuses.
    for (const p of ALL_PHASES) {
      if (p === 'off') continue
      expect(emptyStateSubtitleKey(p) !== null, p).toBe(mayStateAbsence(p))
    }
  })
})

describe('attemptIsOver — are we still waiting, as opposed to may we claim absence?', () => {
  // 'excluded' joined 'indexing' here when it was added to the phase list: the request is over
  // (nothing was ever sent) and yet absence may not be claimed, because the album's own range is
  // what produced the emptiness, not the runner's photographs.
  it('covers every phase, and disagrees with mayStateAbsence on exactly the two that are over without an answer', () => {
    expect(everyPhaseIsListed).toBe(true)
    expect([...ALL_PHASES].filter(attemptIsOver)).toEqual(['indexing', 'excluded', 'answered'])
    const disagree = [...ALL_PHASES].filter((p) => attemptIsOver(p) !== mayStateAbsence(p))
    expect(disagree, 'if these ever agree everywhere, one of them is redundant').toEqual(['indexing', 'excluded'])
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
