'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import LanguageSwitcher from '@/components/LanguageSwitcher'

const footerLinks = [
  { href: '/', label: 'Home' },
  { href: '/about', label: 'About' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/collabs', label: 'Collabs' },
  { href: '/shared-photo-album', label: 'Shared albums' },
  { href: '/wedding-photo-sharing', label: 'Weddings' },
  { href: '/event-photo-sharing', label: 'Events' },
  { href: '/qr-code-photo-album', label: 'QR albums' },
  { href: '/support', label: 'Support' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
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
            {link.label}
          </Link>
        ))}
        <span className="hush-footer-note" style={{ color: '#B0A090' }} suppressHydrationWarning>
          © {new Date().getFullYear()} - your moments, always.
        </span>
        <LanguageSwitcher className="hush-footer-link" />
      </nav>
    </footer>
  )
}
