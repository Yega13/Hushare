import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// THE BROWSER MAY NOT REWRITE THE DOM REACT IS HOLDING.
//
// Android Chrome auto-translates a page whose language does not match the reader — unasked — by
// replacing text nodes and wrapping them in font elements. React keeps direct references to the
// nodes it created, so its next commit reaches for a child that is no longer there and the whole
// tree throws: "Failed to execute insertBefore on Node" or the removeChild twin. The album is
// replaced by an error screen, killed by a browser feature nobody switched on.
//
// Fifteen of those were recorded before the guard reached the root. One on 2026-09-01 landed on
// the album-CREATE page and left a visitor with two abandoned empty albums where they had meant
// to make one — the top of the funnel, a real person, twice.
//
// The cost of the guard is real and was accepted deliberately: someone whose language we do not
// ship cannot have the browser translate the interface. They read English, or pick Russian or
// Armenian from our own switcher. The trade is the right way round because nobody CHOSE the
// translation that broke their page. The honest way to serve those visitors is to ship their
// language, not to let a translator loose inside React.
function source(...parts: string[]): string {
  return readFileSync(join(process.cwd(), 'src', ...parts), 'utf8')
}

describe('browser translation cannot reach inside React', () => {
  it('the app root carries the marker', () => {
    expect(
      /<body[^>]*translate="no"/.test(source('app', 'layout.tsx')),
      'src/app/layout.tsx must render a body with translate="no" — without it a translation ' +
      'rewrites the nodes React is holding and the next commit throws',
    ).toBe(true)
  })

  it('the photo grid keeps its own, for both layouts', () => {
    // The grid was marked first, in August, and separately: it is the densest React subtree in the
    // product and the one a translator has the most text to chew on. Kept as its own assertion so
    // removing either marker fails for its own reason.
    const grid = source('components', 'photo-grid', 'PhotoTileList.tsx')
    expect((grid.match(/translate="no"/g) ?? []).length, 'the masonry and the square grid')
      .toBeGreaterThanOrEqual(2)
  })
})
