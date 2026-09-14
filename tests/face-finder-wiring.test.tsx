// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import FaceFinder from '@/components/FaceFinder'
import { LocaleProvider } from '@/i18n/LocaleProvider'
import { en } from '@/i18n/dictionaries/en'
import type { Photo } from '@/types'

// FACE FINDER ASKS THE SERVER WHAT IS UNSCANNED UNLESS IT HAS SEEN THE WHOLE ALBUM.
//
// lib/face-finder-plan holds the decision; this proves the component uses it, with the album's own
// total -- and that the album page hands it that total, not the loaded window's length, which is
// the same bug one component up.

vi.mock('@/components/SignInPrompt', () => ({ default: () => null }))

const scannedPhoto = (n: number) => ({
  id: `p${n}`, album_id: 'a1', media_type: 'image', face_ids: ['f'],
  url: `https://cdn.example.test/p${n}.jpg`, thumb_url: `https://cdn.example.test/t${n}.jpg`,
} as unknown as Photo)

const indexCalls: string[] = []

beforeEach(() => {
  indexCalls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    indexCalls.push(String(url))
    return { ok: true, json: async () => ({ ids: [], total: 10, remaining: 0, more: false }) } as unknown as Response
  }))
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const renderFinder = (photos: Photo[], albumTotal: number) => render(
  <LocaleProvider locale="en" dict={en}>
    <FaceFinder albumSlug="race" photos={photos} albumTotal={albumTotal} onClose={() => {}} />
  </LocaleProvider>,
)

describe('opening Face Finder', () => {
  it('THE BUG: the loaded photos are all scanned but the album is bigger -- it asks the server first', async () => {
    renderFinder([scannedPhoto(1), scannedPhoto(2), scannedPhoto(3)], 10)
    await waitFor(() => expect(indexCalls.some((u) => u.startsWith('/api/album/face-index?slug=race'))).toBe(true))
  })

  it('the whole album is loaded and scanned -- it goes straight to the selfie, with no request', async () => {
    renderFinder([scannedPhoto(1), scannedPhoto(2), scannedPhoto(3)], 3)
    await waitFor(() => expect(screen.getByText(en['ff.selfiePrompt'])).toBeTruthy())
    expect(indexCalls).toEqual([])
  })
})

describe('the album page', () => {
  it('passes Face Finder the ALBUM total, not the length of the photos it has loaded', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'app', '[slug]', 'AlbumPageClient.tsx'), 'utf8')
    const at = src.indexOf('<FaceFinder')
    expect(at, 'FaceFinder is no longer rendered by the album page').toBeGreaterThan(-1)
    const element = src.slice(at, src.indexOf('/>', at))
    expect(element).toContain('albumTotal={total}')
  })
})
