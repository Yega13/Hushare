// WHETHER WE ACTUALLY HOLD THE ANSWER TO THE QUESTION CURRENTLY IN THE BOX.
//
// This is one fact, and it was written in one place that could not share it. BibSearchBar computed
// `const answerIsFinal = !awaitingServer && !failed` inside itself and correctly refused to say
// "No photos with that number" unless it was true. PhotoGrid was handed a single boolean called
// `filtered`, which is `bibEnabled && !!bibDigits` -- true from the first keystroke and knowing
// nothing about whether the server has replied.
//
// So on a 5,000-photo album, where the first window is ~500 rows, a runner typing bib 3400 got:
//
//     bar   ->  "Searching…"                        (correct)
//     grid  ->  "No photos with that number"        (a negative we did not hold)
//               "Try a different number, or clear the box to see the whole album."
//
// The subtitle is the worst part: it instructs someone to abandon a correct search that was about
// to succeed. On a race album the search IS the primary path, so this is the screen most guests
// see. AGENTS.md rule 20 names this the worst string this product can print, and the fix that was
// made for it went to the bar, because the bar is where it was reported -- nothing carried it to
// the grid, because there was no shared value to carry.
//
// The same hole existed on the failure path: a failed request left `bibServerAnswered` false, the
// local filter returned nothing, and the grid stated absence for a search that never ran.
//
// ERRS TOWARD "NOT FINAL" (rule 19). Every branch that cannot PROVE we hold the answer to the
// current question resolves to 'searching'. A needless spinner costs a moment; a false negative
// costs a runner their photographs, and they do not come back to check.
export type SearchPhase =
  /** No search is running. An empty grid means the album is empty. */
  | 'off'
  /** A question has been asked and no final answer is held for it yet. */
  | 'searching'
  /** The request failed. We hold no answer at all, and must not present one. */
  | 'failed'
  /** We hold the final answer to the question currently in the box. */
  | 'answered'

export function searchPhase(input: {
  /** Search is available on this album at all. */
  enabled: boolean
  /** The normalised question in the box right now. Empty means no question. */
  query: string
  /** The question the held result answers, or null if no result is held. */
  answeredQuery: string | null
  /** The question whose request failed, or null. */
  failedQuery: string | null
}): SearchPhase {
  if (!input.enabled || !input.query) return 'off'
  // FAILURE IS CHECKED BEFORE A HELD ANSWER, deliberately, and this order carries a PRECONDITION:
  // a failure tag must describe the LATEST attempt for that question. Given that, a result still in
  // hand is older than the failure, and presenting it as the answer would state something we no
  // longer know.
  //
  // The precondition is not free, and the first version of this file assumed it instead of
  // establishing it. The caller tagged failures but never retired them on success, so a number that
  // failed once read as failed forever -- including while its own successful results were on
  // screen. An adversarial review found it. The caller now clears the tag when a request for the
  // same question succeeds; if a future caller forgets to, this branch goes back to lying, so the
  // preference is stated here rather than assumed.
  if (input.failedQuery !== null && input.failedQuery === input.query) return 'failed'
  if (input.answeredQuery !== null && input.answeredQuery === input.query) return 'answered'
  // A result is held, but for a DIFFERENT question -- the runner typed another digit while the
  // reply for the shorter number was in flight. That is not an answer to what is being asked now.
  return 'searching'
}

/**
 * May a surface state that nothing was found?
 *
 * Exported as its own name because that is the question every caller is really asking, and because
 * `phase === 'answered'` read at four call sites is four chances to write `!==`.
 */
export function mayStateAbsence(phase: SearchPhase): boolean {
  return phase === 'answered'
}
