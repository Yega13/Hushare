import type { Photo } from '@/types'

export type BibRange = { min: number | null; max: number | null }

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
export const MAX_BIB_DIGITS = 6

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
  const out: string[] = []
  for (let width = bare.length; width <= MAX_BIB_DIGITS; width++) out.push(bare.padStart(width, '0'))
  return out
}
