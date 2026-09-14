import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripJsComments } from './helpers/source-text'

// THE FIRST-VISIT SPLASH SHOWS ON THE HOME PAGE ONLY (owner's decision, 2026-09-14).
//
// The review of that day measured a 1.5-second opaque splash on every first visit to any page -- and a
// guest scanning an album's QR code is almost always on a first visit, so it sat in front of the one
// journey that matters most (-50 speed). It stays on the marketing home page.
//
// TWO HALVES THAT MUST MOVE TOGETHER. An inline script adds `hush-page-preloading` before React runs,
// and InitialPreloader removes it. While the class is on the body, `body.hush-page-preloading > main`
// is opacity 0. A script left in the root layout with the component gone would hide every album page
// with nothing left to reveal it. These are source-text assertions, read with comments stripped so a
// comment naming the component cannot satisfy them.

const read = (...parts: string[]) => stripJsComments(readFileSync(join(process.cwd(), ...parts), 'utf8'))

describe('the first-visit splash', () => {
  it('is gone from the root layout, which every page renders -- every album included', () => {
    const layout = read('src', 'app', 'layout.tsx')
    expect(layout).not.toContain('InitialPreloader')
    expect(layout).not.toContain('hush-page-preloading')
    expect(layout).not.toContain('initialPreloaderSeen')
  })

  it('is on the home page: the script that hides the page and the component that reveals it', () => {
    const home = read('src', 'app', 'page.tsx')
    expect(home).toContain("import InitialPreloader from '@/components/InitialPreloader'")
    expect(home).toContain('<script dangerouslySetInnerHTML={{ __html: PRELOADER_INIT_SCRIPT }} />')
    expect(home).toContain('<InitialPreloader />')
  })

  it('SITS OUTSIDE <main>: while it shows, main is invisible, and so would be anything inside it', () => {
    const home = read('src', 'app', 'page.tsx')
    const main = home.indexOf('<main ')
    const component = home.indexOf('<InitialPreloader />')
    const script = home.indexOf('PRELOADER_INIT_SCRIPT }} />')
    expect(main).toBeGreaterThan(-1)
    // PRESENT FIRST. A missing tag has index -1, which is "before main" -- this case passed with no
    // splash on the page at all until these two lines were added.
    expect(component, 'the splash component is not on the home page').toBeGreaterThan(-1)
    expect(script, 'the splash script is not on the home page').toBeGreaterThan(-1)
    expect(component, 'the splash itself would be opacity 0 inside main').toBeLessThan(main)
    expect(script, 'the script must run before main is parsed').toBeLessThan(main)
  })

  it('the script and the component agree on the flag that marks the splash as seen (rule 13)', () => {
    const home = read('src', 'app', 'page.tsx')
    const component = read('src', 'components', 'InitialPreloader.tsx')
    const key = /const SEEN_KEY = '([^']+)'/.exec(component)?.[1]
    expect(key, 'InitialPreloader no longer names its flag the way this test reads it').toBeDefined()
    expect(home).toContain(`window.localStorage.getItem('${key}')`)
  })
})
