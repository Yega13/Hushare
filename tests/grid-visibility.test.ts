import { describe, it, expect } from 'vitest'
import { partitionPending, pendingIdSet, publishedTotal, visiblePhotos } from '../src/lib/grid-visibility'
import type { Photo } from '@/types'

// WHICH PHOTOS THE GRID SHOWS. Two shipped bugs are named in the module; the identity contract
// (the grid re-packs when the array changes) is asserted with toBe, not toEqual.

const photo = (id: string, over: Partial<Photo> = {}) => ({ id, hidden: false, bib_numbers: [], ...over }) as unknown as Photo
const P = [photo('a'), photo('b', { hidden: true, bib_numbers: ['45'] }), photo('c', { bib_numbers: ['45'] })]
const NO_RANGE = { min: null, max: null }

describe('partitionPending -- what "hidden" means depends on the album', () => {
  it('a guest never gets a review queue, hidden rows or not', () => {
    const r = partitionPending(P, { isOwner: false, requireApproval: true })
    expect(r.pending).toEqual([])
    expect(r.published).toBe(P)
  })
  it('an owner with approval OFF keeps a deliberately hidden photo in the grid (no queue that nags forever)', () => {
    const r = partitionPending(P, { isOwner: true, requireApproval: false })
    expect(r.pending).toEqual([])
    expect(r.published).toBe(P)
  })
  it('an owner with approval ON gets the hidden rows as the queue, and the rest as the grid', () => {
    const r = partitionPending(P, { isOwner: true, requireApproval: true })
    expect(r.pending.map((p) => p.id)).toEqual(['b'])
    expect(r.published.map((p) => p.id)).toEqual(['a', 'c'])
  })
  it('published IS photos when nothing is pending, even for an owner with approval on', () => {
    const none = [photo('a'), photo('c')]
    expect(partitionPending(none, { isOwner: true, requireApproval: true }).published).toBe(none)
  })
  it('the id set is null when the queue is empty, so the common case pays nothing', () => {
    expect(pendingIdSet([])).toBeNull()
    expect(pendingIdSet([photo('b')])?.has('b')).toBe(true)
  })
})

describe('visiblePhotos -- what the grid draws', () => {
  const { pending, published } = partitionPending(P, { isOwner: true, requireApproval: true })
  const pendingIds = pendingIdSet(pending)
  const base = { published, pendingIds, bibEnabled: true, query: '45', serverAnswered: false, serverPhotos: [], range: NO_RANGE }

  it('with bib search off the grid gets published ITSELF', () => {
    expect(visiblePhotos({ ...base, bibEnabled: false })).toBe(published)
  })
  it('with nothing typed the grid gets published itself, even with search on', () => {
    expect(visiblePhotos({ ...base, query: '' })).toBe(published)
  })
  it('before the server answers, the local filter runs over PUBLISHED only -- not the queue, not a stale server list', () => {
    const stale = [photo('b', { bib_numbers: ['45'] }), photo('z', { bib_numbers: ['45'] })]   // an older query's answer
    expect(visiblePhotos({ ...base, serverPhotos: stale }).map((p) => p.id)).toEqual(['c'])       // b is pending and hidden
  })
  it("the server's answer drops the photos the review strip holds (they were in both places)", () => {
    const server = [photo('b', { bib_numbers: ['45'] }), photo('c', { bib_numbers: ['45'] })]
    expect(visiblePhotos({ ...base, serverAnswered: true, serverPhotos: server }).map((p) => p.id)).toEqual(['c'])
  })
  it("the server's answer is handed through untouched when nothing is pending", () => {
    const server = [photo('c')]
    expect(visiblePhotos({ ...base, pendingIds: null, serverAnswered: true, serverPhotos: server })).toBe(server)
  })
  it('the local filter honours the race range', () => {
    expect(visiblePhotos({ ...base, range: { min: 100, max: null } })).toEqual([])
  })
})

describe('publishedTotal', () => {
  it("an owner's total minus the queue, never negative", () => {
    expect(publishedTotal(10, 3)).toBe(7)
    expect(publishedTotal(2, 5)).toBe(0)
  })
})
