import type { Photo } from '@/types'
import { bibMatches, type BibRange } from '@/lib/bib-match'

// WHICH PHOTOS THE GRID SHOWS, AND WHICH SIT IN THE REVIEW QUEUE.
//
// Two shipped bugs live in these few lines, which is why they left AlbumPageClient. `hidden`
// carries TWO meanings -- "a guest added this and nobody approved it" and "the owner hid this on
// purpose" -- and without the require_approval gate a photo hidden on purpose fell into a review
// queue that nagged to approve it forever. And the server returns hidden rows to an owner, so a
// bib search re-admitted the very photos the review strip had just taken out of the grid: the same
// photo in both places, the lower one reading as already published.
//
// IDENTITY IS PART OF THE CONTRACT. The grid re-packs whenever the array it is given changes, so
// when nothing is pending `published` IS `photos`, and when bib search is off `visible` IS
// `published`. A fresh array on every render repacked the masonry on every ping from realtime.

const EMPTY: Photo[] = []

export type PendingContext = { isOwner: boolean; requireApproval: boolean }

/** The review queue and what is left. `published` is `photos` itself when nothing is pending. */
export function partitionPending(photos: Photo[], ctx: PendingContext): { pending: Photo[]; published: Photo[] } {
  const pending = ctx.isOwner && ctx.requireApproval ? photos.filter((p) => p.hidden) : EMPTY
  const published = pending.length > 0 ? photos.filter((p) => !p.hidden) : photos
  return { pending, published }
}

/** The ids the review queue holds, or null when it is empty (the common case pays nothing). */
export function pendingIdSet(pending: Photo[]): ReadonlySet<string> | null {
  return pending.length > 0 ? new Set(pending.map((p) => p.id)) : null
}

export type VisibleInput = {
  published: Photo[]
  pendingIds: ReadonlySet<string> | null
  bibEnabled: boolean
  /** The digits the runner typed; empty means no search. */
  query: string
  /** Whether the server has answered THIS query; before that the local filter stands in. */
  serverAnswered: boolean
  serverPhotos: Photo[]
  range: BibRange
}

/** What the grid draws. `published` itself when there is no search. */
export function visiblePhotos(input: VisibleInput): Photo[] {
  if (!input.bibEnabled || !input.query) return input.published
  if (input.serverAnswered) {
    const ids = input.pendingIds
    return ids ? input.serverPhotos.filter((p) => !ids.has(p.id)) : input.serverPhotos
  }
  return input.published.filter((p) => bibMatches(p, input.query, input.range))
}

/** The count a guest-facing label shows: an owner's total includes photos awaiting review. */
export function publishedTotal(total: number, pendingCount: number): number {
  return Math.max(0, total - pendingCount)
}
