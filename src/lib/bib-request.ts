import type { Photo } from '@/types'

// WHAT A BIB SEARCH ASKS, AND WHAT ITS ANSWER MEANS. Both sat inline in the album page's search
// effect; the fetch and the setState stay there.

export const BIB_RESULT_LIMIT = 300
export const BIB_TYPING_DEBOUNCE_MS = 300

export type BibRequestPlan = { url: string; delayMs: number; kind: 'search' | 'stats' }

/**
 * The request for what the runner typed. Digits are a search: LIMITED, because OCR reads every
 * number in the frame, so a banner year like "2026" is a real stored value and without a cap
 * returns up to 2,000 full rows -- no runner is in 300 photos, so nothing legitimate is lost --
 * and debounced, so typing "1234" is one request, not four (300 ms sits below a noticeable
 * pause and above a fast typist's gap). An empty box asks for the index stats instead, once per
 * page load: two full count scans whose answer cannot change between keystrokes, so they are
 * never sent per search.
 */
export function bibRequestPlan(albumId: string, digits: string): BibRequestPlan {
  const base = `/api/album/photos?albumId=${encodeURIComponent(albumId)}`
  if (digits) {
    return { url: `${base}&bib=${encodeURIComponent(digits)}&limit=${BIB_RESULT_LIMIT}`, delayMs: BIB_TYPING_DEBOUNCE_MS, kind: 'search' }
  }
  return { url: `${base}&bibStats=1&statsOnly=1`, delayMs: 0, kind: 'stats' }
}

export type BibStats = { indexed: number; totalImages: number }
export type BibResult = { query: string; photos: Photo[]; total: number }
export type BibResponse = { photos?: Photo[]; total?: number; bibStats?: BibStats }

/**
 * What a successful answer changes. Stats travel whenever present. A stats-only reply carries no
 * photos and must NOT become "no matches". A search answer is TAGGED with the digits it answers
 * (a slow reply for "12" landing after a fast one for "1234" would otherwise show the wrong
 * runner), keeps the TRUE total so a capped list can say "first 300 of 1,847", and RETIRES a
 * failure tag for the same number: without that a runner who hit one 429 on "3400", edited to
 * "340" and typed the 0 back was shown "Could not search just now" above the photos the retry
 * had already fetched, for the rest of the session.
 */
export function applyBibResponse(digits: string, json: BibResponse): {
  stats: BibStats | null
  result: BibResult | null
  retiresFailureFor: string | null
} {
  const stats = json.bibStats ?? null
  if (!digits) return { stats, result: null, retiresFailureFor: null }
  const rows = json.photos ?? []
  return {
    stats,
    result: { query: digits, photos: rows, total: json.total ?? rows.length },
    retiresFailureFor: digits,
  }
}

/**
 * What a failed request means. SAYING SO IS THE POINT: falling back to the local filter looks
 * harmless and is not -- it filters the loaded window, finds nothing, and the bar states "No
 * photos found" with full confidence to a runner who is in twelve photos. A failed stats request
 * tags nothing; there was no search to be honest about.
 */
export function bibFailureTag(digits: string): string | null {
  return digits ? digits : null
}
