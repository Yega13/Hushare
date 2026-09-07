import { describe, it, expect } from 'vitest'
import { clampMediaRadius, parseMediaRadiusDraft, clampSlideshowInterval } from '@/lib/media-input'
import { MAX_SLIDESHOW_INTERVAL_MS, MIN_SLIDESHOW_INTERVAL_MS } from '@/lib/media-display'

// THE CLAMPS BEHIND THE MEDIA SLIDERS. A review deleted each of these inline and nothing noticed.

describe('clampMediaRadius', () => {
  it('rounds to whole pixels and stays inside 0..radiusMax', () => {
    expect(clampMediaRadius(12.4, 40)).toBe(12)
    expect(clampMediaRadius(12.6, 40)).toBe(13)
    expect(clampMediaRadius(-5, 40)).toBe(0)
    expect(clampMediaRadius(999, 40)).toBe(40)
    expect(clampMediaRadius(40, 40)).toBe(40)
  })
})

describe('parseMediaRadiusDraft -- what the typed box means', () => {
  it('a number is clamped like the slider', () => {
    expect(parseMediaRadiusDraft('18', 40)).toBe(18)
    expect(parseMediaRadiusDraft(' 999 ', 40)).toBe(40)
    expect(parseMediaRadiusDraft('-3', 40)).toBe(0)
    expect(parseMediaRadiusDraft('7.7', 40)).toBe(8)
  })
  it('an EMPTY box is "leave it alone", never a radius of zero', () => {
    expect(parseMediaRadiusDraft('', 40)).toBeNull()
    expect(parseMediaRadiusDraft('   ', 40)).toBeNull()
  })
  it('text that is not a number is ignored too', () => {
    expect(parseMediaRadiusDraft('abc', 40)).toBeNull()
    expect(parseMediaRadiusDraft('1e400', 40)).toBeNull()
  })
})

describe('clampSlideshowInterval', () => {
  it('holds the product bounds, whole milliseconds', () => {
    expect(clampSlideshowInterval(0)).toBe(MIN_SLIDESHOW_INTERVAL_MS)
    expect(clampSlideshowInterval(Number.MAX_SAFE_INTEGER)).toBe(MAX_SLIDESHOW_INTERVAL_MS)
    expect(clampSlideshowInterval(MIN_SLIDESHOW_INTERVAL_MS + 0.4)).toBe(MIN_SLIDESHOW_INTERVAL_MS)
    expect(clampSlideshowInterval(MIN_SLIDESHOW_INTERVAL_MS + 100)).toBe(MIN_SLIDESHOW_INTERVAL_MS + 100)
    expect(MIN_SLIDESHOW_INTERVAL_MS, 'the floor this test relies on must be a positive interval').toBeGreaterThan(0)
  })
})
