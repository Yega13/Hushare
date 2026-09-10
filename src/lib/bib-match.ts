import type { Photo } from '@/types'
import { MAX_BIB_DIGITS } from '@/lib/bib-filter'
import { isExcludedNumber } from '@/lib/bib-exclusions'

/**
 * The album's own settings that decide which numbers can match at all.
 *
 * `excluded` rides in here rather than becoming a fourth argument because `bibMatches` is imported
 * by lib/grid-visibility, and widening a shared signature to carry one feature's fact is how a
 * refactor ends up touching files that have nothing to do with it. The name stays BibRange for the
 * same reason -- it is the album's matching settings, and the range was simply the first of them.
 */
export type BibRange = {
  min: number | null
  max: number | null
  /** Numbers the OWNER marked as signage rather than runners. Compared by value — see
   *  lib/bib-exclusions, which owns what "the same number" means. */
  excluded?: readonly string[]
}

// ONE DEFINITION OF "THIS BIB MATCHES", used by the phone and by the database.
//
// The phone filters the photos it already has so typing feels instant; the server answers over the
// WHOLE album so a runner whose photos have not been loaded yet still finds them. Two matchers
// answering the same question is a drift risk with a very quiet failure — the runner sees one
// answer, then a different one a moment later — so both are derived from this file and
// tests/bib-match.test.ts proves they agree.

/** The digits of a typed query, or '' if the guest typed nothing searchable. */
function digitsOf(query: string): string {
  return query.replace(/\D/g, '')
}

// A bib matches if the typed digits equal the detected number, ignoring the leading zeros race
// bibs are usually printed with — a runner reading "00945" off their chest types "945" as often
// as not, and both must work. This also rescues OCR that drops a zero: "0994" and "00994" both
// normalise to 994.
//
// `range` discards detections outside the race's numbering before comparing. OCR reads every
// number in the frame, including banner years and lap counters, and on a race numbered 1-500 a
// stray "14" would otherwise hand runner 14 a photo they are not in. Filtering here rather than at
// indexing time means correcting the range is instant and costs no re-OCR.
export function bibMatches(photo: Photo, query: string, range?: BibRange): boolean {
  const q = digitsOf(query)
  if (!q) return true
  const wanted = Number(q)
  return (photo.bib_numbers ?? []).some((b) => {
    const n = Number(b)
    if (!Number.isFinite(n)) return false
    if (range?.min != null && n < range.min) return false
    if (range?.max != null && n > range.max) return false
    // The owner said this number is not a runner. Checked on the STORED value, so a banner year
    // sitting on 1,145 photographs stops answering even though those rows still carry it — no
    // re-index, no re-OCR, and it takes effect the moment the list is saved.
    if (range?.excluded && isExcludedNumber(b, range.excluded)) return false
    return n === wanted
  })
}

// Bib numbers are stored as the digit strings OCR read, leading zeros and all (see
// detectBibNumbers: /^\d{1,6}$/). Postgres has no way to compare those numerically through the GIN
// index, so instead of teaching it arithmetic we hand it every spelling the number can have —
// 945, 0945, 00945, 000945 — and ask for an array overlap. That is one indexed lookup, and because
// a stored value is at most six digits the list is complete: any string whose Number() equals the
// query is the query with leading zeros, and it is in this list.
//
// Returns null when there is nothing to search for (the guest cleared the box), and an empty array
// when the query cannot match anything — a number outside the race's numbering, or longer than a
// bib can be. Empty means "no photos", NOT "no filter", and callers must keep those apart.
// Re-exported so existing importers keep working; the number itself belongs with the rule that
// produces the digits, not with the rule that matches them (it was written down in both).
export { MAX_BIB_DIGITS }

/**
 * Did the ALBUM's own settings refuse this number before any search ran?
 *
 * DERIVED FROM bibSearchCandidates, never re-implemented: an empty candidate list IS the refusal,
 * and the comment above says so — "Empty means 'no photos', NOT 'no filter', and callers must keep
 * those apart". They were kept apart at the query layer and then conflated at the MESSAGE layer:
 * the server short-circuits to zero rows, the client tags that as a real answer, and a runner whose
 * number the organiser had ranged out was told "No photos with that number", definitively, with a
 * subtitle telling them to try a different one. Reachable on any album whose range is wrong — a
 * bib_max of 300 on a race numbered to 2200 says it to everyone above 300.
 *
 * Null (nothing typed) is not a refusal.
 */
export function queryOutsideRange(query: string, range?: BibRange): boolean {
  const candidates = bibSearchCandidates(query, range)
  return candidates !== null && candidates.length === 0
}

export function bibSearchCandidates(query: string, range?: BibRange): string[] | null {
  const q = digitsOf(query)
  if (!q) return null
  const wanted = Number(q)
  if (!Number.isFinite(wanted)) return []
  if (range?.min != null && wanted < range.min) return []
  if (range?.max != null && wanted > range.max) return []
  const bare = String(wanted)
  // Not just a length check: String(Number('1'.repeat(22))) is "1e+21", which is short enough to
  // pass one. Digits only, so nothing but a real number ever reaches the query.
  if (bare.length > MAX_BIB_DIGITS || !/^[0-9]+$/.test(bare)) return []
  // Excluded numbers are refused at the QUERY too, not only in the stored values, so the server
  // never runs the lookup and searchPhase reports 'excluded' rather than a real empty answer. Both
  // halves of the same fact: the phone filters what it holds, the database answers for the album.
  //
  // AFTER the shape checks, so isExcludedNumber is only ever asked about something bib-shaped —
  // it returns false for anything else, and a guard that cannot fire reads as one that can.
  if (range?.excluded && isExcludedNumber(bare, range.excluded)) return []
  const out: string[] = []
  for (let width = bare.length; width <= MAX_BIB_DIGITS; width++) out.push(bare.padStart(width, '0'))
  return out
}
