import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PREFETCH_DELTAS, stripWindow, morphAllowed } from '../src/lib/lightbox-plan'

describe('PREFETCH_DELTAS', () => {
  it('is current + one ahead + one behind, current first', () => {
    // Order matters: the loop assigns fetchPriority high to delta 0 and starts requests
    // in array order, so the visible photo must be first.
    expect(PREFETCH_DELTAS).toEqual([0, 1, -1])
  })

  it('never reaches past the adjacent neighbour', () => {
    // The regression this module was born from: ±2 neighbours at full resolution,
    // twice (two loops), was 7 downloads per swipe. Any delta beyond ±1 reintroduces it.
    for (const d of PREFETCH_DELTAS) expect(Math.abs(d)).toBeLessThanOrEqual(1)
  })
})

describe('stripWindow', () => {
  it('centres the window on the index', () => {
    expect(stripWindow(100, 3757, 20)).toEqual({ start: 80, end: 121 })
  })

  it('clamps at the start without going negative', () => {
    expect(stripWindow(3, 3757, 20)).toEqual({ start: 0, end: 24 })
  })

  it('clamps at the end without reading past the album', () => {
    expect(stripWindow(3756, 3757, 20)).toEqual({ start: 3736, end: 3757 })
  })

  it('survives an out-of-range index instead of returning an empty slice', () => {
    // The lightbox index can briefly point past the array while a realtime refetch
    // swaps viewerPhotos underneath an open slideshow. An empty strip would blank the
    // position indicator mid-show; clamping to the last photo keeps it honest enough.
    expect(stripWindow(9999, 50, 20)).toEqual({ start: 29, end: 50 })
    expect(stripWindow(-5, 50, 20)).toEqual({ start: 0, end: 21 })
  })

  it('returns an empty window only for an empty album', () => {
    expect(stripWindow(0, 0, 20)).toEqual({ start: 0, end: 0 })
  })

  it('a small album renders in full', () => {
    expect(stripWindow(2, 5, 20)).toEqual({ start: 0, end: 5 })
  })
})

describe('morphAllowed', () => {
  it('keeps the morph for ordinary albums and drops it for event-scale ones', () => {
    expect(morphAllowed(1)).toBe(true)
    expect(morphAllowed(600)).toBe(true)
    expect(morphAllowed(601)).toBe(false)
    expect(morphAllowed(4565)).toBe(false)
  })

  it('is asked about the ALBUM at every call site, never the loaded window', () => {
    // The decision above was always right; the number fed to it was not. Keyed on photos.length,
    // a FRESH load of the 4,566-photo race album carried 499 tiles — under the limit — so the
    // full-page view transition ran on precisely the album this gate exists to protect, and
    // startViewTransition suppresses all painting until its captures finish: a ten-second frozen
    // screen on every tap, invisible to every test done on a scrolled album. Rule 15's shape —
    // the decision was in lib and tested, its enforcement drifted alone.
    const source = readFileSync(join(process.cwd(), 'src', 'components', 'PhotoGrid.tsx'), 'utf8')
    const calls = [...source.matchAll(/morphAllowed\(([^)]*)\)/g)].map((m) => m[1])
    expect(calls.length, 'the open, openedWithMorph and close gates').toBeGreaterThanOrEqual(3)
    for (const arg of calls) {
      expect(arg, 'must include the album total, with the window only as a floor')
        .toContain('albumPhotoCount')
    }
  })
})
