import { describe, it, expect } from 'vitest'
import {
  batchByBytes, estimateBytes, estimateTotalBytes, formatBytes,
  ZIP_ASSUMED_BYTES, ZIP_BUDGET_MOBILE, ZIP_BUDGET_DESKTOP, ZIP_MAX_PER_BATCH,
} from '../src/lib/zip-batching'

const MB = 1024 * 1024
// A 25 MB-class original and a small phone snap, by pixel count.
const huge = { width: 8000, height: 6000 }    // 48 MP -> ~19 MB
const small = { width: 1200, height: 900 }    // 1.08 MP -> ~432 KB

describe('estimateBytes', () => {
  it('scales with pixels, so a big original is not counted as a small one', () => {
    expect(estimateBytes(huge)).toBeGreaterThan(estimateBytes(small) * 20)
  })

  it('falls back to a PESSIMISTIC size when dimensions are missing', () => {
    // Guessing small is how a batch ends up holding twenty 25 MB files; guessing large costs one
    // extra part file. There is no size column, so this fallback is the only guard for old rows.
    expect(estimateBytes({})).toBe(ZIP_ASSUMED_BYTES)
    expect(estimateBytes({ width: 0, height: 0 })).toBe(ZIP_ASSUMED_BYTES)
    expect(estimateBytes({ width: null, height: null })).toBe(ZIP_ASSUMED_BYTES)
  })

  it('never returns zero, or a batch could hold unlimited photos', () => {
    expect(estimateBytes({ width: 1, height: 1 })).toBeGreaterThan(0)
  })
})

describe('batchByBytes', () => {
  it('THE BUG: 500 big originals are no longer put in one batch', () => {
    // 500 x ~19 MB is over 9 GB in a browser tab. The old code batched by COUNT and did exactly
    // this; the tab was killed long before the ZIP finished.
    const parts = batchByBytes(Array.from({ length: 500 }, () => huge), ZIP_BUDGET_MOBILE)
    expect(parts.length).toBeGreaterThan(20)
    for (const part of parts) {
      const bytes = part.reduce((s, p) => s + estimateBytes(p), 0)
      // One photo may exceed the budget on its own; more than one may not.
      if (part.length > 1) expect(bytes).toBeLessThanOrEqual(ZIP_BUDGET_MOBILE)
    }
  })

  it('still puts many small photos together, so an ordinary album stays one file', () => {
    const parts = batchByBytes(Array.from({ length: 100 }, () => small), ZIP_BUDGET_DESKTOP)
    expect(parts).toHaveLength(1)
  })

  it('a phone gets more, smaller parts than a laptop for the same album', () => {
    const album = Array.from({ length: 300 }, () => huge)
    expect(batchByBytes(album, ZIP_BUDGET_MOBILE).length)
      .toBeGreaterThan(batchByBytes(album, ZIP_BUDGET_DESKTOP).length)
  })

  it('never drops a photo, whatever the sizes', () => {
    const album = [huge, small, {}, huge, small]
    expect(batchByBytes(album, ZIP_BUDGET_MOBILE).flat()).toHaveLength(album.length)
  })

  it('gives a single oversized photo its own part rather than omitting it', () => {
    const parts = batchByBytes([huge], 1024)
    expect(parts).toHaveLength(1)
    expect(parts[0]).toHaveLength(1)
  })

  it('caps the count even when photos are tiny, so one failure is not catastrophic', () => {
    const parts = batchByBytes(Array.from({ length: 1200 }, () => ({ width: 10, height: 10 })), ZIP_BUDGET_DESKTOP)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(ZIP_MAX_PER_BATCH)
    expect(parts.length).toBeGreaterThan(1)
  })

  it('handles an empty album without producing an empty part', () => {
    expect(batchByBytes([], ZIP_BUDGET_MOBILE)).toEqual([])
  })
})

describe('estimateTotalBytes / formatBytes', () => {
  it('sizes a real event album so somebody can be warned before starting', () => {
    // 4,566 photos at the platform's average 5.2 MP.
    const album = Array.from({ length: 4566 }, () => ({ width: 2800, height: 1860 }))
    const total = estimateTotalBytes(album)
    expect(total).toBeGreaterThan(5 * 1024 * MB)
    expect(formatBytes(total)).toMatch(/GB$/)
  })

  it('formats each magnitude the way a person reads it', () => {
    expect(formatBytes(900)).toBe('1 KB')
    expect(formatBytes(5 * MB)).toBe('5 MB')
    expect(formatBytes(2.5 * 1024 * MB)).toBe('2.5 GB')
  })
})
