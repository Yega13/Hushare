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
  '/support',
  '/terms',
  '/wedding-photo-sharing',
])

export default function SiteFooter() {
  const { t } = useT()
  const pathname = usePathname()
  const normalizedPathname = pathname === '/' ? pathname : pathname.replace(/\/$/, '')
  if (!footerRoutes.has(normalizedPathname)) return null

  const visibleLinks = footerLinks.filter((link) => link.href !== normalizedPathname)

  return (
    <footer
      className="hush-footer mt-auto py-6 flex flex-col md:flex-row items-center md:justify-between gap-3 text-sm"
      style={{ background: '#FDFAF5', borderTop: '1px solid #E8E0D0' }}
    >
      <Link href="/" className="hush-footer-logo flex items-center" aria-label="Hushare home">
        <Image
          src="/logo/logo-dark-transparent.png"
          alt="Hushare"
          width={618}
          height={146}
          className="hush-logo"
          style={{ width: 'auto' }}
          draggable={false}
        />
      </Link>
      <nav className="hush-footer-links" aria-label="Footer">
        {visibleLinks.map((link) => (
          <Link key={link.href} href={link.href} className="hush-footer-link" style={{ color: '#7C5C3E' }}>
            {t(link.labelKey)}
          </Link>
        ))}
        <span className="hush-footer-note" style={{ color: '#B0A090' }} suppressHydrationWarning>
          {t('footer.copyright', { year: new Date().getFullYear() })}
        </span>
        {LANGUAGE_UI_ENABLED && <LanguageSwitcher className="hush-footer-link" />}
      </nav>
    </footer>
  )
}
