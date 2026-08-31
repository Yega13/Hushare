import { describe, it, expect } from 'vitest'
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
})
