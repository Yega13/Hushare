'use client'

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

export default function SiteFooter() {
  const { t } = useT()
  const pathname = usePathname()
  const normalizedPathname = pathname === '/' ? pathname : pathname.replace(/\/$/, '')
  // Show on the listed routes, plus every individual statement page (/statement/<slug>).
  if (!footerRoutes.has(normalizedPathname) && !normalizedPathname.startsWith('/statement/')) return null

  const visibleLinks = footerLinks.filter((link) => link.href !== normalizedPathname)

  return (
    <footer className="hush-site-footer mt-auto" style={{ background: '#FBF6EC', borderTop: '1px solid #E8E0D0' }}>
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
