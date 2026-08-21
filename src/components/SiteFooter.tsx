'use client'

import { useEffect, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import { LANGUAGE_UI_ENABLED } from '@/i18n/config'
import { useT } from '@/i18n/LocaleProvider'

const footerLinks = [
  { href: '/', labelKey: 'nav.home' },
  { href: '/about', labelKey: 'nav.about' },
  { href: '/pricing', labelKey: 'nav.pricing' },
  { href: '/collabs', labelKey: 'nav.collabs' },
  { href: '/shared-photo-album', labelKey: 'nav.sharedAlbums' },
  { href: '/wedding-photo-sharing', labelKey: 'nav.weddings' },
  { href: '/event-photo-sharing', labelKey: 'nav.events' },
  { href: '/qr-code-photo-album', labelKey: 'nav.qrAlbums' },
  { href: '/support', labelKey: 'nav.support' },
  { href: '/statement', labelKey: 'nav.statement' },
  { href: '/privacy', labelKey: 'nav.privacy' },
  { href: '/terms', labelKey: 'nav.terms' },
]

const footerRoutes = new Set([
  '/',
  '/about',
  '/account',
  '/collabs',
  '/event-photo-sharing',
  '/login',
  '/pricing',
  '/privacy',
  '/qr-code-photo-album',
  '/report',
  '/shared-photo-album',
  '/statement',
  '/support',
  '/terms',
  '/wedding-photo-sharing',
])

// Routes that get the scroll REVEAL rather than a plain footer. Marketing pages only: a page you
// arrived at to read is a fine place for a flourish, whereas /login, /report, /support and /account
// are pages someone is trying to finish. Animating the furniture while they fill in a support form
// is decoration getting in the way of the job.
const revealRoutes = new Set([
  '/',
  '/about',
  '/pricing',
  '/collabs',
  '/event-photo-sharing',
  '/qr-code-photo-album',
  '/shared-photo-album',
  '/wedding-photo-sharing',
])

export default function SiteFooter() {
  const { t } = useT()
  const pathname = usePathname()
  const normalizedPathname = pathname === '/' ? pathname : pathname.replace(/\/$/, '')
  // Computed BEFORE the early return below, together with the ref and effect that use it. React
  // forbids a hook after a conditional return, and this component returns null on most routes --
  // declaring them here is what keeps the hook order identical on every render.
  const reveal = revealRoutes.has(normalizedPathname)
  const footerRef = useRef<HTMLElement | null>(null)

  // Measures how far the page's bottom edge has risen past the bottom of the viewport, which is
  // exactly how much of the sticky footer is uncovered, and hands it to CSS as --hush-reveal.
  // See the note in layout.css for why this is not `animation-timeline: view()`.
  useEffect(() => {
    if (!reveal) return
    const el = footerRef.current
    // The var is written on the CHILD, not on the footer. Custom properties inherit, but the
    // stylesheet declares `--hush-reveal: 1` on `.hush-footer-reveal > *`, and a child's own
    // declaration beats an inherited one -- setting it on the parent would be silently ignored.
    const inner = el?.firstElementChild as HTMLElement | null
    const main = document.querySelector('main')
    if (!inner || !main) return
    // Skipped entirely rather than animated-then-overridden, so a reader who asked for less motion
    // costs nothing per frame.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let raf = 0
    const paint = () => {
      raf = 0
      const height = el!.offsetHeight
      if (height <= 0) return
      const uncovered = (window.innerHeight - main.getBoundingClientRect().bottom) / height
      inner.style.setProperty('--hush-reveal', Math.min(1, Math.max(0, uncovered)).toFixed(3))
    }
    // Coalesced to one write per frame. A scroll event can fire many times between paints, and
    // each write here costs a style recalc on a blurred, full-width box -- the one thing worth
    // being careful about in this whole effect.
    const schedule = () => { if (!raf) raf = requestAnimationFrame(paint) }

    paint()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [reveal, normalizedPathname])

  // Show on the listed routes, plus every individual statement page (/statement/<slug>).
  if (!footerRoutes.has(normalizedPathname) && !normalizedPathname.startsWith('/statement/')) return null
  const visibleLinks = footerLinks.filter((link) => link.href !== normalizedPathname)

  return (
    <footer ref={footerRef} className={`hush-site-footer mt-auto${reveal ? ' hush-footer-reveal' : ''}`} style={{ background: '#FBF6EC', borderTop: '1px solid #E8E0D0' }}>
      <div style={{ width: 'min(100% - 2.5rem, 1200px)', marginInline: 'auto', paddingBlock: 'clamp(1.75rem, 3vw, 2.75rem)' }}>
        {/* Top tier: brand + tagline on the left, links on the right */}
        <div className="hush-foot-top" style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem 2rem', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ maxWidth: 300 }}>
            <Link href="/" aria-label="Hushare home" style={{ display: 'inline-flex' }}>
              <Image src="/logo/logo-dark-transparent.png" alt="Hushare" width={618} height={146} style={{ height: 30, width: 'auto' }} draggable={false} />
            </Link>
            <p style={{ marginTop: 12, fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: '0.98rem', lineHeight: 1.5, color: '#8B6F4E' }}>
              {t('footer.tagline')}
            </p>
          </div>
          <nav aria-label="Footer" className="hush-foot-nav" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.55rem 1.4rem', maxWidth: 620, justifyContent: 'flex-end' }}>
            {visibleLinks.map((link) => (
              <Link key={link.href} href={link.href} className="hush-foot-link" style={{ fontSize: '0.875rem', color: '#5C4A3C', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                {t(link.labelKey)}
              </Link>
            ))}
          </nav>
        </div>

        {/* Base tier: copyright + language */}
        <div className="hush-foot-base" style={{ marginTop: 'clamp(1.25rem, 2.5vw, 1.9rem)', paddingTop: '1rem', borderTop: '1px solid #ECE4D4', display: 'flex', flexWrap: 'wrap', gap: '0.75rem 1rem', alignItems: 'center', justifyContent: 'space-between' }}>
          <span suppressHydrationWarning style={{ fontSize: '0.8rem', color: '#A99A87', letterSpacing: '0.01em' }}>
            {t('footer.copyright', { year: new Date().getFullYear() })}
          </span>
          {LANGUAGE_UI_ENABLED && <LanguageSwitcher className="hush-foot-link" />}
        </div>
      </div>

      <style>{`
        .hush-foot-link { transition: color 140ms ease; }
        .hush-foot-link:hover { color: #630826 !important; }
        @media (max-width: 640px) {
          .hush-foot-top { flex-direction: column; align-items: center !important; text-align: center; }
          .hush-foot-nav { justify-content: center !important; max-width: none !important; }
          .hush-foot-base { justify-content: center !important; }
        }
      `}</style>
    </footer>
  )
}
