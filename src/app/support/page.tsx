import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { Mail, MessageCircle, Clock } from 'lucide-react'
import AccountNavLink from '@/components/AccountNavLink'
import HamburgerMenu from '@/components/HamburgerMenu'
import SupportForm from './SupportForm'

export const runtime = 'nodejs'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'
const SUPPORT_EMAIL = 'husharesupport@gmail.com'

const PAGE_TITLE = 'Support'
const PAGE_DESCRIPTION =
  'Get help with your Hushare album. Send a message, find answers to common questions, or email us directly - we usually reply within one business day.'

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/support' },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/support`,
    title: `${PAGE_TITLE} - Hushare`,
    description: PAGE_DESCRIPTION,
    siteName: 'Hushare',
    locale: 'en_US',
    images: [{ url: '/wedding.jpg', width: 700, height: 1052, alt: 'Hushare support' }],
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
        { '@type': 'ListItem', position: 2, name: 'Support', item: `${SITE_URL}/support` },
      ],
    },
    {
      '@type': 'ContactPage',
      '@id': `${SITE_URL}/support#contactpage`,
      url: `${SITE_URL}/support`,
      name: `${PAGE_TITLE} - Hushare`,
      description: PAGE_DESCRIPTION,
      inLanguage: 'en',
      isPartOf: { '@id': `${SITE_URL}#website` },
    },
  ],
}

const SERIF = { fontFamily: 'var(--font-serif)' } as const
const INK   = { color: '#254F22' } as const

const helpCards = [
  {
    icon: MessageCircle,
    title: 'Common questions',
    body: 'Most answers - pricing, privacy, photo retention, lost owner links - live on the home page FAQ and the pricing page.',
    href: '/#faq',
    cta: 'Browse the FAQ',
  },
  {
    icon: Mail,
    title: 'Email us directly',
    body: 'Prefer your own email client? Write to us anytime. We read every message.',
    href: `mailto:${SUPPORT_EMAIL}`,
    cta: SUPPORT_EMAIL,
  },
  {
    icon: Clock,
    title: 'When we reply',
    body: 'Usually within one business day, often faster. Max subscribers get priority within 24 hours, weekends included.',
    href: '/pricing',
    cta: 'See plans',
  },
]

export default function SupportPage() {
  return (
    <main
      className="min-h-screen"
      style={{ background: '#FDFAF5', fontFamily: 'var(--font-sans)' }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />

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
          <Link href="/pricing" className="text-sm font-medium hover:underline" style={{ color: '#254F22' }}>Pricing</Link>
          <Link href="/about" className="text-sm font-medium hover:underline" style={{ color: '#254F22' }}>About</Link>
          <Link href="/collabs" className="text-sm font-medium hover:underline" style={{ color: '#254F22' }}>Collabs</Link>
          <span className="text-sm font-semibold underline underline-offset-4" style={{ color: '#254F22' }}>Support</span>
          <AccountNavLink />
        </HamburgerMenu>
      </nav>

      {/* Hero */}
      <section className="hush-readable hush-fade-up pt-12 sm:pt-20 pb-8 text-center">
        <p
          className="text-xs sm:text-sm font-medium uppercase mb-4"
          style={{ color: '#8B6F4E', letterSpacing: '0.18em' }}
        >
          Support
        </p>
        <h1
          style={{
            ...SERIF,
            ...INK,
            fontSize: 'clamp(2.2rem, 6vw, 4.2rem)',
            lineHeight: 1.1,
            fontWeight: 700,
          }}
        >
          We&apos;re here<br />
          <em style={{ color: '#7C4A2D' }}>to help</em>
        </h1>
        <p
          className="mt-5 text-base sm:text-lg leading-relaxed mx-auto"
          style={{ color: '#6B5A4E', maxWidth: '520px' }}
        >
          Real humans, real replies. Send a message below or email us directly -
          we usually answer within a business day.
        </p>
      </section>

      {/* Quick help cards */}
      <section className="hush-container pb-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 xl:gap-7">
          {helpCards.map(({ icon: Icon, title, body, href, cta }) => (
            <article
              key={title}
              className="hush-hover-lift rounded-2xl p-6 flex flex-col"
              style={{
                background: '#FFFFFF',
                border: '1px solid #DDD5C5',
                boxShadow: '0 4px 20px rgba(37,79,34,0.06)',
              }}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                style={{ background: '#EAF0E8' }}
              >
                <Icon className="w-5 h-5" style={INK} />
              </div>
              <h2
                className="mb-2"
                style={{ ...SERIF, ...INK, fontSize: '1.15rem', fontWeight: 700, lineHeight: 1.2 }}
              >
                {title}
              </h2>
              <p className="text-sm leading-relaxed mb-5 flex-1" style={{ color: '#5C4A3C' }}>
                {body}
              </p>
              {href.startsWith('mailto:') ? (
                <a href={href} className="text-sm font-semibold hover:underline" style={{ color: '#254F22' }}>{cta}</a>
              ) : (
                <Link href={href} className="text-sm font-semibold hover:underline" style={{ color: '#254F22' }}>{cta}</Link>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* Contact form */}
      <section className="hush-form-width pb-24">
        <div className="flex items-center gap-6 mb-8">
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
          <p style={{ ...INK, ...SERIF, fontSize: '1.4rem', fontWeight: 700, letterSpacing: '0.22em', whiteSpace: 'nowrap', lineHeight: 1 }}>
            WRITE TO US
          </p>
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
        </div>

        <div className="hush-reveal">
          <SupportForm />
        </div>

        <p
          className="text-center text-xs mt-6 italic"
          style={{ color: '#8B6F4E', fontFamily: 'var(--font-serif)' }}
        >
          We never share your email. Used only to reply to your message.
        </p>
      </section>
    </main>
  )
}
