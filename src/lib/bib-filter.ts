// WHICH NUMBERS ON A PHOTOGRAPH ARE ACTUALLY RACE BIBS.
//
// Rekognition's DetectText reads every number in the frame. The old rule kept all of them -- any
// 1-6 digit token above 80% confidence -- which is why bib search on the one real race album is
// mostly wrong. Measured over its 4,566 photos and 10,564 stored numbers:
//
//     2026   on 1,145 photos (25% of the album)   the year printed on the FINISH ARCH
//     700    on   508                             \
//     044    on   485                              }  one advertising billboard: "044 499 700"
//     499    on   451                             /
//     23     on   226                             the date, "23 AUGUST 2026"
//
// A runner searching 44 was handed 485 photographs of somebody else's race.
//
// THE RULE: a number counts only if it is ALONE ON ITS OCR LINE.
//
// This is not a heuristic fitted to one album; it falls out of what a "line" means to the API.
// From the DetectText documentation: "A line is a string of equally spaced words... A line ends
// when there is no aligned text after it or when there's a large gap between words, relative to
// the length of the words." A bib on a runner's chest has nothing aligned beside it, so it becomes
// its own line. A sponsor's phone number is equally spaced and aligned, so "044 499 700" comes back
// as ONE line of three words. The rule separates typographically isolated text from typographically
// grouped text, which is exactly the difference between a bib and a sign.
//
// Measured against a label built only from numbers verified by eye on the photographs:
//
//     current (keep everything)   noise removed   0%     candidate bibs lost   0%
//     alone on its line          noise removed  96.3%    candidate bibs lost  3.3%
//
// On a second race entirely (different city, different sponsor, 5-digit zero-padded bibs) the rule
// dropped 6 tags and every one was noise -- 4x "2026" inside ONERUN banner text and 14/115 from a
// parked car's licence plate -- while losing none of the 32 real bibs.
//
// WHICH WAY IT ERRS (rule 19): toward DROPPING. The cost is measured and it is real: a bib whose
// own printed event text merges into its line is lost. Bib 2144 reads as "2144 HALF MARRATHON"
// because the race name is printed on the bib itself, and this rule discards it. That is one tag in
// 456 candidates. The other direction costs a runner hundreds of photographs of strangers, and the
// product has an escape hatch for a number that cannot be read -- Face Finder -- which is offered
// precisely when a bib search comes back empty.
//
// SIX ALTERNATIVES WERE MEASURED AND ARE WORSE. Recorded so nobody spends the afternoon again:
//
//   person bounding boxes    75.7% noise removed, and it needs a second billed API call per photo.
//                            It fails on the case that matters: runners stand IN FRONT of the
//                            finish arch, so the banner's "2026" lands inside a person box.
//   text height              96.8% noise removed but 87.2% of real bibs destroyed with it.
//   vertical position        21.5%.
//   "line has <= 2 words"    80.9%, and it readmits "23 AUGUST 2026".
//   line recurrence          98.9% on the big album -- and on a 69-photo album the same threshold
//                            deletes real bibs, because a runner appears on 1-4 photos whatever the
//                            album size while an album-relative floor scales with it. The migration
//                            20260814_bib_range.sql already recorded that frequency cannot separate
//                            a banner year from a bib; this is that warning, measured again.
//   token position           recovers 2144, and readmits "044 499 700", "077 910-922" and "5 RON".
//
// What this rule does NOT fix: "2026" printed alone on the arch survives it, on about 75 photos of
// that album. No line-arity rule can reach an isolated year. That is what the owner-confirmed
// exclusion list is for, and it is a separate decision with a human in front of it.

/** Longest number a bib can be. Also the width bibSearchCandidates pads to when matching. */
// "The same number" is defined once, in bib-exclusions, and both the owner's list and search
// already compare through it. Indexing needs the same definition to avoid storing one runner twice
// under two spellings, and a second copy of the rule here is how the two halves start disagreeing
// about what a number is (rule 13).
import { numericKey } from '@/lib/bib-exclusions'

export const MAX_BIB_DIGITS = 6

/**
 * Confidence floor for a detection to count at all.
 *
 * Kept at Rekognition's own reading rather than tuned: below this the digits themselves are in
 * doubt, and a wrong number is worse than a missing one because it sends a runner to a stranger's
 * photograph rather than to Face Finder.
 */
export const MIN_BIB_CONFIDENCE = 80

/**
 * One word from DetectText, reduced to what the decision needs.
 *
 * Structural rather than the AWS response type: this module is pure and client-safe, and a test
 * should be able to build a photograph's worth of words without importing a vendor SDK shape.
 */
export type DetectedWord = {
  /** DetectedText, as read. */
  text: string
  confidence: number
  /** ParentId -- the LINE this word belongs to. Words sharing one are on the same line. */
  lineId: number | null | undefined
}

export type AcceptedBib = { number: string; confidence: number }

/**
 * The digits of a token, or null if it is not bib-shaped.
 *
 * A leading '#', 'N' or the ordinal sign is stripped because bibs print them; everything else must
 * be digits. Exported so the search side can ask the same question of a typed query rather than
 * carrying its own copy of the shape (rule 13 -- the regex and MAX_BIB_DIGITS lived in two files).
 */
export function bibDigitsOf(token: string): string | null {
  const cleaned = token.trim().replace(/^[#nN°]/, '')
  if (!cleaned) return null
  if (cleaned.length > MAX_BIB_DIGITS) return null
  if (!/^[0-9]+$/.test(cleaned)) return null
  return cleaned
}

/**
 * The numbers on this photograph that are worth storing as bibs.
 *
 * DEDUPLICATION HAPPENS FIRST, AND THE SURVIVOR DECIDES. One number can be read several times on
 * one photograph -- a bib and a banner both showing 2026. The highest-confidence reading is kept,
 * and the line rule is applied to THAT reading, not to whether any reading was isolated.
 *
 * The two orderings differ on 3 of 712 tags in the sample and the stricter one is right: 2 of the 3
 * are the banner year, which "was any reading alone?" would readmit. Pinned by its own test, and by
 * a mutation, because it is the kind of ordering that reads as an implementation detail and is not.
 */
export function acceptedBibs(
  words: DetectedWord[],
  minConfidence: number = MIN_BIB_CONFIDENCE,
): AcceptedBib[] {
  // How many words share each line -- counted over EVERY word, not only the numeric ones.
  // "2144 HALF MARRATHON" is a two-word line whose second word is not a number, and it must be
  // rejected for exactly the same reason "044 499 700" is: something else is printed beside it.
  const wordsPerLine = new Map<number, number>()
  for (const w of words) {
    if (w.lineId === null || w.lineId === undefined) continue
    wordsPerLine.set(w.lineId, (wordsPerLine.get(w.lineId) ?? 0) + 1)
  }

  // KEYED BY VALUE, NOT BY SPELLING. OCR keeps leading zeros, so "945" and "0945" were two
  // entries for one runner: one photograph counted twice in the owner's signage tallies, which
  // lands exactly on the floor where a single photograph decides whether a number is offered for
  // exclusion at all. Measured at 2 of 4,697 indexed photographs -- rare, and never in the safe
  // direction, because an over-count only ever makes a number look more like signage. Search has
  // always compared by value (bib-match pads the query to every spelling), so the second spelling
  // bought nothing and could only miscount.
  //
  // THE MAX-CONFIDENCE READING STILL DECIDES, and that ordering is measured, not preference: see
  // the note above the tests for it. Keying by value only changes WHICH readings compete for the
  // slot -- it does not change that the winner, and only the winner, faces the line rule.
  const best = new Map<string, { word: DetectedWord; digits: string }>()
  for (const w of words) {
    if (!Number.isFinite(w.confidence) || w.confidence < minConfidence) continue
    const digits = bibDigitsOf(w.text)
    if (digits === null) continue
    // The shared definition of "the same number", never a second copy of it (rule 13).
    const key = numericKey(digits)
    if (key === null) continue
    const prev = best.get(key)
    if (prev === undefined || w.confidence > prev.word.confidence) best.set(key, { word: w, digits })
  }

  const out: AcceptedBib[] = []
  for (const { word: w, digits } of best.values()) {
    // A word with no line at all is not evidence of isolation, it is missing information, so it is
    // refused. Measured on 8,939 real detections across two albums, ParentId was present on every
    // one -- so this branch is unreachable today and must stay the safe direction rather than
    // become a convenient default if the API ever omits it.
    if (w.lineId === null || w.lineId === undefined) continue
    if ((wordsPerLine.get(w.lineId) ?? 0) !== 1) continue
    // The spelling of the reading that won, so the stored value is what OCR actually read.
    out.push({ number: digits, confidence: w.confidence })
  }
  return out
}
