import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import AccountNavLink from '@/components/AccountNavLink'
import HamburgerMenu from '@/components/HamburgerMenu'

export const runtime = 'nodejs'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'
const LAST_UPDATED = '2026-04-25'
const LAST_UPDATED_HUMAN = 'April 25, 2026'

const PAGE_TITLE = 'Terms of Service'
const PAGE_DESCRIPTION =
  'The rules for using Hushare - what you can upload, what we do with it, and how we handle takedowns and account issues.'

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/terms' },
  openGraph: {
    type: 'article',
    url: `${SITE_URL}/terms`,
    title: `${PAGE_TITLE} - Hushare`,
    description: PAGE_DESCRIPTION,
    siteName: 'Hushare',
    locale: 'en_US',
    images: [{ url: '/wedding.jpg', width: 700, height: 1052, alt: 'Hushare Terms of Service' }],
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
  '@type': 'WebPage',
  '@id': `${SITE_URL}/terms#webpage`,
  url: `${SITE_URL}/terms`,
  name: `${PAGE_TITLE} - Hushare`,
  description: PAGE_DESCRIPTION,
  inLanguage: 'en',
  isPartOf: { '@id': `${SITE_URL}#website` },
}

const SERIF = { fontFamily: 'var(--font-serif)' } as const
const INK   = { color: '#630826' } as const
const BODY  = { color: '#5C4A3C' } as const
const RULE  = { background: '#E8E0D0' } as const

function Section({
  number,
  heading,
  children,
}: {
  number: number
  heading: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-10">
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

export default function TermsPage() {
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
          Terms of Service
        </h1>
        <p className="mt-4 text-sm" style={{ color: '#8B6F4E' }}>
          Last updated: <time dateTime={LAST_UPDATED}>{LAST_UPDATED_HUMAN}</time>
        </p>

        <div className="mt-6 h-px" style={RULE} />

        <p className="mt-8 text-lg leading-relaxed" style={BODY}>
          By using Hushare (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;the
          service&rdquo;), you agree to these terms. If you do not agree,
          please do not use Hushare. These terms are written in plain English
          on purpose - we want you to actually understand them.
        </p>

        <Section number={1} heading="What Hushare is">
          <p>
            Hushare is a shared photo and video album platform. You create an
            album, share the link, and anyone with that link can view and add
            photos and videos. Hushare is not a social network, a cloud backup
            service, or a content distribution platform.
          </p>
        </Section>

        <Section number={2} heading="What you can upload">
          <p>You may upload photos and videos that you have the right to share. You may <strong style={INK}>not</strong> upload:</p>
          <ul className="list-disc pl-5 space-y-2 mt-3">
            <li>Content that is illegal in your jurisdiction or ours.</li>
            <li>Child sexual abuse material (CSAM) - any such content will be reported to the relevant authorities immediately and without exception.</li>
            <li>Non-consensual intimate imagery (&ldquo;revenge porn&rdquo;).</li>
            <li>Content that infringes on a third party&apos;s intellectual property rights.</li>
            <li>Spam, malware, or content intended to deceive or defraud.</li>
            <li>Anything you do not have the right to share (e.g. photos taken by someone else without their permission).</li>
          </ul>
        </Section>

        <Section number={3} heading="Ownership of content">
          <p>
            You keep ownership of everything you upload. By uploading to
            Hushare, you grant us a limited, non-exclusive, worldwide licence
            to host, store, and display your content solely to provide the
            service. We do not use your photos or videos for advertising,
            training AI models, or any purpose beyond running Hushare.
          </p>
        </Section>

        <Section number={4} heading="Our rights to remove content">
          <p>
            We reserve the right to remove any content and/or terminate access
            to any album that violates these terms, without notice. We are not
            obligated to review all content proactively, but we will act
            promptly on valid reports and legal notices.
          </p>
        </Section>

        <Section number={5} heading="DMCA and intellectual property">
          <p>
            To submit a DMCA takedown notice, email{' '}
            <a
              href="mailto:husharesupport@gmail.com"
              style={{ color: '#630826', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
            >
              husharesupport@gmail.com
            </a>{' '}
            with: your contact information, a description of the copyrighted
            work, a link to the infringing content, a statement of good faith
            belief, and a statement that the information is accurate under
            penalty of perjury. Our designated DMCA agent registration number
            is DMCA-1072882. Counter-notices may be submitted to the same
            address.
          </p>
        </Section>

        <Section number={6} heading="Limitation of liability">
          <p>
            Hushare is provided &ldquo;as is&rdquo; and &ldquo;as
            available&rdquo;. To the maximum extent permitted by law, we
            disclaim all warranties, express or implied. We are not liable for
            any indirect, incidental, special, consequential, or punitive
            damages arising from your use of - or inability to use - the
            service, including but not limited to loss of data. Our total
            liability to you for any direct damages is limited to the amount
            you paid us in the past twelve months, or $10, whichever is
            greater.
          </p>
        </Section>

        <Section number={7} heading="Changes and termination">
          <p>
            We may update these terms at any time. The &ldquo;Last
            updated&rdquo; date at the top of this page will reflect any
            changes. Continued use of Hushare after an update constitutes
            acceptance of the new terms. We may terminate or suspend access
            for users who violate these terms. You may stop using the service
            at any time; if you want your data deleted, see our{' '}
            <Link href="/privacy" style={{ color: '#630826', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
              Privacy Policy
            </Link>
            .
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
