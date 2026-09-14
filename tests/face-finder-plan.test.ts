import { describe, it, expect } from 'vitest'
import { canSkipFaceIndexing, type ScannablePhoto } from '@/lib/face-finder-plan'

// WHETHER FACE FINDER MAY GO STRAIGHT TO THE SELFIE. Every wrong "yes" is a runner told they are in no
// photos while their photos simply have not been scanned (rule 20); every wrong "no" costs one request.

const scanned = (n: number): ScannablePhoto[] => Array.from({ length: n }, () => ({ media_type: 'image', face_ids: ['f'] }))
const unscanned = (n: number): ScannablePhoto[] => Array.from({ length: n }, () => ({ media_type: 'image', face_ids: null }))
const video = (n: number): ScannablePhoto[] => Array.from({ length: n }, () => ({ media_type: 'video', face_ids: null }))

describe('canSkipFaceIndexing', () => {
  it('THE BUG IT EXISTS FOR: the first 500 loaded and scanned, in an album of 4,566, is NOT a whole scanned album', () => {
    expect(canSkipFaceIndexing(scanned(500), 4566)).toBe(false)
  })

  it('skips when the loaded photos are the whole album and every image is scanned', () => {
    expect(canSkipFaceIndexing(scanned(25), 25)).toBe(true)
  })

  it('does not skip when any loaded image is unscanned, even in a small album', () => {
    expect(canSkipFaceIndexing([...scanned(24), ...unscanned(1)], 25)).toBe(false)
  })

  it('a photo row with no face_ids field at all is unscanned, not scanned', () => {
    expect(canSkipFaceIndexing([...scanned(24), { media_type: 'image' }], 25)).toBe(false)
  })

  it('videos are not scanned and do not block the skip', () => {
    expect(canSkipFaceIndexing([...scanned(20), ...video(5)], 25)).toBe(true)
  })

  it('an album with no images at all asks the server rather than skipping to a search over nothing', () => {
    expect(canSkipFaceIndexing(video(3), 3)).toBe(false)
    expect(canSkipFaceIndexing([], 0)).toBe(false)
  })

  it('one photo short of the album total is not the whole album', () => {
    expect(canSkipFaceIndexing(scanned(499), 500)).toBe(false)
    expect(canSkipFaceIndexing(scanned(500), 500)).toBe(true)
  })

  it('a total it cannot read is not a total: it asks the server', () => {
    expect(canSkipFaceIndexing(scanned(10), Number.NaN)).toBe(false)
    expect(canSkipFaceIndexing(scanned(10), Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('more loaded than the reported total (a total that lagged a live upload) still counts as the whole album', () => {
    expect(canSkipFaceIndexing(scanned(30), 25)).toBe(true)
  })
})
