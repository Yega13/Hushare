// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import PhotoGrid from '@/components/PhotoGrid'
import { LocaleProvider } from '@/i18n/LocaleProvider'
import { en } from '@/i18n/dictionaries/en'
import type { Album } from '@/types'
import type { SearchPhase } from '@/lib/search-answer'

// THE TEST THAT WOULD HAVE CAUGHT IT, and did not exist.
//
// tests/bib-search-bar.test.ts renders the BAR alone and asserts, correctly, that it never states a
// negative it cannot back up. The bug was one component lower: PhotoGrid received `filtered`, a
// boolean true from the first keystroke, and printed "No photos with that number" underneath a bar
// saying "Searching…". No test rendered them together, and no test rendered the grid at all — so
// both components were individually "covered" while the screen was wrong.
//
// This asserts on the text a guest actually reads, for each of the three states one boolean could
// not distinguish. It is the regression guard for AGENTS.md rule 20 on the race path.

const album = {
  id: 'a1', slug: 'race', title: 'Race', photo_layout: 'masonry', media_radius: 12,
  media_filter: 'none', mobile_grid_columns: 2, desktop_grid_columns: 4,
  bib_search_enabled: true,
} as unknown as Album

function renderGrid(searchPhase: SearchPhase) {
  return render(
    <LocaleProvider locale="en" dict={en}>
      <PhotoGrid
        album={album}
        photos={[]}
        albumPhotoCount={5000}
        isOwner={false}
        slug="race"
        forceGlobalRadius={false}
        onRadiusMaxChange={() => {}}
        onPhotoDeleted={() => {}}
        onPhotoUpdated={() => {}}
        onPhotosReordered={() => {}}
        searchPhase={searchPhase}
      />
    </LocaleProvider>,
  )
}

afterEach(cleanup)

describe('an empty grid says which KIND of empty it is', () => {
  it('does NOT say "no photos with that number" while the search is in flight', () => {
    // THE SHIPPED BUG. A runner at bib 3400 on a 5,000-photo album, whose number is outside the
    // ~500-row first window, saw exactly this while the request was still going.
    renderGrid('searching')
    expect(
      screen.queryByText(/no photos with that number/i),
      'this is the bug that shipped: a negative stated before any answer existed',
    ).toBeNull()
    expect(screen.getByText(/searching/i)).toBeTruthy()
  })

  it('does NOT tell the runner to try a different number while searching', () => {
    // The subtitle was the worse half — it sends someone away from a correct search.
    renderGrid('searching')
    expect(screen.queryByText(/try a different number/i)).toBeNull()
  })

  it('does NOT state absence when the search FAILED', () => {
    renderGrid('failed')
    expect(screen.queryByText(/no photos with that number/i)).toBeNull()
    expect(screen.getByText(/could not search/i)).toBeTruthy()
  })

  it('does not blame the runner for OUR failure', () => {
    // Added after a review found this mutation survived: loosening the subtitle guard to
    // `searchPhase !== 'searching'` printed "Try a different number" under "Could not search just
    // now" — telling someone their number was wrong when what actually happened was our 429.
    renderGrid('failed')
    expect(screen.queryByText(/try a different number/i)).toBeNull()
  })

  it('says it plainly once the answer really is in', () => {
    // The other half of rule 20: having made the negative hard to say, it must still be sayable.
    renderGrid('answered')
    expect(screen.getByText(/no photos with that number/i)).toBeTruthy()
    expect(screen.getByText(/try a different number/i)).toBeTruthy()
  })

  it('an unfiltered empty album still says the album is empty', () => {
    // The regression that would matter most to an owner opening a brand-new album.
    renderGrid('off')
    expect(screen.getByText(/nothing here yet/i)).toBeTruthy()
    expect(screen.queryByText(/no photos with that number/i)).toBeNull()
    // The SUBTITLE too, not just the title. A review found that asserting only the title let a
    // mutation through which showed every brand-new album "Try a different number, or clear the
    // box to see the whole album" — advice about a search box that album has never displayed.
    expect(screen.getByText(/be the first to upload/i)).toBeTruthy()
    expect(screen.queryByText(/try a different number/i)).toBeNull()
  })
})
