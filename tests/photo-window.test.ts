import { describe, it, expect } from 'vitest'
import { applyPhotoWindow, mergePreservingExtras, shouldApplyRefresh } from '@/lib/photo-window'
import type { Photo } from '@/types'

// WHAT A GUEST SEES WHEN THE ALBUM REFRESHES UNDER THEM.
//
// A realtime ping, an upload finishing, a settings broadcast — each re-fetches only the FIRST
// window. What happens to the photos the guest has already scrolled past is decided here, and both
// ways of being wrong are silent: photos vanish under a scrolling guest, or the same photo appears
// twice. Neither throws. Both read as "the app is glitchy".
const p = (id: string): Photo => ({ id } as Photo)
const ids = (list: Photo[]) => list.map((x) => x.id).join(',')
const WINDOW = 500

describe('a refresh does not take photos off the screen', () => {
  it('keeps the tail a guest has scrolled into', () => {
    // The failure this exists to prevent: guest loads page 2, a refresh arrives, and everything
    // past the first window disappears while they are looking at it.
    const prev = [p('a'), p('b'), p('tail1'), p('tail2')]
    const fresh = [p('a'), p('b')]
    expect(ids(applyPhotoWindow(prev, fresh, 900, WINDOW))).toBe('a,b,tail1,tail2')
  })

  it('replaces outright when the window IS the whole album', () => {
    // The common case, and the only path on which a photo deleted somewhere else actually
    // disappears. If this merged instead, a deleted photo would linger until a reload.
    const prev = [p('a'), p('b'), p('deleted-elsewhere')]
    const fresh = [p('a'), p('b')]
    expect(ids(applyPhotoWindow(prev, fresh, 2, WINDOW))).toBe('a,b')
  })

  it('switches strategy exactly at the window size', () => {
    const prev = [p('a'), p('gone')]
    const fresh = [p('a')]
    expect(ids(applyPhotoWindow(prev, fresh, WINDOW, WINDOW)), 'at the size: replace').toBe('a')
    expect(ids(applyPhotoWindow(prev, fresh, WINDOW + 1, WINDOW)), 'past it: merge').toBe('a,gone')
  })

  it('never shows the same photo twice', () => {
    // A photo that MOVED from the tail into the window is in both lists. Matching by id is what
    // stops it rendering as two tiles of the same picture.
    const prev = [p('a'), p('moved')]
    const fresh = [p('moved'), p('a')]
    const out = applyPhotoWindow(prev, fresh, 900, WINDOW)
    expect(out.length).toBe(new Set(out.map((x) => x.id)).size)
    expect(ids(out)).toBe('moved,a')
  })

  it('prefers the FRESH copy of a photo, not the stale one on screen', () => {
    // Captions, rotation and hide state all arrive this way. Keeping the old object would make an
    // edit appear to save and then silently revert on the next refresh.
    const stale = { id: 'a', caption: 'old' } as unknown as Photo
    const fresh = { id: 'a', caption: 'new' } as unknown as Photo
    const out = applyPhotoWindow([stale], [fresh], 900, WINDOW)
    expect((out[0] as unknown as { caption: string }).caption).toBe('new')
  })

  it('keeps the same array when there is no tail, so the grid does not re-render', () => {
    // 5,000 tiles re-rendering because a refresh built an identical array is exactly the kind of
    // waste that makes a big album feel broken on a phone.
    const fresh = [p('a'), p('b')]
    expect(applyPhotoWindow([p('a')], fresh, 900, WINDOW)).toBe(fresh)
  })
})

describe('the upload path always merges, deliberately', () => {
  it('keeps tiles realtime delivered while the query was in flight', () => {
    // A replace here would briefly remove the uploader's OWN photos from under them, which is the
    // most alarming possible moment to lose a tile.
    const prev = [p('a'), p('just-arrived')]
    expect(ids(mergePreservingExtras(prev, [p('a')]))).toBe('a,just-arrived')
  })
})

describe('a failed refresh is not an empty album', () => {
  it('refuses to apply a null result', () => {
    // A flaky venue connection returns null. Treating that as "the album is empty" blanks every
    // screen in the room at once.
    expect(shouldApplyRefresh(null)).toBe(false)
    expect(shouldApplyRefresh(undefined)).toBe(false)
  })

  it('applies a real one, including a genuinely empty album', () => {
    // An album that really has no photos must still be applied, or a deleted-to-zero album keeps
    // showing its old contents.
    expect(shouldApplyRefresh({ photos: [], total: 0 })).toBe(true)
  })
})
