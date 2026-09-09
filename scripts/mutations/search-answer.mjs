// Mutations for lib/search-answer.ts — the module that decides whether a surface may say
// "No photos with that number", which AGENTS.md rule 20 calls the worst string this product prints.
//
// Three groups, each guarding a defect that was real rather than imagined:
//
//   the indexing gate    a search completing against a half-read album returned 'answered', so the
//                        grid stated absence under a bar reporting "Still reading photos (1,200 of
//                        5,000)". Two surfaces, one question, opposite answers.
//   attemptIsOver        reusing mayStateAbsence for "is the attempt over" hid the Face Finder
//                        escape hatch for the whole of a half-read album and pinned the label on a
//                        spinner that never resolves. Found by review before it shipped.
//   the KNOWN predicates the album page falls back to counting the loaded window when the server's
//                        stats are absent, and albums default to oldest-first — so that window is
//                        the photos OCR finished first and reads as fully indexed. Unknown must
//                        claim nothing, in BOTH directions.
//
// NEEDLES ANCHOR ON SIGNATURES where a body line is shared. `  if (!progress) return false` appears
// in both predicates, and `  return phase === 'answered'` is a prefix of attemptIsOver's body — the
// runner refuses an ambiguous match rather than mutating a line the author never looked at.
export default {
  file: 'src/lib/search-answer.ts',
  test: 'tests/search-answer.test.ts',
  mutations: [
    {
      name: 'the indexing gate is deleted entirely — a half-read album states absence again',
      from: "    if (input.answerIsEmpty && !input.indexComplete) return 'indexing'",
      to: '    if (false) return \'indexing\'',
    },
    {
      name: 'the gate ignores emptiness, so a NON-empty result is withheld mid-index too',
      from: 'if (input.answerIsEmpty && !input.indexComplete) return',
      to: 'if (!input.indexComplete) return',
    },
    {
      name: 'the gate is inverted — absence withheld only once the album IS fully read',
      from: 'if (input.answerIsEmpty && !input.indexComplete) return',
      to: 'if (input.answerIsEmpty && input.indexComplete) return',
    },
    {
      name: 'failure no longer outranks a held answer',
      from: "  if (input.failedQuery !== null && input.failedQuery === input.query) return 'failed'",
      to: '  if (false) return \'failed\'',
    },
    {
      name: 'mayStateAbsence permits absence in every phase',
      from: 'export function mayStateAbsence(phase: SearchPhase): boolean {',
      to: 'export function mayStateAbsence(phase: SearchPhase): boolean { return true',
    },
    {
      name: 'attemptIsOver drops the indexing phase — hides the Face Finder escape hatch',
      from: "  return phase === 'answered' || phase === 'indexing'",
      to: "  return phase === 'answered'",
    },
    {
      name: 'attemptIsOver swallows the searching phase — the spinner stops meaning anything',
      from: "  return phase === 'answered' || phase === 'indexing'",
      to: '  return true',
    },
    {
      // THE HOLE THE REVIEW FOUND. Absent stats must never license the negative.
      name: 'indexKnownComplete treats absent server stats as a finished album',
      from: 'export function indexKnownComplete(progress: IndexProgress): boolean {',
      to: 'export function indexKnownComplete(progress: IndexProgress): boolean { return true',
    },
    {
      name: 'indexKnownIncomplete claims "still reading" with no stats at all',
      from: 'export function indexKnownIncomplete(progress: IndexProgress): boolean {',
      to: 'export function indexKnownIncomplete(progress: IndexProgress): boolean { return true',
    },
    {
      name: 'indexKnownComplete calls a partly-read album finished',
      from: '  return indexed >= totalImages',
      to: '  return true',
    },
    {
      name: 'indexKnownComplete is off by one, so the last photo never counts as read',
      from: '  return indexed >= totalImages',
      to: '  return indexed > totalImages',
    },
    {
      name: 'an empty album reports as still reading — the mirror lie, an unbacked "not yet"',
      from: '  if (totalImages <= 0) return true',
      to: '  if (totalImages <= 0) return false',
    },
    {
      name: 'indexKnownIncomplete claims an empty album is still being read',
      from: '  if (totalImages <= 0) return false',
      to: '  if (totalImages <= 0) return true',
    },
    {
      name: 'indexKnownIncomplete inverts, so the two predicates contradict each other',
      from: '  return indexed < totalImages',
      to: '  return indexed >= totalImages',
    },
    {
      // The live defect: bibSearchCandidates returns an EMPTY list for an out-of-range number, the
      // server short-circuits to zero rows, and without this branch the client reads that as a real
      // answer and prints "No photos with that number" about a number nobody searched for.
      name: 'the excluded branch is deleted — an out-of-range number states absence again',
      from: "  if (input.excludedByAlbum) return 'excluded'",
      to: '  if (false) return \'excluded\'',
    },
    {
      name: 'excluded is checked AFTER a held answer, so it can never win',
      from: "  if (input.excludedByAlbum) return 'excluded'",
      to: '',
    },
    {
      name: 'attemptIsOver drops excluded — the escape hatch disappears for a ranged-out number',
      from: "  return phase === 'answered' || phase === 'indexing' || phase === 'excluded'",
      to: "  return phase === 'answered' || phase === 'indexing'",
    },
    {
      name: 'an excluded number is told "no photos with that number" — the forbidden negative',
      from: "    case 'excluded': return 'bib.outOfRange'",
      to: "    case 'excluded': return 'pg.noMatches'",
    },
    {
      name: 'a half-read album is told the same',
      from: "    case 'indexing': return 'bib.searching'",
      to: "    case 'indexing': return 'pg.noMatches'",
    },
    {
      name: 'the subtitle stops tracking mayStateAbsence and advises on every phase',
      from: "  return mayStateAbsence(phase) ? 'pg.noMatchesSub' : null",
      to: "  return 'pg.noMatchesSub'",
    },
    {
      name: 'the empty album loses its own subtitle and inherits the search advice',
      from: "  if (phase === 'off') return 'pg.emptySub'",
      to: "  if (phase === 'off') return 'pg.noMatchesSub'",
    },
  ],
}
