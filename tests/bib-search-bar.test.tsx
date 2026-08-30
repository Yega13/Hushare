// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import BibSearchBar from '@/components/BibSearchBar'
import { LocaleProvider } from '@/i18n/LocaleProvider'
import { en } from '@/i18n/dictionaries/en'

// THE FIRST COMPONENT TEST IN THIS REPOSITORY, and it exists because of a specific failure.
//
// The bib search was moved into Postgres so a runner whose photos sat outside the loaded window
// would stop being told they had none. Every pure function involved was correct and every one of
// them had tests. The bug shipped anyway, in the component: for the 300ms debounce plus the round
// trip, `matchCount` is 0 because the local filter has not found anything yet — and the bar
// rendered "No photos found" in bold, then swapped it for the real answer.
//
// A runner reads that sentence and stops looking. It is the single worst string this product can
// display, it was displayed on the primary path of a 5,000-photo race album, and no test in a suite
// of 184 could see it, because the suite could not render a component.
//
// So: what does the person actually SEE. Not which props were passed, not which branch was taken.
function renderBar(props: Partial<React.ComponentProps<typeof BibSearchBar>> = {}) {
  return render(
    // The REAL English dictionary, not a stub. A stub would let a missing or renamed key pass —
    // and the strings are the thing under test here, not the branching around them.
    <LocaleProvider locale="en" dict={en}>
      <BibSearchBar
        query="3400"
        onQueryChange={() => {}}
        matchCount={0}
        totalMatches={null}
        indexedCount={5000}
        totalImages={5000}
        awaitingServer={false}
        failed={false}
        onRetry={() => {}}
        {...props}
      />
    </LocaleProvider>,
  )
}

afterEach(cleanup)

describe('the bib bar never states a negative it cannot back up', () => {
  it('does NOT say "no photos" while the server is still answering', () => {
    renderBar({ awaitingServer: true, matchCount: 0 })
    expect(screen.queryByText(/no photos/i), 'this is the bug that shipped').toBeNull()
    expect(screen.getByText(/searching/i)).toBeTruthy()
  })

  it('does NOT say "no photos" when the search failed', () => {
    // A 429 on the shared venue IP, or one dropped packet. The old code fell back to the local
    // filter, found nothing, and stated it as fact.
    renderBar({ failed: true, matchCount: 0 })
    expect(screen.queryByText(/no photos/i)).toBeNull()
    expect(screen.getByText(/could not search/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
  })

  it('says it plainly once the answer really is in', () => {
    // The other half: having made "no matches" hard to say, it must still be sayable. A bar that
    // never reaches a conclusion is its own failure.
    renderBar({ awaitingServer: false, failed: false, matchCount: 0 })
    expect(screen.getByText(/no photos/i)).toBeTruthy()
  })

  it('offers Face Finder when a real search finds nothing', () => {
    // Roughly half of race photos have no readable number — an arm across the bib, motion blur, a
    // runner shot from behind. "No photos" usually means "we could not READ your number", so this
    // escape hatch is the difference between a dead end and a found runner. It was hidden for the
    // entire event by a condition that is almost never true during one.
    renderBar({ matchCount: 0, awaitingServer: false, onTryFaceFinder: () => {} })
    // "Find me by face" — the real button text. The first draft of this test asserted "Face
    // Finder", the internal name for the feature, and failed against perfectly correct code. Worth
    // keeping the note: a component test asserts what a guest reads, so it has to be written from
    // what a guest reads, not from what the codebase calls things.
    expect(screen.getByRole('button', { name: /find me by face/i })).toBeTruthy()
  })

  it('still offers it while indexing is behind, which is most of a live race', () => {
    // The exact regression: gated on !stillIndexing, and during a race the photographer uploads
    // continuously so indexed < total is true almost always. One photo whose OCR permanently fails
    // makes it true forever.
    renderBar({ matchCount: 0, indexedCount: 1200, totalImages: 5000, onTryFaceFinder: () => {} })
    expect(screen.getByRole('button', { name: /find me by face/i })).toBeTruthy()
    expect(screen.getByText(/1200 of 5000/)).toBeTruthy()
  })

  it('reports a capped result as capped, not as the total', () => {
    renderBar({ matchCount: 300, totalMatches: 1847 })
    // Interpolation substitutes raw numbers, so this reads "the first 300 of 1847 photos".
    expect(screen.getByText(/first 300 of 1847/)).toBeTruthy()
  })

  it('shows a plain count when nothing was capped', () => {
    renderBar({ matchCount: 12, totalMatches: 12 })
    expect(screen.getByText(/12 photo/i)).toBeTruthy()
  })
})
