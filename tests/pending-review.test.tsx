// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import PendingReview from '@/components/PendingReview'
import { LocaleProvider } from '@/i18n/LocaleProvider'
import { en } from '@/i18n/dictionaries/en'
import type { Photo } from '@/types'

// A PANEL THAT DELETES PEOPLE'S PHOTOS.
//
// Decline destroys the file, and there is no backup of R2 — so the two-step confirm is not
// polish, it is the only thing between a stray tap and a guest's photo being gone forever
// (rule 19). It is tested here for the same reason the bib bar is: this is behaviour you can
// only see by rendering, and the failure mode is unrecoverable.

const photo = (id: string): Photo =>
  ({ id, album_id: 'a1', media_type: 'image', hidden: true,
     thumb_url: `https://cdn.test/${id}.jpg`, url: null, storage_backend: 'r2' }) as unknown as Photo

function setup(photos = [photo('p1'), photo('p2')]) {
  const onAccepted = vi.fn()
  const onDeclined = vi.fn()
  render(
    <LocaleProvider locale="en" dict={en}>
      <PendingReview slug="race" photos={photos} onAccepted={onAccepted} onDeclined={onDeclined} />
    </LocaleProvider>,
  )
  return { onAccepted, onDeclined }
}

// EXACT text, not includes. "Decline" is a substring of "Decline all", so a loose match picked
// the bulk button and the per-photo assertions silently tested the wrong control — the same
// substring trap that let a renamed CSS class pass earlier today.
const byText = (s: string) =>
  Array.from(document.querySelectorAll('button')).filter(b => (b.textContent ?? '').trim() === s)

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('PendingReview', () => {
  it('renders nothing at all when the queue is empty', () => {
    setup([])
    expect(document.body.textContent).toBe('')
  })

  it('shows the count, so a queue cannot build up unnoticed', () => {
    setup()
    expect(screen.getByText(`${en['review.title']} · 2`)).toBeTruthy()
  })

  it('DECLINE NEEDS TWO TAPS — the first only asks', async () => {
    // The whole safety property. One tap must never delete: there is no undo and no backup.
    const { onDeclined } = setup([photo('p1')])
    fireEvent.click(byText(en['review.decline'])[0])
    expect(global.fetch).not.toHaveBeenCalled()
    expect(onDeclined).not.toHaveBeenCalled()
    expect(byText(en['review.declineSure']).length).toBe(1)
  })

  it('the second tap deletes, and only the photo that was asked about', async () => {
    const { onDeclined } = setup([photo('p1'), photo('p2')])
    fireEvent.click(byText(en['review.decline'])[0])
    fireEvent.click(byText(en['review.declineSure'])[0])
    await vi.waitFor(() => expect(onDeclined).toHaveBeenCalled())
    expect(onDeclined).toHaveBeenCalledWith(['p1'])
  })

  it('DECLINE ALL needs two taps as well', async () => {
    const { onDeclined } = setup()
    fireEvent.click(byText(en['review.declineAll'])[0])
    expect(global.fetch).not.toHaveBeenCalled()
    // And it names the number, so "all" is never a surprise.
    expect(byText(en['review.declineAllSure'].replace('{n}', '2')).length).toBe(1)
    expect(onDeclined).not.toHaveBeenCalled()
  })

  it('ACCEPT is one tap — publishing is reversible, deleting is not', () => {
    // Deliberately asymmetric. The safe direction should not be slowed down.
    setup([photo('p1')])
    fireEvent.click(byText(en['review.accept'])[0])
    expect(global.fetch).toHaveBeenCalled()
  })

  it('keeps a photo in the queue when the server refused it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch)
    const { onAccepted } = setup([photo('p1')])
    const btn = byText(en['review.accept'])[0] as HTMLButtonElement
    fireEvent.click(btn)
    // Waits for the WHOLE operation, not just the request. Waiting on fetch alone asserted
    // before the callback could have run, so the test passed against a version that accepted
    // everything the server refused — the mutation run caught it (rule 16). The button is
    // re-enabled in the finally, so this only resolves once the work is done.
    await vi.waitFor(() => expect(btn.disabled).toBe(false))
    // Removing it optimistically would hide a photo that is still unpublished, with nothing left
    // on screen to publish it from.
    expect(onAccepted).not.toHaveBeenCalled()
  })

  it('offers exactly two actions per photo, and no album toolbar', () => {
    // Download, favourite, settings and delete are meaningless for a photo that is not in the
    // album yet. One decision, two buttons — plus the two bulk controls.
    setup([photo('p1')])
    expect(document.querySelectorAll('button')).toHaveLength(4)
  })
})
