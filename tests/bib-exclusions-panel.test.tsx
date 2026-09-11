// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LocaleProvider } from '@/i18n/LocaleProvider'
import { en } from '@/i18n/dictionaries/en'
import type { Album } from '@/types'
import { normalizeExclusions } from '@/lib/bib-exclusions'

// THE PANEL THAT CAN HIDE A RUNNER FROM THEIR OWN SEARCH.
//
// Excluding a number stops it answering everywhere, immediately, on rows indexed long ago. That is
// the feature. Aimed at a real bib it is also the one mistake in this product that produces no
// complaint: the runner looks, finds nothing, and concludes they were not photographed.
//
// So the properties worth a component test are not the layout. They are: an exclusion is always
// undoable, a refused save does not leave the screen claiming it worked, and a failed LOAD is not
// presented as an album with no signage.

type Row = { number: string; photos: number; sampleThumb?: string | null }
const state: {
  view: { rows: Row[]; excluded: string[] } | null
  saveFails: string | null
  posted: string[][]
  /** What the route stores: it canonicalises before answering, and the panel has to survive that. */
  canonicalise: boolean
  /** A slug whose load fails, so a SECOND album can fail after a first one succeeded. */
  failSlug: string | null
} = { view: null, saveFails: null, posted: [], canonicalise: false, failSlug: null }

vi.mock('@/components/owner-toolbar/api', () => ({
  fetchBibExclusions: async (slug: string) => (state.failSlug === slug ? null : state.view),
  saveBibExclusionsRequest: async (_slug: string, excluded: string[]) => {
    state.posted.push(excluded)
    if (state.saveFails) return { ok: false as const, error: state.saveFails }
    // THE REAL FUNCTION, not a copy of it. This hand-rolled `String(Number(n))`, which happens to
    // canonicalise but does NOT de-duplicate or truncate -- so the panel was never once tested
    // against a server that answers with FEWER entries than it was sent (rule 17).
    const stored = state.canonicalise ? normalizeExclusions(excluded) : excluded
    return { ok: true as const, excluded: stored }
  },
}))

const toasts: string[] = []
vi.mock('@/components/AppToast', () => ({ showAppToast: (m: string) => { toasts.push(m) } }))

const { default: BibExclusionsSection } = await import('@/components/owner-toolbar/BibExclusionsSection')

const album = { slug: 'race', bib_search_enabled: true } as unknown as Album

function renderPanel(a: Album = album) {
  return render(
    <LocaleProvider locale="en" dict={en}>
      <BibExclusionsSection album={a} />
    </LocaleProvider>,
  )
}

beforeEach(() => {
  state.view = { rows: [{ number: '2026', photos: 1145 }, { number: '2188', photos: 61 }], excluded: [] }
  state.saveFails = null
  state.posted = []
  state.canonicalise = false
  state.failSlug = null
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

  it('does not keep the PREVIOUS album on screen when the next one fails to load', async () => {
    // The reason a failure is tracked separately from an empty view. Once one album has loaded,
    // `view` is no longer null, so a failure on the next slug leaves the last album's numbers on
    // screen -- and every tap then posts an exclusion to the album now being looked at, built from
    // numbers that belong to a different one.
    const { rerender } = renderPanel()
    await screen.findByRole('button', { name: /2026/ })
    state.failSlug = 'other-race'
    const other = { slug: 'other-race', bib_search_enabled: true } as unknown as Album
    rerender(
      <LocaleProvider locale="en" dict={en}>
        <BibExclusionsSection album={other} />
      </LocaleProvider>,
    )
    await waitFor(() => expect(screen.queryByRole('button', { name: /2026/ })).toBeNull())
  })

  it('says nothing on an album with no numbers and nothing excluded', async () => {
    state.view = { rows: [], excluded: [] }
    const { container } = renderPanel()
    await waitFor(() => expect(container.textContent).not.toContain('Numbers found'))
  })
})

describe('an exclusion is always undoable', () => {
  it('shows a number ONCE, not once per list', async () => {
    // THE BUG THE OWNER FOUND IN A SCREENSHOT. Excluding added the number to one list without
    // removing it from the other, so after one tap "2026" rendered twice -- dark, and again still
    // offering its count. The owner saw a number they had just switched off apparently still on.
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /2026/ }))
    await waitFor(() => expect(state.posted).toHaveLength(1))
    expect(screen.getAllByRole('button', { name: /2026/ })).toHaveLength(1)
  })

  it('KEEPS an excluded number on screen, marked, so it can be put back', async () => {
    // The load-bearing property. If excluded numbers vanished from the panel, a wrong exclusion
    // would be permanent and its victim would never know to complain.
    state.view = { rows: [{ number: '2026', photos: 1145, sampleThumb: 'https://cdn/2026.jpg' }, { number: '2188', photos: 61 }], excluded: ['2026'] }
    renderPanel()
    const chip = await screen.findByRole('button', { name: /2026/ })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
  })

  it('un-excludes it on a second tap, and posts the list WITHOUT it', async () => {
    state.view = { rows: [{ number: '2026', photos: 1145 }, { number: '700', photos: 90 }], excluded: ['2026', '700'] }
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /2026/ }))
    await waitFor(() => expect(state.posted).toHaveLength(1))
    expect(state.posted[0]).toEqual(['700'])
  })

  it('posts the WHOLE list when excluding, never a single number', async () => {
    // The route replaces rather than merges, so a delta would drop every other exclusion.
    state.view = { rows: [{ number: '2026', photos: 1145 }, { number: '700', photos: 90 }], excluded: ['700'] }
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /2026/ }))
    await waitFor(() => expect(state.posted).toHaveLength(1))
    expect(state.posted[0]).toEqual(['700', '2026'])
  })
})

describe('every row is reachable, including past the fold', () => {
  // THE COLLAPSE HAD NO COVERAGE AT ALL. A real album is routinely 20 offered numbers plus however
  // many are already off, and the panel shows six. Deleting the reveal hides everything below row
  // six -- exclusions included -- and every test still passed, because no test built more than two
  // rows. Reachability is the property this panel is built on; a hidden exclusion is a permanent
  // one.
  const many = Array.from({ length: 9 }, (_, i) => ({ number: String(900 + i), photos: 100 - i }))

  it('offers a count of what it is holding back', async () => {
    state.view = { rows: many, excluded: [] }
    renderPanel()
    expect(await screen.findByRole('button', { name: '+3' })).toBeTruthy()
  })

  it('shows the rest when it is tapped', async () => {
    state.view = { rows: many, excluded: [] }
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: '+3' }))
    expect(screen.getByRole('button', { name: /908/ })).toBeTruthy()
  })

  it('hides nothing when everything fits', async () => {
    state.view = { rows: many.slice(0, 4), excluded: [] }
    renderPanel()
    await screen.findByRole('button', { name: /900/ })
    expect(screen.queryByRole('button', { name: /^\+/ })).toBeNull()
  })

  it('keeps an EXCLUDED number reachable when it sits past the fold', async () => {
    // The worst version of this: the owner cannot see, let alone undo, the exclusion they made.
    state.view = { rows: [...many, { number: '42', photos: 2 }], excluded: ['42'] }
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: '+4' }))
    expect(screen.getByRole('button', { name: /42/ }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('the bar argues from the album, not from the loudest row', () => {
  // THE BRANCH PRODUCTION USES WAS NEVER RUN. renderPanel never passed albumPhotoCount, so every
  // test exercised the fallback. The bar is documented as "an argument the owner can check": a
  // share of the ALBUM says a quarter of your photographs, which no runner ever is. Scaled to the
  // loudest row instead, a real bib on 4 photographs draws a full bar and argues for excluding a
  // runner.
  const withCount = { slug: 'race', bib_search_enabled: true } as unknown as Album

  function widthOf(container: HTMLElement, n: number): string {
    const row = [...container.querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').includes(String(n)))
    return (row!.querySelector('span > span > span') as HTMLElement).style.width
  }

  it('scales a quarter-of-the-album number to about a quarter', async () => {
    state.view = { rows: [{ number: '2026', photos: 1145 }, { number: '2188', photos: 4 }], excluded: [] }
    const { container } = render(
      <LocaleProvider locale="en" dict={en}>
        <BibExclusionsSection album={withCount} albumPhotoCount={4566} />
      </LocaleProvider>,
    )
    await screen.findByRole('button', { name: /2026/ })
    expect(widthOf(container, 2026)).toBe('25%')
  })

  it('does not draw a runner on 4 photographs as if it were signage', async () => {
    state.view = { rows: [{ number: '2026', photos: 1145 }, { number: '2188', photos: 4 }], excluded: [] }
    const { container } = render(
      <LocaleProvider locale="en" dict={en}>
        <BibExclusionsSection album={withCount} albumPhotoCount={4566} />
      </LocaleProvider>,
    )
    await screen.findByRole('button', { name: /2188/ })
    expect(widthOf(container, 2188)).toBe('2%')
  })

  it('falls back to the loudest row only when the album total is unknown', async () => {
    state.view = { rows: [{ number: '2026', photos: 100 }, { number: '2188', photos: 50 }], excluded: [] }
    const { container } = renderPanel()
    await screen.findByRole('button', { name: /2026/ })
    expect(widthOf(container, 2026)).toBe('100%')
  })
})

describe('an excluded number keeps the evidence it was excluded on', () => {
  // THE REGRESSION THE OWNER PHOTOGRAPHED. Reopening the panel showed the number they had switched
  // off as a struck-through digit string: blank square where its photograph had been, no count, and
  // dropped to the bottom of the list. The server stops offering an excluded number as a CANDIDATE
  // -- correctly -- and the panel was building its rows from candidates plus a bare list of strings.
  //
  // Undoing an exclusion is the property this panel exists for. It cannot be done from evidence
  // that has been taken away.

  it('keeps its photo count on screen', async () => {
    state.view = { rows: [{ number: '2026', photos: 1145 }], excluded: ['2026'] }
    renderPanel()
    expect(await screen.findByRole('button', { name: /1145 photos/ })).toBeTruthy()
  })

  it('keeps its photograph on screen', async () => {
    state.view = {
      rows: [{ number: '2026', photos: 1145, sampleThumb: 'https://cdn/arch.jpg' }],
      excluded: ['2026'],
    }
    const { container } = renderPanel()
    await screen.findByRole('button', { name: /2026/ })
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://cdn/arch.jpg')
  })

  it('keeps its place in the list instead of sinking to the bottom', async () => {
    // The first number an owner excludes is always the loudest one on the album, so appending the
    // excluded set sent it to the far end on the next open -- which reads as "gone", not "off".
    state.view = {
      rows: [{ number: '2026', photos: 1145 }, { number: '2188', photos: 61 }],
      excluded: ['2026'],
    }
    renderPanel()
    await screen.findByRole('button', { name: /2026/ })
    const order = screen.getAllByRole('button').map((b) => b.textContent ?? '')
    expect(order[0]).toContain('2026')
  })
})

describe('the same number spelled two ways is one number', () => {
  // OCR keeps leading zeros; the route stores the canonical form. Comparing the two as TEXT made a
  // just-excluded row spring back ON the moment the server's answer arrived.

  it('stays off after the server answers with the canonical spelling', async () => {
    state.view = { rows: [{ number: '00945', photos: 30 }], excluded: [] }
    state.canonicalise = true
    renderPanel()
    const row = await screen.findByRole('button', { name: /00945/ })
    await userEvent.click(row)
    await waitFor(() => expect(state.posted).toHaveLength(1))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /00945/ }).getAttribute('aria-pressed')).toBe('true')
    })
  })

  it('posts back the spelling the SERVER stored, not its own optimistic guess', async () => {
    // The stored list is what a search actually uses. A panel that keeps its own version of it
    // drifts from the album on every later tap, and the drift is invisible until a number that
    // should be off starts answering again.
    state.view = { rows: [{ number: '00945', photos: 30 }, { number: '700', photos: 90 }], excluded: [] }
    state.canonicalise = true
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /00945/ }))
    await waitFor(() => expect(state.posted).toHaveLength(1))
    await userEvent.click(screen.getByRole('button', { name: /700/ }))
    await waitFor(() => expect(state.posted).toHaveLength(2))
    expect(state.posted[1]).toEqual(['945', '700'])
  })

  it('removes it on the second tap rather than posting it twice', async () => {
    state.view = { rows: [{ number: '00945', photos: 30 }], excluded: ['945'] }
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /00945/ }))
    await waitFor(() => expect(state.posted).toHaveLength(1))
    expect(state.posted[0]).toEqual([])
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
    state.view = { rows: [{ number: '2026', photos: 1145 }, { number: '700', photos: 90 }], excluded: ['700'] }
    state.saveFails = 'nope'
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /2026/ }))
    await waitFor(() => expect(toasts).toHaveLength(1))
    expect(screen.getByRole('button', { name: /700/ }).getAttribute('aria-pressed')).toBe('true')
  })
})
