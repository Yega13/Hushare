import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import AccountNavLink from '@/components/AccountNavLink'
import HamburgerMenu from '@/components/HamburgerMenu'
import { ArrowUpRight } from 'lucide-react'
import { getServerLocale } from '@/i18n/server'
import { getDictionary } from '@/i18n/get-dictionary'
import type { DictKey } from '@/i18n/dictionaries/en'

export const runtime = 'nodejs'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'

const PAGE_TITLE = 'Collabs'
const PAGE_DESCRIPTION =
  'Communities, artists, and creators who use Hushare to collect shared photos and turn every event into a living album.'

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/collabs' },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/collabs`,
    title: `${PAGE_TITLE} - Hushare`,
    description: PAGE_DESCRIPTION,
    siteName: 'Hushare',
    locale: 'en_US',
    images: [{ url: `${SITE_URL}/collabs/tali-golergant.jpg`, alt: 'Tali Golergant × Hushare' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${PAGE_TITLE} - Hushare`,
    description: PAGE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-snippet': -1, 'max-image-preview': 'large' },
  },
}

const SERIF = { fontFamily: 'var(--font-serif)' } as const

const collabs: Array<{
  name: string
  originKey: DictKey
  roleKey: DictKey
  descKey: DictKey
  photo: string
  photoAlt: string
  href: string
}> = [
  {
    name: 'Tali Golergant',
    originKey: 'collab.tali.origin',
    roleKey: 'collab.tali.role',
    descKey: 'collab.tali.desc',
    photo: '/collabs/tali-golergant.jpg',
    photoAlt: 'Tali Golergant',
    href: 'https://taligolergant.org/hushare-collab/',
  },
]

export default async function CollabsPage() {
  const dict = getDictionary(await getServerLocale())
  return (
    <main className="min-h-screen" style={{ background: '#FDFAF5' }}>

      {/* Nav */}
      <nav
        className="hush-nav sticky top-0 z-50 flex items-center justify-between"
        style={{
          background: 'rgba(253, 250, 245, 0.85)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(221, 213, 197, 0.5)',
        }}
      >
        <Link href="/" aria-label="Hushare home">
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
          <Link href="/pricing" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>{dict['nav.pricing']}</Link>
          <Link href="/about" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>{dict['nav.about']}</Link>
          <span className="text-sm font-semibold" style={{ color: '#630826' }}>{dict['nav.collabs']}</span>
          <Link href="/support" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>{dict['nav.support']}</Link>
          <AccountNavLink />
        </HamburgerMenu>
      </nav>

      {/* Hero */}
      <section className="hush-readable hush-fade-up pt-12 sm:pt-20 pb-12 text-center px-4">
        <p
          className="text-xs sm:text-sm font-medium uppercase mb-4"
          style={{ color: '#8B6F4E', letterSpacing: '0.18em' }}
        >
          {dict['nav.collabs']}
        </p>
        <h1
          className="text-3xl sm:text-4xl md:text-5xl font-bold mb-5 leading-tight"
          style={{ ...SERIF, color: '#630826' }}
        >
          {dict['collabs.title']}
        </h1>
        <p
          className="text-base sm:text-lg max-w-lg mx-auto leading-relaxed"
          style={{ color: '#5C4A3C' }}
        >
          {dict['collabs.subtitle']}
        </p>
      </section>

      {/* Featured collabs */}
      <section className="hush-container-xl pb-28 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto flex flex-col gap-12">
          {collabs.map((collab) => (
            <article
              key={collab.name}
              className="hush-reveal flex flex-col md:flex-row rounded-[24px] overflow-hidden"
              style={{
                background: '#FFFFFF',
                border: '1px solid #E4DDD2',
                boxShadow: '0 8px 40px rgba(99,8,38,0.09), 0 1px 4px rgba(99,8,38,0.05)',
              }}
            >
              {/* Image */}
              <div
                className="relative w-full md:w-[48%] flex-none"
                style={{ minHeight: '300px' }}
              >
                <Image
                  src={collab.photo}
                  alt={collab.photoAlt}
                  fill
                  className="object-cover"
                  sizes="(min-width: 768px) 45vw, 100vw"
                  priority
                />
              </div>

              {/* Content */}
              <div
                className="flex flex-col justify-center gap-5 p-8 md:p-10 flex-1"
                style={{ background: '#FDFAF5' }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs font-semibold uppercase tracking-widest"
                    style={{ color: '#8B6F4E' }}
                  >
                    {dict[collab.originKey]} · {dict[collab.roleKey]}
                  </span>
                </div>

                <h2
                  className="text-2xl sm:text-3xl font-bold leading-tight"
                  style={{ ...SERIF, color: '#630826' }}
                >
                  {collab.name}
                </h2>

                <div className="w-10 h-px" style={{ background: 'rgba(196,166,120,0.5)' }} />

                <p className="text-sm sm:text-base leading-relaxed" style={{ color: '#5C4A3C' }}>
                  {dict[collab.descKey]}
                </p>

                <a
                  href={collab.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 self-start rounded-xl px-5 py-2.5 text-sm font-semibold transition hover:opacity-85"
                  style={{ background: '#630826', color: '#FDFAF5' }}
                >
                  {dict['collabs.seeCollab']}
                  <ArrowUpRight className="w-4 h-4" />
                </a>
              </div>
            </article>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-20 max-w-4xl mx-auto">
          <div
            className="rounded-[20px] px-8 py-10 text-center"
            style={{
              background: 'linear-gradient(135deg, #630826 0%, #1a3a18 100%)',
              boxShadow: '0 8px 32px rgba(99,8,38,0.2)',
            }}
          >
            <p
              className="text-xs font-semibold uppercase mb-4"
              style={{ color: 'rgba(253,250,245,0.55)', letterSpacing: '0.18em' }}
            >
              {dict['collabs.ctaEyebrow']}
            </p>
            <h2
              className="text-xl sm:text-2xl font-bold mb-3"
              style={{ ...SERIF, color: '#FDFAF5' }}
            >
              {dict['collabs.ctaTitle']}
            </h2>
            <p className="text-sm leading-relaxed mb-6 max-w-md mx-auto" style={{ color: 'rgba(253,250,245,0.72)' }}>
              {dict['collabs.ctaBody']}
            </p>
            <a
              href="mailto:husharesupport@gmail.com"
              className="inline-block rounded-xl px-6 py-2.5 text-sm font-semibold transition hover:opacity-90"
              style={{ background: '#FDFAF5', color: '#630826' }}
            >
              {dict['collabs.ctaButton']}
            </a>
          </div>
        </div>
      </section>

    </main>
  )
}
