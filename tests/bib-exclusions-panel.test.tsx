// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LocaleProvider } from '@/i18n/LocaleProvider'
import { en } from '@/i18n/dictionaries/en'
import type { Album } from '@/types'

// THE PANEL THAT CAN HIDE A RUNNER FROM THEIR OWN SEARCH.
//
// Excluding a number stops it answering everywhere, immediately, on rows indexed long ago. That is
// the feature. Aimed at a real bib it is also the one mistake in this product that produces no
// complaint: the runner looks, finds nothing, and concludes they were not photographed.
//
// So the properties worth a component test are not the layout. They are: an exclusion is always
// undoable, a refused save does not leave the screen claiming it worked, and a failed LOAD is not
// presented as an album with no signage.

const state: {
  view: { candidates: Array<{ number: string; photos: number }>; excluded: string[] } | null
  saveFails: string | null
  posted: string[][]
} = { view: null, saveFails: null, posted: [] }

vi.mock('@/components/owner-toolbar/api', () => ({
  fetchBibExclusions: async () => state.view,
  saveBibExclusionsRequest: async (_slug: string, excluded: string[]) => {
    state.posted.push(excluded)
    if (state.saveFails) return { ok: false as const, error: state.saveFails }
    return { ok: true as const, excluded }
  },
}))

const toasts: string[] = []
vi.mock('@/components/AppToast', () => ({ showAppToast: (m: string) => { toasts.push(m) } }))

const { default: BibExclusionsSection } = await import('@/components/owner-toolbar/BibExclusionsSection')

const album = { slug: 'race', bib_search_enabled: true } as unknown as Album

function renderPanel() {
  return render(
    <LocaleProvider locale="en" dict={en}>
      <BibExclusionsSection album={album} />
    </LocaleProvider>,
  )
}

beforeEach(() => {
  state.view = { candidates: [{ number: '2026', photos: 1145 }, { number: '2188', photos: 61 }], excluded: [] }
  state.saveFails = null
  state.posted = []
  toasts.length = 0
})
afterEach(cleanup)

describe('what the owner is shown', () => {
  it('names each number with the number of photographs it is on', async () => {
    // The count is what makes the question answerable: "2026 — on 1,145 photos" is recognisably an
    // arch, where a bare number is a guess.
    renderPanel()
    expect(await screen.findByRole('button', { name: /2026/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /1145 photos/ })).toBeTruthy()
  })

  it('offers a real bib too, because only a person can tell it from a banner', async () => {
    renderPanel()
    expect(await screen.findByRole('button', { name: /2188/ })).toBeTruthy()
  })

  it('says NOTHING when the list could not be loaded', async () => {
    // A failed load is not "this album has no signage". Rendering the empty panel would be a claim
    // about the album we do not hold (rule 20).
    state.view = null
    const { container } = renderPanel()
    await waitFor(() => expect(container.textContent).not.toContain('Numbers found'))
  })

  it('says nothing on an album with no numbers and nothing excluded', async () => {
    state.view = { candidates: [], excluded: [] }
    const { container } = renderPanel()
    await waitFor(() => expect(container.textContent).not.toContain('Numbers found'))
  })
})

describe('an exclusion is always undoable', () => {
  it('KEEPS an excluded number on screen, marked, so it can be put back', async () => {
    // The load-bearing property. If excluded numbers vanished from the panel, a wrong exclusion
    // would be permanent and its victim would never know to complain.
    state.view = { candidates: [{ number: '2188', photos: 61 }], excluded: ['2026'] }
    renderPanel()
    const chip = await screen.findByRole('button', { name: '2026' })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
  })

  it('un-excludes it on a second tap, and posts the list WITHOUT it', async () => {
    state.view = { candidates: [], excluded: ['2026', '700'] }
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: '2026' }))
    await waitFor(() => expect(state.posted).toHaveLength(1))
    expect(state.posted[0]).toEqual(['700'])
  })

  it('posts the WHOLE list when excluding, never a single number', async () => {
    // The route replaces rather than merges, so a delta would drop every other exclusion.
    state.view = { candidates: [{ number: '2026', photos: 1145 }], excluded: ['700'] }
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /2026/ }))
    await waitFor(() => expect(state.posted).toHaveLength(1))
    expect(state.posted[0]).toEqual(['700', '2026'])
  })
})

describe('a refused save does not leave the screen lying', () => {
  it('puts the chip back the way it was, and says why', async () => {
    // A chip that LOOKS excluded while the server refused is the same class of lie as the empty
    // states this whole feature exists to remove.
    state.saveFails = 'Bib number search requires Max'
    renderPanel()
    const chip = await screen.findByRole('button', { name: /2026/ })
    await userEvent.click(chip)
    await waitFor(() => expect(toasts).toContain('Bib number search requires Max'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /2026/ }).getAttribute('aria-pressed')).toBe('false')
    })
  })

  it('does not lose the exclusions that were already there', async () => {
    state.view = { candidates: [{ number: '2026', photos: 1145 }], excluded: ['700'] }
    state.saveFails = 'nope'
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /2026/ }))
    await waitFor(() => expect(toasts).toHaveLength(1))
    expect(screen.getByRole('button', { name: '700' }).getAttribute('aria-pressed')).toBe('true')
  })
})
