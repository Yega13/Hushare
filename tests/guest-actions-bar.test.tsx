// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import GuestActionsBar from '@/components/GuestActionsBar'
import { LocaleProvider } from '@/i18n/LocaleProvider'
import { en } from '@/i18n/dictionaries/en'
import type { Album, Photo } from '@/types'

// WHICH BUTTON A RUNNER MEETS FIRST, AND WHICH ONE IS LOUD.
//
// Four identical grey pills sat above a full-width solid maroon "Take Photo" button belonging to
// the uploader. A runner who came to find themselves did the reasonable thing — tapped the
// obvious button, photographed their face, and it uploaded INTO the album. Twenty-one private
// selfies landed in one event album that way and were face-indexed, so a stranger's selfie became
// findable by anybody else's search.
//
// The fix is ordering and contrast, and neither is expressible as a pure function: it is entirely
// about what renders and how it looks. A later reorder or restyle would regress it in silence, and
// the failure mode is other people's faces being published. So this asserts what a guest SEES.

const album = {
  id: 'a1', slug: 'race', custom_slug: 'race', title: 'Race',
  face_finder_enabled: true,
  allow_guest_downloads: true,
  guest_uploads_enabled: true,
} as unknown as Album

const photo = (id: string, media_type: 'image' | 'video' = 'image') =>
  ({ id, media_type, album_id: 'a1', storage_backend: 'r2' }) as unknown as Photo

function renderBar(over: Partial<Album> = {}, photos: Photo[] = [photo('p1')]) {
  return render(
    // The REAL dictionary, not a stub — a renamed or missing key must fail here, because the
    // labels ARE what is under test.
    <LocaleProvider locale="en" dict={en}>
      <GuestActionsBar
        album={{ ...album, ...over } as Album}
        photos={photos}
        shareUrl="https://hushare.space/race"
        onOpenSlideshow={() => {}}
        onOpenFaceFinder={() => {}}
      />
    </LocaleProvider>,
  )
}

const labels = () => Array.from(document.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '')
const filled = () =>
  Array.from(document.querySelectorAll('button')).filter((b) => {
    const bg = (b as HTMLElement).style.background || (b as HTMLElement).style.backgroundColor
    return bg.replace(/\s/g, '').toLowerCase().includes('#630826') || bg.includes('99, 8, 38')
  })

afterEach(cleanup)

describe('GuestActionsBar', () => {
  it('puts finding yourself FIRST, before anything else', () => {
    renderBar()
    expect(labels()[0]).toBe(en['guest.findMeCta'])
  })

  it('makes it the ONLY filled button, so it wins on contrast not size', () => {
    renderBar()
    const f = filled()
    expect(f).toHaveLength(1)
    expect(f[0].textContent?.trim()).toBe(en['guest.findMeCta'])
  })

  it('asks what the runner wants, not what the feature is called', () => {
    // "Face Finder" is the product's name for it; "Find my photos" is the visitor's reason for
    // being there. The modal keeps the product name — this button does not.
    renderBar()
    expect(labels()[0]).toBe('Find my photos')
    expect(labels()).not.toContain('Face Finder')
  })

  it('renders nothing extra when Face Finder is off, and no filled button', () => {
    renderBar({ face_finder_enabled: false })
    expect(labels()).not.toContain(en['guest.findMeCta'])
    expect(filled()).toHaveLength(0)
    expect(labels()[0]).toBe(en['guest.slideshow'])
  })

  it('survives an album with no photos at all', () => {
    expect(() => renderBar({}, [])).not.toThrow()
    expect(screen.getByText(en['guest.share'])).toBeTruthy()
  })

  it('still leads with it when downloads are disabled', () => {
    renderBar({ allow_guest_downloads: false })
    expect(labels()[0]).toBe(en['guest.findMeCta'])
    expect(labels()).not.toContain(en['guest.downloadAll'])
  })

  it('renders the translated label, never a raw key', () => {
    // A key missing from a locale renders as "guest.findMeCta" to a real visitor.
    for (const l of labels()) expect(l).not.toMatch(/^[a-z]+\.[a-zA-Z]+$/)
  })
})
