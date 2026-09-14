// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import SocialButtons from '@/components/SocialButtons'
import { SOCIAL_HANDLE } from '@/lib/social-profiles'

// /ABOUT'S "FIND US" BUTTONS, RENDERED.
//
// They lived inline in an async server page a test cannot render, so the only check was on the page's
// source -- which kept passing with the TikTok button pointed at Instagram. Rendered, that is a link
// with the wrong host. The expectations below are written out, never read from lib/social-profiles:
// a test that builds its answer from the module it checks agrees with that module however wrong it is.

afterEach(cleanup)

const handle = `@${SOCIAL_HANDLE}`
const EXPECTED = [
  { name: 'Instagram', host: 'www.instagram.com' },
  { name: 'TikTok', host: 'www.tiktok.com' },
]

describe('/about social buttons', () => {
  it('sends each button to its own network', () => {
    render(<SocialButtons />)
    for (const e of EXPECTED) {
      const link = screen.getByRole('link', { name: `${e.name} ${handle}` })
      expect(new URL(link.getAttribute('href') ?? '').hostname, e.name).toBe(e.host)
    }
  })

  it('shows the handle as the visible text, and names the network for a screen reader', () => {
    render(<SocialButtons />)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(EXPECTED.length)
    for (const a of links) expect(a.textContent?.trim()).toBe(handle)
  })

  it('draws the mark of each network, not the other one', () => {
    // Told apart by what is drawn, not by copying path data: Instagram's mark is an outlined rounded
    // square, TikTok's a single filled shape. Swapping which branch draws which passed every test
    // that only counted the marks.
    render(<SocialButtons />)
    const ig = screen.getByRole('link', { name: `Instagram ${handle}` }).querySelector('svg')
    const tt = screen.getByRole('link', { name: `TikTok ${handle}` }).querySelector('svg')
    expect(ig?.querySelector('rect')).not.toBeNull()
    expect(tt?.querySelector('rect')).toBeNull()
    expect(tt?.getAttribute('fill')).toBe('currentColor')
  })

  it('opens the network in a new tab without handing it this page', () => {
    render(<SocialButtons />)
    for (const a of screen.getAllByRole('link')) {
      expect(a.getAttribute('target')).toBe('_blank')
      const rel = (a.getAttribute('rel') ?? '').split(/\s+/)
      expect(rel).toContain('noopener')
      expect(rel).toContain('noreferrer')
    }
  })
})
