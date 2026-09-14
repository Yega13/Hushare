// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { LocaleProvider } from '@/i18n/LocaleProvider'
import { en } from '@/i18n/dictionaries/en'
import FooterSocials from '@/components/FooterSocials'
import { SOCIAL_PROFILES, socialHandleLabel } from '@/lib/social-profiles'

// THE SOCIALS IN THE FOOTER.
//
// What is worth pinning is not the look -- the prints are CSS -- but the promises the markup makes:
// every account is reachable, a screen reader can tell the two apart though they share a handle, the
// link cannot hand our page to the site it opens, and the footer carrying them still never appears
// on an album, where a wedding guest would be looking at Hushare's accounts instead of the couple's
// photographs.

const nav = { path: '/' }
vi.mock('next/navigation', () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))

// jsdom has no matchMedia, and SiteFooter asks it whether the reader wants reduced motion. Every real
// browser has it; the answer here is "no preference", which is what most visitors send.
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  })
}

const { default: SiteFooter } = await import('@/components/SiteFooter')

afterEach(() => {
  cleanup()
  nav.path = '/'
})

const handle = socialHandleLabel()

describe('FooterSocials', () => {
  it('links every profile, in the order the shared list gives', () => {
    render(<FooterSocials followPre="Follow" followPost="to be the first to know." />)
    const links = screen.getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual(SOCIAL_PROFILES.map((p) => p.url))
  })

  it('names each link by its network, because both show the same handle', () => {
    render(<FooterSocials followPre="Follow" followPost="to be the first to know." />)
    for (const p of SOCIAL_PROFILES) {
      expect(screen.getByRole('link', { name: `${p.name} ${handle}` })).toBeTruthy()
    }
  })

  it('opens the network in a new tab without handing it this page', () => {
    // noopener: the opened page gets no window.opener to navigate us with. noreferrer: it is not
    // told which Hushare page the visitor was on.
    render(<FooterSocials followPre="Follow" followPost="to be the first to know." />)
    for (const a of screen.getAllByRole('link')) {
      expect(a.getAttribute('target')).toBe('_blank')
      const rel = (a.getAttribute('rel') ?? '').split(/\s+/)
      expect(rel).toContain('noopener')
      expect(rel).toContain('noreferrer')
    }
  })

  it('keeps the marks decorative, so the accessible name is the label and nothing else', () => {
    const { container } = render(<FooterSocials followPre="Follow" followPost="to be the first to know." />)
    const svgs = container.querySelectorAll('a svg')
    expect(svgs).toHaveLength(SOCIAL_PROFILES.length)
    for (const svg of svgs) expect(svg.getAttribute('aria-hidden')).toBe('true')
  })

  it('puts the right mark on each print', () => {
    // Names written out, not read from the module. Told apart by what is drawn rather than by copying
    // path data: Instagram's mark is an outlined rounded square, TikTok's a single filled shape.
    // Swapping which branch of SocialGlyph draws which passed every test that only counted the marks.
    render(<FooterSocials followPre="Follow" followPost="to be the first to know." />)
    const ig = screen.getByRole('link', { name: `Instagram ${handle}` }).querySelector('svg')
    const tt = screen.getByRole('link', { name: `TikTok ${handle}` }).querySelector('svg')
    expect(ig?.querySelector('rect')).not.toBeNull()
    expect(tt?.querySelector('rect')).toBeNull()
    expect(tt?.getAttribute('fill')).toBe('currentColor')
  })

  it('reads as one sentence, with the handle in the middle', () => {
    const { container } = render(<FooterSocials followPre="Follow" followPost="to be the first to know." />)
    const sentence = container.querySelector('p')?.textContent?.replace(/\s+/g, ' ').trim()
    expect(sentence).toBe(`Follow ${handle} to be the first to know.`)
  })

  it('marks the handle untranslatable itself, not only through the attribute on <body>', () => {
    const { container } = render(<FooterSocials followPre="Follow" followPost="to be the first to know." />)
    const span = [...container.querySelectorAll('span')].find((s) => s.textContent === handle)
    expect(span?.getAttribute('translate')).toBe('no')
  })
})

describe('SiteFooter carries them', () => {
  function renderFooter(path: string) {
    nav.path = path
    return render(
      <LocaleProvider locale="en" dict={en}>
        <SiteFooter />
      </LocaleProvider>,
    )
  }

  it('on the home page, in the words /about already uses', () => {
    renderFooter('/')
    for (const p of SOCIAL_PROFILES) expect(screen.getByRole('link', { name: `${p.name} ${handle}` })).toBeTruthy()
    const sentence = screen.getByText(handle).closest('p')?.textContent?.replace(/\s+/g, ' ').trim()
    expect(sentence).toBe(`${en['about.followPre']} ${handle} ${en['about.followPost']}`)
  })

  it('on a statement page', () => {
    renderFooter('/statement/new-tools-clearer-plans')
    expect(screen.getByRole('link', { name: `Instagram ${handle}` })).toBeTruthy()
  })

  it('NEVER on an album, where the guest is there for someone else’s photographs', () => {
    renderFooter('/k3v9x2ab')
    expect(screen.queryByRole('link', { name: `Instagram ${handle}` })).toBeNull()
    expect(screen.queryByRole('link', { name: `TikTok ${handle}` })).toBeNull()
  })
})
