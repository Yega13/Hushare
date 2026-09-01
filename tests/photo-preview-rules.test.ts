import { describe, it, expect } from 'vitest'
import { previewRadius, previewFilter } from '../src/components/photo-grid/usePhotoSettings'
import type { Photo } from '../src/types'

// WHAT A TILE LOOKS LIKE — asked in two places that must never disagree.
//
// These two rules decide the corner radius and the colour filter every tile in the album renders
// with. They used to live as closures inside usePhotoSettings, which meant the memoised tile list
// could not use them without taking a fresh function on every render and silently defeating its own
// memo. Copying them into the grid would have been the same fact written twice (rule 13) — and this
// is a fact that MOVES while somebody drags a slider, so the two copies would disagree visibly, on
// screen, mid-edit.
//
// So they are pure and shared, and this file is what holds the shared version honest.

const photo = (over: Partial<Photo> = {}): Photo =>
  ({ id: 'p1', display_radius: null, display_filter: null, ...over }) as Photo

const ALBUM = { media_radius: 8, media_filter: 'none' as const }

describe('the radius a tile shows', () => {
  it('falls back to the album radius when the photo has no override', () => {
    expect(previewRadius(photo(), ALBUM, false, null, 0)).toBe(8)
  })

  it('prefers the photo\'s own override', () => {
    expect(previewRadius(photo({ display_radius: 24 }), ALBUM, false, null, 0)).toBe(24)
  })

  it('forceGlobalRadius overrules the photo — that is what the album-wide slider is for', () => {
    // The owner dragging the album radius slider must see EVERY tile move, including ones that
    // carry their own radius. Otherwise the control looks broken on exactly the photos someone
    // took the trouble to customise.
    expect(previewRadius(photo({ display_radius: 24 }), ALBUM, true, null, 0)).toBe(8)
  })

  it('the OPEN settings modal wins over everything, for its photo only', () => {
    // This is the live preview: the number under the slider before anything is saved.
    expect(previewRadius(photo({ id: 'p1' }), ALBUM, false, 'p1', 31)).toBe(31)
    // ...and must not leak onto any other tile.
    expect(previewRadius(photo({ id: 'p2' }), ALBUM, false, 'p1', 31)).toBe(8)
  })

  it('a live preview of zero is a real zero, not "unset"', () => {
    // Square corners are a legitimate choice; a falsy check here would snap the tile back to the
    // album radius the moment the owner dragged the slider to the bottom.
    expect(previewRadius(photo(), ALBUM, false, 'p1', 0)).toBe(0)
  })
})

describe('the filter a tile shows', () => {
  it('falls back to the album filter, then to the photo\'s own', () => {
    expect(previewFilter(photo(), ALBUM, null, 'none')).toBe('none')
    expect(previewFilter(photo({ display_filter: 'mono' }), ALBUM, null, 'none')).toBe('mono')
  })

  it('the open modal previews its own choice, for its photo only', () => {
    expect(previewFilter(photo({ id: 'p1' }), ALBUM, 'p1', 'warm')).toBe('warm')
    expect(previewFilter(photo({ id: 'p2', display_filter: 'mono' }), ALBUM, 'p1', 'warm')).toBe('mono')
  })

  it('"global" in the modal means the ALBUM\'s filter, not the photo\'s old one', () => {
    // Choosing "same as album" must show what the album does — otherwise picking it appears to do
    // nothing on a photo that already had an override, which is precisely when it is chosen.
    const withOverride = photo({ id: 'p1', display_filter: 'mono' })
    expect(previewFilter(withOverride, { media_filter: 'warm' as const }, 'p1', 'global')).toBe('warm')
  })
})
