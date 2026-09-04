import { describe, it, expect } from 'vitest'
import { searchPhase, mayStateAbsence, type SearchPhase } from '@/lib/search-answer'

// THE BUG THIS EXISTS FOR, stated as a test rather than a comment.
//
// A runner on a 5,000-photo album types their bib number. The first window holds ~500 rows, so the
// local filter finds nothing while the server request is still in flight. PhotoGrid was handed
// `filtered = bibEnabled && !!bibDigits` -- true on keystroke one -- and printed "No photos with
// that number" underneath a bar that was simultaneously saying "Searching…".
//
// Every case below is one of the states that boolean could not tell apart.

const base = { enabled: true, query: '3400', answeredQuery: null, failedQuery: null }

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

describe('mayStateAbsence — the guard the grid asks', () => {
  it('permits "nothing found" ONLY on a final answer', () => {
    const phases: SearchPhase[] = ['off', 'searching', 'failed', 'answered']
    expect(phases.filter(mayStateAbsence)).toEqual(['answered'])
  })

  it('refuses while searching — this is the assertion the shipped bug violated', () => {
    expect(mayStateAbsence(searchPhase(base))).toBe(false)
  })

  it('refuses after a failure', () => {
    expect(mayStateAbsence(searchPhase({ ...base, failedQuery: '3400' }))).toBe(false)
  })
})
