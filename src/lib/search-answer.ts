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
  /**
   * The search ran and matched nothing, but the album has not been fully read yet — so the
   * emptiness is about our index, not about the runner. Distinct from 'answered' because only
   * 'answered' has earned the right to say "no photos with that number".
   */
  | 'indexing'
  /** We hold the final answer to the question currently in the box. */
  | 'answered'

/**
 * Has every image in this album actually been read for numbers?
 *
 * THIS LIVED IN BibSearchBar AS A PRIVATE CONST, which is the same shape as the bug this whole
 * module exists for. The bar knew the index was behind and said so; the grid underneath could not
 * know, and printed "No photos with that number" on top of the bar's "Still reading photos (1,200
 * of 5,000)". Two surfaces, one question, opposite answers — MISTAKES 33, on a second axis.
 *
 * During a race this is the NORMAL state, not an edge case: the photographer uploads continuously
 * and OCR chains behind in batches, so `indexed < total` is true for most of the event. One photo
 * whose OCR permanently fails keeps it true forever.
 *
 * WHICH WAY IT ERRS (rule 19): toward INCOMPLETE. Unreadable counts return false, so the caller
 * withholds a negative it cannot back. Being wrong that way costs a spinner; being wrong the other
 * way tells a runner they were not photographed, and they do not come back to check.
 *
 * Zero images is COMPLETE, not incomplete: an album with nothing to read is not "still reading",
 * and saying so would be the mirror of rule 20's forbidden negative — an unbacked "not yet".
 */
export type IndexProgress = { indexed: number; totalImages: number } | null | undefined

/**
 * THE COUNTS ARE ONLY WORTH ANYTHING WHEN THE SERVER SENT THEM, and this pair is what makes a
 * missing answer say "I do not know" instead of guessing.
 *
 * The album page falls back to counting the LOADED WINDOW when the server's figures have not
 * arrived — and its own comment calls that "the most reassuring possible way to be wrong": the two
 * local numbers agree with each other perfectly on a partly-loaded album ("2,000 of 2,000 read"
 * while 3,000 are still coming). That was tolerable while the numbers only decorated a hint line.
 * The moment they gate a rule-20 negative it is not, and the fallback is biased the worst way:
 * albums default to OLDEST-FIRST, so the first window holds precisely the photos OCR finished
 * first, which reads as 100% indexed.
 *
 * Worse, the stats request is fetched only when the search box is EMPTY, and the first keystroke
 * aborts it — so during a search these are frequently absent rather than rarely.
 *
 * TWO PREDICATES, NOT ONE, and they are deliberately NOT complements. Unknown makes BOTH false, so
 * neither surface may claim anything:
 *
 *   indexKnownComplete    gates the negative — unknown must not license "no photos with that number"
 *   indexKnownIncomplete  gates "still reading photos (x of y)" — unknown must not license that either
 *
 * A single boolean cannot express that, because whichever way it defaults, one of the two surfaces
 * states something it cannot back. This is the same shape as attemptIsOver below: one predicate was
 * answering two questions that only happened to share an answer.
 */
export function indexKnownComplete(progress: IndexProgress): boolean {
  if (!progress) return false
  const { indexed, totalImages } = progress
  if (!Number.isFinite(indexed) || !Number.isFinite(totalImages)) return false
  // Nothing to read IS fully read — but only when the server told us the album is empty. Reached
  // through the null branch above (no stats yet) this would license the negative at the exact
  // moment the client knows least, which is how the fallback bit.
  if (totalImages <= 0) return true
  return indexed >= totalImages
}

/** True ONLY when we know photos remain unread. Unknown is not a licence to say "still reading". */
export function indexKnownIncomplete(progress: IndexProgress): boolean {
  if (!progress) return false
  const { indexed, totalImages } = progress
  if (!Number.isFinite(indexed) || !Number.isFinite(totalImages)) return false
  if (totalImages <= 0) return false
  return indexed < totalImages
}

export function searchPhase(input: {
  /** Search is available on this album at all. */
  enabled: boolean
  /** The normalised question in the box right now. Empty means no question. */
  query: string
  /** The question the held result answers, or null if no result is held. */
  answeredQuery: string | null
  /** The question whose request failed, or null. */
  failedQuery: string | null
  /** Does the held answer contain no photos at all? Only an EMPTY answer can be a false negative,
   *  so a non-empty result stays final even mid-index: "12 photos" is true and useful then. */
  answerIsEmpty: boolean
  /** Has the whole album been read? See indexComplete — pass its result, do not re-derive it. */
  indexComplete: boolean
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
  if (input.answeredQuery !== null && input.answeredQuery === input.query) {
    // AN EMPTY ANSWER FROM A HALF-READ ALBUM IS NOT AN ANSWER. The request genuinely completed, so
    // every earlier branch is satisfied and the old code returned 'answered' here — which is what
    // let the grid state absence while the bar above it was reporting the index still running.
    // Only the empty case is withheld: a non-empty result is true now and stays true.
    if (input.answerIsEmpty && !input.indexComplete) return 'indexing'
    return 'answered'
  }
  // A result is held, but for a DIFFERENT question -- the runner typed another digit while the
  // reply for the shorter number was in flight. That is not an answer to what is being asked now.
  return 'searching'
}

/**
 * May a surface state that nothing was found?
 *
 * Exported as its own name because that is the question every caller is really asking, and because
 * `phase === 'answered'` read at four call sites is four chances to write `!==`.
 *
 * CALL THIS RATHER THAN NAMING PHASES, and put it LAST in a branch chain so the default is the
 * safe one. PhotoGrid used to read
 *
 *     searchPhase === 'searching' ? searching : searchPhase === 'failed' ? failed : noMatches
 *
 * which names the safe cases and lets everything else fall through to the forbidden negative. That
 * shape is a trap for the NEXT state: adding 'indexing' to the union would have printed "No photos
 * with that number" for a half-read album on the day it landed, with tsc perfectly happy, because
 * an unnamed phase simply took the final else. Written as `mayStateAbsence(phase) ? noMatches :
 * searching`, a new state withholds by default and the worst it can do is show a spinner.
 *
 * This is the same lesson as the union itself: a boolean makes the wrong state representable, and
 * an else-branch makes the wrong state the default.
 */
export function mayStateAbsence(phase: SearchPhase): boolean {
  return phase === 'answered'
}

/**
 * Is the request OVER — so a surface may offer the guest a way forward?
 *
 * TWO QUESTIONS THAT USED TO HAVE ONE ANSWER. While there were four phases, "may I say nothing was
 * found" and "is the attempt finished" were the same predicate, so BibSearchBar reasonably read
 * `mayStateAbsence` for both: the count label and the Face Finder escape hatch.
 *
 * Adding 'indexing' split them, and using the old predicate for both re-created a bug this repo had
 * already fixed once. Under 'indexing' the request HAS completed — it simply returned nothing while
 * the album is still being read — so `mayStateAbsence` is correctly false, and the bar therefore
 * hid the escape hatch and showed "Searching…" forever. Nothing re-fetches after that answer lands,
 * so it never resolved: the runner sat on a spinner with no way forward, at a race, on the primary
 * path. The comment above that gate in BibSearchBar describes the identical outcome reached by a
 * different route (it once required `!stillIndexing`), and MISTAKES entry 35 names the symptom in
 * the same words — "the count and the Face Finder escape hatch hidden".
 *
 * So: absence is about what we may CLAIM; this is about whether we are still waiting. A phase may
 * be over without licensing a negative, and 'indexing' is exactly that phase.
 */
export function attemptIsOver(phase: SearchPhase): boolean {
  return phase === 'answered' || phase === 'indexing'
}
