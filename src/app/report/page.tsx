import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import AccountNavLink from '@/components/AccountNavLink'
import HamburgerMenu from '@/components/HamburgerMenu'
import ReportForm from './ReportForm'

export const runtime = 'nodejs'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'
const PAGE_TITLE = 'Report an Album'
const PAGE_DESCRIPTION = 'Report a Hushare album for abuse, privacy concerns, spam, phishing, copyright issues, or other urgent safety problems.'

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/report' },
  robots: {
    index: false,
    follow: true,
  },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/report`,
    title: `${PAGE_TITLE} - Hushare`,
    description: PAGE_DESCRIPTION,
    siteName: 'Hushare',
    locale: 'en_US',
  },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'ContactPage',
  '@id': `${SITE_URL}/report#contactpage`,
  url: `${SITE_URL}/report`,
  name: `${PAGE_TITLE} - Hushare`,
  description: PAGE_DESCRIPTION,
  inLanguage: 'en',
  isPartOf: { '@id': `${SITE_URL}#website` },
}

export default function ReportPage() {
  return (
    <main className="min-h-screen" style={{ background: '#FDFAF5', fontFamily: 'var(--font-sans)' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />

      <nav
        className="hush-nav sticky top-0 z-50 flex items-center justify-between"
        style={{
          background: 'rgba(253, 250, 245, 0.85)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(221, 213, 197, 0.5)',
        }}
      >
        <Link href="/" className="flex items-center" aria-label="Hushare home">
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
        <HamburgerMenu>
          <Link href="/pricing" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>Pricing</Link>
          <Link href="/about" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>About</Link>
          <Link href="/collabs" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>Collabs</Link>
          <Link href="/support" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>Support</Link>
          <AccountNavLink />
        </HamburgerMenu>
      </nav>

      <section className="hush-readable hush-fade-up pt-12 text-center sm:pt-20">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: '#FBEAE6', color: '#8A0032' }}>
          <AlertTriangle className="h-6 w-6" />
        </div>
        <p className="mb-4 text-xs font-medium uppercase sm:text-sm" style={{ color: '#8B6F4E', letterSpacing: '0.18em' }}>
          Safety report
        </p>
        <h1
          style={{
            color: '#630826',
            fontFamily: 'var(--font-serif)',
            fontSize: 'clamp(2.2rem, 6vw, 4.2rem)',
            fontWeight: 700,
            lineHeight: 1.1,
          }}
        >
          Report an album
        </h1>
        <p className="mx-auto mt-5 max-w-[560px] text-base leading-relaxed sm:text-lg" style={{ color: '#6B5A4E' }}>
          Choose the closest reason and send it to our review inbox. Reports are handled separately from normal support.
        </p>
      </section>

      <section className="hush-form-width pb-24 pt-10">
        <div className="mb-5 flex items-start gap-3 rounded-2xl p-4" style={{ background: '#F6E9EE', border: '1px solid #C8D6C2' }}>
          <ShieldCheck className="mt-0.5 h-5 w-5 flex-none" style={{ color: '#630826' }} />
          <p className="text-sm leading-relaxed" style={{ color: '#5C4A3C' }}>
            If someone is in immediate danger, contact local emergency services first. This form is for Hushare album review.
          </p>
        </div>
        <ReportForm />
      </section>
    </main>
  )
}
