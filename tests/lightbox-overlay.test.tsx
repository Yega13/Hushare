// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import LightboxOverlay from '@/components/photo-grid/LightboxOverlay'
import { LocaleProvider } from '@/i18n/LocaleProvider'
import { en } from '@/i18n/dictionaries/en'
import type { Photo } from '@/types'

// THE FULL-SCREEN PHOTO VIEWER EVERY GUEST OPENS, RENDERED BY A TEST FOR THE FIRST TIME.
//
// 734 lines with no test at all on 2026-09-14 (78 of 88 components had none). What it decides is what
// a guest can do to somebody's album: whether the delete and header-photo controls exist for them,
// whether a tap on an arrow also closes the viewer, what the counter claims, and what can be
// downloaded. Every label below is read from the English dictionary, never retyped (rule 13).

const photo = (n: number, over: Partial<Photo> = {}): Photo => ({
  id: `p${n}`,
  album_id: 'a1',
  url: `https://cdn.example.test/albums/a1/p${n}.jpg`,
  thumb_url: `https://cdn.example.test/thumbs/a1/p${n}.jpg`,
  media_type: 'image',
  caption: null,
  author_name: null,
  stream_uid: null,
  stream_iframe_url: null,
  stream_thumbnail_url: null,
  poster_url: null,
  width: 1200,
  height: 800,
  hidden: false,
  created_at: '2026-09-14T00:00:00.000Z',
  ...over,
} as unknown as Photo)

function setup(over: Partial<React.ComponentProps<typeof LightboxOverlay>> = {}) {
  const viewerPhotos = over.viewerPhotos ?? [photo(1), photo(2), photo(3)]
  const handlers = {
    onClose: vi.fn(), onPrev: vi.fn(), onNext: vi.fn(),
    onDownload: vi.fn(), onSetCover: vi.fn(), onOpenSettings: vi.fn(),
    onRemoveFromSlideshow: vi.fn(), onDelete: vi.fn(), onToggleSlideshowPause: vi.fn(),
    onThumbnailClick: vi.fn(), onMarkBroken: vi.fn(),
  }
  const props: React.ComponentProps<typeof LightboxOverlay> = {
    current: viewerPhotos[1],
    lightboxIndex: 1,
    viewerPhotos,
    morphed: false,
    slideshowMode: false,
    slideshowActive: false,
    slideshowPaused: false,
    slideshowIntervalMs: 5000,
    slideshowFrameClass: '',
    swipeOffset: 0,
    swipeAnimating: false,
    lightboxFlipped: false,
    lightboxOriginalLoadedIds: new Set<string>(),
    broken: new Set<string>(),
    isOwner: false,
    settingCover: false,
    coverPhotoId: null,
    deleting: null,
    videoAutoplay: false,
    zoomPan: { x: 0, y: 0 },
    previewRadiusFor: () => 12,
    mediaZoomStyle: () => ({}),
    onSwipeStart: () => {}, onSwipeMove: () => {}, onSwipeEnd: () => {}, onSwipeCancel: () => {},
    onMediaMouseDown: () => {}, onMediaMouseMove: () => {}, onMediaMouseUp: () => {},
    onMediaTouchStart: () => {}, onMediaTouchMove: () => {}, onMediaTouchEnd: () => {},
    onToggleZoom: () => {}, onMediaNodeChange: () => {},
    onSetLightboxFlipped: () => {}, onSetOriginalLoaded: () => {},
    ...handlers,
    ...over,
  }
  const view = render(
    <LocaleProvider locale="en" dict={en}>
      <LightboxOverlay {...props} />
    </LocaleProvider>,
  )
  return { ...view, props, handlers: { ...handlers, ...over } as typeof handlers }
}

beforeEach(() => {
  // Videos ask whether Cloudflare has finished encoding; a ready answer keeps the player path.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ready: true }) }) as unknown as Response))
  // The slideshow strip centres itself with these; jsdom has neither.
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
  Element.prototype.scrollTo = function scrollTo() {} as typeof Element.prototype.scrollTo
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('a guest in the viewer', () => {
  it('HAS NO DELETE, HEADER-PHOTO OR SETTINGS CONTROL -- those change somebody else\'s album', () => {
    setup({ isOwner: false })
    expect(screen.queryByLabelText(en['lb.deletePhoto'])).toBeNull()
    expect(screen.queryByTitle(en['lb.setCover'])).toBeNull()
    expect(screen.queryByTitle(en['lb.clearCover'])).toBeNull()
    expect(screen.queryByTitle(en['ot.settingsTitle'])).toBeNull()
  })

  it('can go back, forward, close and download', () => {
    const { handlers, props } = setup()
    fireEvent.click(screen.getByLabelText(en['lb.prev']))
    fireEvent.click(screen.getByLabelText(en['lb.next']))
    fireEvent.click(screen.getByTitle(en['lb.download']))
    expect(handlers.onPrev).toHaveBeenCalledTimes(1)
    expect(handlers.onNext).toHaveBeenCalledTimes(1)
    expect(handlers.onDownload).toHaveBeenCalledWith(props.current)
    fireEvent.click(screen.getByLabelText(en['guest.close']))
    expect(handlers.onClose).toHaveBeenCalledTimes(1)
  })

  it('A TAP ON AN ARROW OR ON DOWNLOAD DOES NOT ALSO CLOSE THE VIEWER', () => {
    const { handlers } = setup()
    fireEvent.click(screen.getByLabelText(en['lb.prev']))
    fireEvent.click(screen.getByLabelText(en['lb.next']))
    fireEvent.click(screen.getByTitle(en['lb.download']))
    expect(handlers.onClose).not.toHaveBeenCalled()
  })

  it('a tap on the dark background closes it', () => {
    const { handlers, container } = setup()
    fireEvent.click(container.firstElementChild as HTMLElement)
    expect(handlers.onClose).toHaveBeenCalledTimes(1)
  })

  it('THE COUNTER COUNTS THE ALBUM, not the window of photos loaded so far (rule 18)', () => {
    const loaded = Array.from({ length: 40 }, (_, i) => photo(i + 1))
    setup({ viewerPhotos: loaded, current: loaded[33], lightboxIndex: 33, collectionTotal: 4565 })
    expect(screen.getByText('34 / 4,565')).toBeTruthy()
    cleanup()
    setup({ viewerPhotos: loaded, current: loaded[33], lightboxIndex: 33 })
    expect(screen.getByText('34 / 40'), 'with no album total, the loaded photos are the total').toBeTruthy()
  })

  it('a video offers no download: there is no file to hand over', () => {
    const video = photo(9, { media_type: 'video', url: null, thumb_url: null, stream_uid: 'a'.repeat(32), poster_url: 'https://cdn.example.test/p.jpg' } as Partial<Photo>)
    setup({ viewerPhotos: [photo(1), video], current: video, lightboxIndex: 1 })
    expect(screen.queryByTitle(en['lb.download'])).toBeNull()
  })

  it('A PHOTO THAT FAILED TO LOAD says so, and cannot be downloaded', () => {
    const viewerPhotos = [photo(1), photo(2)]
    setup({ viewerPhotos, current: viewerPhotos[1], broken: new Set(['p2']) })
    expect(screen.getByText(en['lb.unavailable'])).toBeTruthy()
    expect((screen.getByTitle(en['lb.download']) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('the owner in the viewer', () => {
  it('can delete the photo on screen, and only once while it is being deleted', () => {
    const { handlers, props } = setup({ isOwner: true })
    fireEvent.click(screen.getByLabelText(en['lb.deletePhoto']))
    expect(handlers.onDelete).toHaveBeenCalledWith(props.current)
    expect(handlers.onClose).not.toHaveBeenCalled()
    cleanup()
    setup({ isOwner: true, deleting: 'p2' })
    expect((screen.getByLabelText(en['lb.deletePhoto']) as HTMLButtonElement).disabled).toBe(true)
  })

  it('sets the header photo, and the same control offers to clear it when this photo already is', () => {
    const { handlers, props } = setup({ isOwner: true })
    fireEvent.click(screen.getByTitle(en['lb.setCover']))
    expect(handlers.onSetCover).toHaveBeenCalledWith(props.current)
    cleanup()
    setup({ isOwner: true, coverPhotoId: 'p2' })
    expect(screen.getByTitle(en['lb.clearCover'])).toBeTruthy()
    expect(screen.queryByTitle(en['lb.setCover'])).toBeNull()
  })
})

describe('the slideshow', () => {
  const show = Array.from({ length: 10 }, (_, i) => photo(i + 1))

  it('has no arrows and no download, and counts the show rather than the album', () => {
    setup({ slideshowMode: true, viewerPhotos: show, current: show[2], lightboxIndex: 2, collectionTotal: 4565 })
    expect(screen.queryByLabelText(en['lb.prev'])).toBeNull()
    expect(screen.queryByLabelText(en['lb.next'])).toBeNull()
    expect(screen.queryByTitle(en['lb.download'])).toBeNull()
    expect(screen.getByText('3 / 10')).toBeTruthy()
    expect(screen.queryByText('3 / 4,565')).toBeNull()
  })

  it('pauses, and the owner removes a slide instead of deleting the photo', () => {
    const { handlers } = setup({ isOwner: true, slideshowMode: true, viewerPhotos: show, current: show[2], lightboxIndex: 2 })
    fireEvent.click(screen.getByLabelText(en['lb.pause']))
    expect(handlers.onToggleSlideshowPause).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText(en['lb.deletePhoto'])).toBeNull()
    fireEvent.click(screen.getByLabelText(en['lb.removeFromSlideshow']))
    expect(handlers.onRemoveFromSlideshow).toHaveBeenCalledWith('p3')
    expect(handlers.onDelete).not.toHaveBeenCalled()
  })
})
