import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import AccountNavLink from '@/components/AccountNavLink'
import HamburgerMenu from '@/components/HamburgerMenu'

export const runtime = 'nodejs'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'
const PUBLISHED = '2026-04-25'
const LAST_UPDATED = '2026-07-18'
const LAST_UPDATED_HUMAN = 'July 18, 2026'

const PAGE_TITLE = 'Privacy Policy'
const PAGE_DESCRIPTION =
  'How Hushare handles your shared photo albums, uploaded media, and metadata. No tracking cookies, no ads, no selling of data - ever.'

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

export default function PrivacyPage() {
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

      <article className="hush-readable hush-fade-up py-16">
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
            fontSize: 'clamp(2.35rem, 4.2vw, 4rem)',
            lineHeight: 1.1,
            fontWeight: 700,
          }}
        >
          Privacy Policy
        </h1>
        <p className="mt-4 text-sm" style={{ color: '#8B6F4E' }}>
          Last updated: <time dateTime={LAST_UPDATED}>{LAST_UPDATED_HUMAN}</time>
        </p>

        <div className="mt-6 h-px" style={RULE} />

        <p className="mt-8 text-lg leading-relaxed" style={BODY}>
          Hushare (&ldquo;we&rdquo;, &ldquo;us&rdquo;) helps anyone create a
          shared photo album from a single link - no sign-up, no app. This
          policy explains exactly what we store, why we store it, and the
          rights you have over it. We designed Hushare to collect as little as
          physically possible to run the service.
        </p>

        <Section id="what-we-collect" number={1} heading="What we collect">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong style={INK}>Album title</strong> - the name you give your album.
            </li>
            <li>
              <strong style={INK}>Photos and videos</strong> uploaded by you
              or anyone you share the album link with.
            </li>
            <li>
              <strong style={INK}>Owner token</strong> - a random string
              embedded in the private link you receive. It is how we recognise
              you as the album creator.
            </li>
            <li>
              <strong style={INK}>Request metadata</strong> - IP address (kept
              briefly, for abuse prevention), user-agent string, timestamps.
            </li>
          </ul>
          <p className="mt-3">
            We do <strong style={INK}>not</strong> ask for your name, email,
            phone number, or any form of account. We do not run third-party
            advertising or identity-based analytics.
          </p>
        </Section>

        <Section id="how-we-use" number={2} heading="How we use it">
          <ul className="list-disc pl-5 space-y-2">
            <li>To create, store, and display your albums.</li>
            <li>
              To prevent abuse (spam uploads, illegal content) and keep the
              service stable.
            </li>
            <li>
              To understand, in aggregate, how Hushare is used so we can
              improve it.
            </li>
          </ul>
        </Section>

        <Section id="third-parties" number={3} heading="Third-party processors">
          <p>
            To run Hushare we use a small, vetted set of infrastructure
            providers:
          </p>
          <ul className="list-disc pl-5 space-y-2 mt-3">
            <li>
              <strong style={INK}>Supabase</strong> - stores album metadata
              and uploaded media.
            </li>
            <li>
              <strong style={INK}>Cloudflare</strong> - hosting, content
              delivery, and DDoS protection.
            </li>
          </ul>
          <p className="mt-3">
            These providers process data strictly on our behalf under
            contractual data-processing terms.
          </p>
        </Section>

        <Section id="cookies" number={4} heading="Cookies and local storage">
          <p>
            Hushare uses your browser&apos;s local storage to remember small
            preferences, such as the album background colour you chose. We do
            not use tracking cookies, advertising cookies, or cross-site
            identifiers. No third-party analytics script runs on this site.
          </p>
        </Section>

        <Section id="sharing" number={5} heading="Who can see your album">
          <p>
            Albums are <strong style={INK}>unlisted</strong>. They are not
            indexed by search engines, cannot be browsed from the site, and
            are only reachable by someone who has the link. You decide who
            receives that link. We do not sell, rent, or share your data with
            advertisers - ever.
          </p>
          <p className="mt-3">
            In limited circumstances, authorised Hushare staff may access album
            content - including photos and videos - where it is necessary to run
            the service: to respond to a report or legal request, to investigate
            suspected illegal or abusive content, to comply with applicable law,
            or to help you with a support request you have raised. We access
            content only when there is a specific, legitimate reason to do so -
            never to browse albums out of curiosity, and never for advertising.
          </p>
        </Section>

        <Section id="retention" number={6} heading="How long we keep things">
          <p>
            Free albums are retained for as long as they remain active. If an
            album sits untouched for <strong style={INK}>3 months</strong>,
            it is automatically retired and its media is permanently deleted.
            You may request deletion of your album at any time by emailing us
            - see section 12.
          </p>
        </Section>

        <Section id="rights" number={7} heading="Your rights">
          <p>
            Depending on where you live (GDPR in the EU/UK, CCPA in
            California, and equivalent regimes elsewhere), you have the
            right to:
          </p>
          <ul className="list-disc pl-5 space-y-2 mt-3">
            <li>Access the data we hold about your album.</li>
            <li>Request correction or deletion.</li>
            <li>Object to, or restrict, processing.</li>
            <li>
              Export a copy of your album (we already offer a one-click ZIP
              download inside the app).
            </li>
            <li>Lodge a complaint with your local data-protection authority.</li>
          </ul>
          <p className="mt-3">
            To exercise any of these rights, email{' '}
            <a
              href="mailto:husharesupport@gmail.com"
              style={{ color: '#630826', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
            >
              husharesupport@gmail.com
            </a>{' '}
            from the address you used to contact us - or, if you never gave
            us one, include your album name and approximate creation date.
          </p>
        </Section>

        <Section id="children" number={8} heading="Children">
          <p>
            Hushare is not directed at children under 13 (or the equivalent
            minimum age in your jurisdiction). We do not knowingly collect
            personal information from children. If you believe a child has
            uploaded content to Hushare, contact us and we will delete it.
          </p>
        </Section>

        <Section id="transfers" number={9} heading="International data transfers">
          <p>
            Our infrastructure providers operate globally, which means your
            data may be processed in a country other than where you live.
            Where such transfers require a legal basis, we rely on standard
            contractual clauses or equivalent safeguards.
          </p>
        </Section>

        <Section id="security" number={10} heading="Security">
          <p>
            Media is stored on hardened cloud infrastructure with encryption
            in transit (HTTPS) and encryption at rest. Access to an album
            requires knowledge of its unlisted link; management actions
            additionally require the owner token. No system is perfectly
            secure, so please share your owner link only with people you
            trust.
          </p>
        </Section>

        <Section id="changes" number={11} heading="Changes to this policy">
          <p>
            We will post updates here. The &ldquo;Last updated&rdquo; date at
            the top reflects the most recent change. Material changes will be
            surfaced inside the product before they take effect.
          </p>
        </Section>

        <Section id="contact" number={12} heading="Contact">
          <p>
            Questions, requests, complaints - all of it comes to one
            address:{' '}
            <a
              href="mailto:husharesupport@gmail.com"
              style={{ color: '#630826', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
            >
              husharesupport@gmail.com
            </a>
            . A human replies.
          </p>
        </Section>

        <div className="mt-16 h-px" style={RULE} />
        <p
          className="text-center text-sm mt-8 italic"
          style={{ color: '#8B6F4E', ...SERIF }}
        >
          - with love, from Yerevan
        </p>
      </article>
    </main>
  )
}
