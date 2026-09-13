// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import GuestActionsBar from '@/components/GuestActionsBar'
import { LocaleProvider } from '@/i18n/LocaleProvider'
import { en } from '@/i18n/dictionaries/en'
import type { Album, Photo } from '@/types'

// THE QR CODE THAT RELOADED THE ALBUM.
//
// GuestActionsBar pre-generates a QR code on every guest page load. Its library is a lazy chunk, and
// 26 production rows since 2026-08-22 show that chunk -- or its sibling -- failing to load on real
// devices while it exists on the server. With no .catch, the rejection went unhandled, reached
// report-error in "Failed to load chunk" words, and report-error answered by reloading the page.
//
// Kept in its own file because the mock below makes the QR import fail for EVERY render in the file,
// and the ordering and contrast tests in guest-actions-bar.test.tsx are about something else.
//
// Two independent things fail if the catch is removed: the report below never arrives, and Vitest
// fails any file in which a promise rejection goes unhandled.

const reported: unknown[] = []
vi.mock('@/lib/report-error', async (orig) => ({
  ...(await orig<typeof import('@/lib/report-error')>()),
  reportClientError: (input: unknown) => { reported.push(input) },
}))

// The QR library's chunk will not load -- the error text verbatim from a production row. Written
// INSIDE the factory: vi.mock is hoisted above every top-level declaration, so a factory that reads a
// top-level constant throws its own error instead of this one.
vi.mock('qrcode', () => {
  throw new Error('ChunkLoadError: Failed to load chunk /_next/static/chunks/1vfl_aeamxgqu.js from module 73378')
})

const album = {
  id: 'a1', slug: 'race', custom_slug: 'race', title: 'Race',
  face_finder_enabled: true,
  allow_guest_downloads: true,
  guest_uploads_enabled: true,
} as unknown as Album

const photo = { id: 'p1', media_type: 'image', album_id: 'a1', storage_backend: 'r2' } as unknown as Photo

afterEach(() => {
  cleanup()
  reported.length = 0
})

describe('a QR code that will not load', () => {
  it('is reported as an optional part, in words that reload nothing, and the bar still renders', async () => {
    render(
      <LocaleProvider locale="en" dict={en}>
        <GuestActionsBar
          album={album}
          photos={[photo]}
          shareUrl="https://hushare.space/race"
          onOpenSlideshow={() => {}}
          onOpenFaceFinder={() => {}}
        />
      </LocaleProvider>,
    )
    await waitFor(() => expect(reported, 'the failed QR import must be caught and reported').toHaveLength(1))
    expect(reported[0]).toMatchObject({ source: 'optional:qr', level: 'warn', message: 'Optional part could not load: qr' })
    // WHAT the kept detail says is lib/optional-load's property, pinned in tests/optional-load.test.ts
    // with the production text. Vitest wraps an error thrown inside a mock factory in a message of its
    // own, so here only its presence is asserted.
    expect(typeof (reported[0] as { context: { detail: unknown } }).context.detail).toBe('string')
    // And the album's actions are still there for the guest.
    expect(document.querySelectorAll('button').length).toBeGreaterThan(0)
  })
})
