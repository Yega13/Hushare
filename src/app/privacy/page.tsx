import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import AccountNavLink from '@/components/AccountNavLink'
import { getServerLocale } from '@/i18n/server'
import { en } from './content-en'
import { ru } from './content-ru'
import { hy } from './content-hy'
import { CHROME } from './chrome'
import HamburgerMenu from '@/components/HamburgerMenu'

export const runtime = 'nodejs'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'
const PUBLISHED = '2026-04-25'
const LAST_UPDATED = '2026-08-17'
const LAST_UPDATED_HUMAN = 'August 17, 2026'

const PAGE_TITLE = 'Privacy Policy'
const PAGE_DESCRIPTION =
  'How Hushare handles your shared photo albums, uploaded media, and metadata. No ads, no profiling, no selling of data - ever.'

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/privacy' },
  openGraph: {
    type: 'article',
    url: `${SITE_URL}/privacy`,
    title: `${PAGE_TITLE} - Hushare`,
    description: PAGE_DESCRIPTION,
    siteName: 'Hushare',
    locale: 'en_US',
    images: [{ url: '/wedding.jpg', width: 700, height: 1052, alt: 'Hushare Privacy Policy' }],
  },
  twitter: {
    card: 'summary',
    title: `${PAGE_TITLE} - Hushare`,
    description: PAGE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-snippet': -1,
      'max-image-preview': 'large',
    },
  },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'Privacy Policy', item: `${SITE_URL}/privacy` },
      ],
    },
    {
      '@type': 'WebPage',
      '@id': `${SITE_URL}/privacy#webpage`,
      url: `${SITE_URL}/privacy`,
      name: `${PAGE_TITLE} - Hushare`,
      description: PAGE_DESCRIPTION,
      inLanguage: 'en',
      isPartOf: { '@id': `${SITE_URL}#website` },
      dateModified: LAST_UPDATED,
      datePublished: PUBLISHED,
      about: { '@id': `${SITE_URL}#organization` },
    },
  ],
}


const SERIF = { fontFamily: 'var(--font-serif)' } as const
const INK   = { color: '#630826' } as const
const BODY  = { color: '#5C4A3C' } as const
const RULE  = { background: '#E8E0D0' } as const

function Section({
  id,
  number,
  heading,
  children,
}: {
  id: string
  number: number
  heading: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="mt-10 scroll-mt-24">
      <h2 className="text-2xl font-bold mb-3" style={{ ...SERIF, ...INK }}>
        <span style={{ color: '#7C4A2D', marginRight: '0.6rem' }}>{number}.</span>
        {heading}
      </h2>
      <div className="text-[0.98rem] leading-relaxed" style={BODY}>
        {children}
      </div>
    </section>
  )
}

export default async function PrivacyPage() {
  // The policy is the one page where a reader who cannot follow the text cannot give informed
  // consent, so it follows the same cookie locale as the rest of the site. A language with no
  // translation yet falls through to English — the behaviour the page already had.
  const locale = await getServerLocale()
  const content = locale === 'ru' ? ru : locale === 'hy' ? hy : en
  const chrome = CHROME[locale] ?? CHROME.en
  return (
    <main
      className="min-h-screen"
      style={{ background: '#FDFAF5', fontFamily: 'var(--font-sans)' }}
    >
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

      {/* px on mobile: hush-readable collapses to ~0.75rem side margin on small phones, which left
          the text hugging the screen edges. Lighter top/bottom padding on mobile too. */}
      <article className="hush-readable hush-fade-up py-9 sm:py-16 px-4 sm:px-0">
        <p
          className="text-sm font-medium uppercase mb-5"
          style={{ color: '#8B6F4E', letterSpacing: '0.18em' }}
        >
          Legal - Hushare
        </p>
        <h1
          style={{
            ...SERIF,
            ...INK,
            fontSize: 'clamp(2rem, 4.2vw, 3.25rem)',
            lineHeight: 1.1,
            fontWeight: 700,
          }}
        >
          {chrome.title}
        </h1>
        <p className="mt-4 text-sm" style={{ color: '#8B6F4E' }}>
          {chrome.lastUpdated}: <time dateTime={LAST_UPDATED}>{LAST_UPDATED_HUMAN}</time>
        </p>

        <div className="mt-6 h-px" style={RULE} />

        {/* The anchors have always been there; nothing ever linked to them, so on a phone the
            face-search section was six scrolls down with no way to jump. */}
        <nav aria-label="Contents" className="mt-8 rounded-2xl p-4" style={{ background: '#F6F1E8', border: '1px solid #E8E0D0' }}>
          <p className="text-xs font-semibold uppercase mb-3" style={{ color: '#8B6F4E', letterSpacing: '0.12em' }}>
            {chrome.contents}
          </p>
          <ol className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 text-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {content.sections.map((sec, i) => (
              <li key={sec.id}>
                <a href={`#${sec.id}`} style={{ color: '#630826', textDecoration: 'none' }}>
                  <span style={{ color: '#A89880', marginRight: 6 }}>{i + 1}.</span>{sec.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>


        {content.localeNote && (
          <p className="mt-8 text-sm rounded-xl p-3" style={{ ...BODY, background: '#F6F1E8', border: '1px solid #E8E0D0' }}>
            {content.localeNote}
          </p>
        )}

        <p className="mt-8 text-lg leading-relaxed" style={BODY}>
          {chrome.intro}
        </p>

        {content.sections.map((sec, i) => (
          <Section key={sec.id} id={sec.id} number={i + 1} heading={sec.heading}>
            {sec.body}
          </Section>
        ))}

        <div className="mt-16 h-px" style={RULE} />
        <p
          className="text-center text-sm mt-8 italic"
          style={{ color: '#8B6F4E', ...SERIF }}
        >
          {chrome.footer}
        </p>
      </article>
    </main>
  )
}
