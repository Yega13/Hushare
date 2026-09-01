// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React, { useState } from 'react'
import PhotoTileList, { type PhotoTileListProps } from '@/components/photo-grid/PhotoTileList'
import type { Photo } from '@/types'

// THE MEMO BOUNDARY THAT MAKES A BIG ALBUM USABLE — and the only test that can see it working.
//
// On the 4,566-photo race album the lightbox took about two seconds to open and to close. Nothing
// was wrong with the tiles; the lightbox's own state (which photo, zoom, swipe offset, which
// original had loaded) lived in the same component that rendered them, so every frame of a swipe
// re-rendered thousands of tiles. Worse, the close path runs its update inside
// startViewTransition, so that synchronous whole-grid render happened while the browser was
// waiting to take its snapshot.
//
// The fix is React.memo on the tile list plus a rule: every prop it takes is a primitive, a Set,
// or a ref — never a fresh object, array or arrow function. That rule is invisible. Adding
// `onSomething={() => ...}` or `style={{...}}` to the call site silently reverts the entire win
// and every other test stays green, which is exactly the kind of regression rule 15 says to guard
// at the enforcement point rather than at the decision.
//
// So this renders the real component and COUNTS renders while changing state that is not about
// tiles. If the count moves, the memo is not bailing and the lag is back.

vi.mock('@/components/photo-grid/PhotoTile', () => ({
  default: (props: { photo: Photo }) => {
    renders.push(props.photo.id)
    return <div data-testid="tile" data-id={props.photo.id} />
  },
}))

let renders: string[] = []

afterEach(() => { cleanup(); renders = [] })

const photos: Photo[] = Array.from({ length: 6 }, (_, i) => ({
  id: `p${i}`, display_radius: null, display_filter: null, media_type: 'image',
} as Photo))

function baseProps(): PhotoTileListProps {
  return {
    gridRef: React.createRef<HTMLDivElement>(),
    photos,
    masonry: false,
    masonryColumns: [],
    gridColumnsMobile: 3,
    gridColumnsDesktop: 4,
    eagerFirstRowCount: 3,
    mediaRadius: 8,
    mediaFilter: 'none',
    photoStyle: null,
    forceGlobalRadius: false,
    settingsPhotoId: null,
    settingsRadius: 0,
    settingsFilter: 'none',
    arrangeMode: false,
    reorderDraggingId: null,
    reorderTargetId: null,
    flippedPhotoId: null,
    broken: new Set<string>(),
    posterBroken: new Set<string>(),
    isOwner: false,
    coverPhotoId: null,
    selectMode: false,
    selectedIds: new Set<string>(),
    handlers: { current: {} as PhotoTileListProps['handlers']['current'] },
  }
}

/** A parent that re-renders on a real click while handing the list the SAME props every time. */
function Harness() {
  // Stands in for the lightbox: state the parent owns that has nothing to do with tiles.
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const [props] = useState(baseProps)
  return (
    <>
      <button onClick={() => setLightboxIndex((n) => n + 1)}>swipe</button>
      <span data-testid="idx">{lightboxIndex}</span>
      <PhotoTileList {...props} />
    </>
  )
}

describe('the tile list ignores everything that is not about tiles', () => {
  it('a parent re-render with unchanged props renders ZERO tiles', () => {
    const { getByText, getByTestId } = render(<Harness />)
    expect(renders.length, 'first paint draws every tile').toBe(photos.length)

    renders = []
    // Ten clicks stand for ten frames of a swipe, or the flushSync inside the close transition.
    // fireEvent so React actually commits each one — a loop calling a setter directly is batched
    // away and would make this test pass with no memo at all. (It did, on the first attempt.)
    for (let i = 0; i < 10; i++) fireEvent.click(getByText('swipe'))
    expect(getByTestId('idx').textContent, 'the parent really did re-render ten times').toBe('10')
    expect(
      renders.length,
      'a lightbox change must not re-render one single tile — if this is not 0, a prop at the ' +
      'call site is a fresh object, array or function and the memo never bails',
    ).toBe(0)
  })

  it('but a change that IS about tiles still gets through', () => {
    // The other half of the property: a memo that never re-renders is not a fix, it is a freeze.
    function Selectable() {
      const [selectMode, setSelectMode] = useState(false)
      return (
        <>
          <button onClick={() => setSelectMode(true)}>go</button>
          <PhotoTileList {...baseProps()} selectMode={selectMode} />
        </>
      )
    }
    const { getByText } = render(<Selectable />)
    renders = []
    // fireEvent, not .click(): it wraps the update in act() so React has actually committed
    // before the count is read. A raw .click() reads the count one render too early and reports
    // a frozen grid that is not frozen.
    fireEvent.click(getByText('go'))
    expect(renders.length, 'entering select mode changes every tile').toBe(photos.length)
  })
})
