import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import AccountNavLink from '@/components/AccountNavLink'
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
            <li>
              <strong style={INK}>Live presence</strong> - while a page is open
              we record which page it is, with a short-lived random session id,
              so we can see how many people are using Hushare right now. It is
              not tied to your identity or your account, and each record is
              deleted shortly after you close the page.
            </li>
          </ul>
          <p className="mt-3">
            Creating and sharing an album needs{' '}
            <strong style={INK}>no account at all</strong> - that path collects
            nothing above. If you choose to sign in (by email link or Google) to
            keep your albums together or to subscribe, we store your email
            address and, where Google supplies it, your name and profile
            picture. We never ask for a phone number, and we run no advertising
            networks and no identity-based profiling. See section 5 for the one
            third-party measurement tool we do use.
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
              <strong style={INK}>Supabase</strong> - the database. It holds
              album records, captions, and account details. It does{' '}
              <strong style={INK}>not</strong> hold your photos or videos.
              Hosted in Sydney, Australia.
            </li>
            <li>
              <strong style={INK}>Cloudflare</strong> - this is where your
              photos and videos actually live: photos in R2 storage, videos in
              Stream. Cloudflare also provides the hosting, the content
              delivery network, DDoS protection, and Turnstile, the check that
              tells a person from a bot on our support and report forms.
              Distributed across Cloudflare&apos;s global network.
            </li>
            <li>
              <strong style={INK}>Amazon Web Services</strong> - image analysis
              (Rekognition, in Ireland) for the optional Face Finder and
              race-number search features. A photo is only ever sent to AWS if
              the album owner has switched one of those features on. Albums
              without them are never sent to AWS at all.
            </li>
            <li>
              <strong style={INK}>Resend</strong> - delivery of account and
              notification emails.
            </li>
            <li>
              <strong style={INK}>Polar</strong> - subscription checkout and
              billing. Card details go to Polar and its payment providers; we
              never receive or store them.
            </li>
            <li>
              <strong style={INK}>Google Analytics</strong> - measures how
              people arrive at Hushare&apos;s public pages. It never receives
              your photos or the contents of an album. See section 5.
            </li>
          </ul>
          <p className="mt-3">
            These providers process data strictly on our behalf under
            contractual data-processing terms.
          </p>
        </Section>

        <Section id="face-search" number={4} heading="Face search and race numbers">
          <p>
            Two optional features read the contents of photos. Both are{' '}
            <strong style={INK}>off by default</strong> and only ever run if the
            album owner deliberately switches them on for that album.
          </p>
          <ul className="list-disc pl-5 space-y-2 mt-3">
            <li>
              <strong style={INK}>Face Finder</strong> lets a guest find photos
              of themselves. When it is enabled, photos in that album are sent
              to Amazon Rekognition, which computes a mathematical
              representation of each face - a{' '}
              <strong style={INK}>biometric identifier</strong> - and stores it
              in a face collection belonging to that album alone. A guest
              searching takes a selfie, which is compared against that
              collection and is <strong style={INK}>not stored</strong>. We
              never receive names, and the stored representation cannot be
              turned back into a photograph.
            </li>
            <li>
              <strong style={INK}>Race number search</strong> reads printed
              numbers (such as a runner&rsquo;s bib) so guests can find their
              photos by number. This detects text, not people, and creates no
              biometric data.
            </li>
          </ul>
          <p className="mt-3">
            The album&rsquo;s face collection is deleted when the album is
            deleted, and switching Face Finder off stops any further photos
            being analysed. If you are an event organiser, you are responsible
            for telling your participants that face search is available on your
            album - and you can simply leave it off.
          </p>
          <p className="mt-3">
            To have face data for a specific person or album removed at any
            time, contact us at the address in the final section and we will
            delete it.
          </p>
        </Section>

        <Section id="cookies" number={5} heading="Cookies and local storage">
          <p>
            Hushare stores a small amount of data in your own browser, and one
            item of it is genuinely sensitive:
          </p>
          <ul className="list-disc pl-5 space-y-2 mt-3">
            <li>
              <strong style={INK}>Your album management links</strong>, kept in
              local storage so you can get back to albums you created without
              an account. These act as passwords: anyone with access to your
              browser can administer those albums. They never leave your device
              except when you open one.
            </li>
            <li>
              <strong style={INK}>Cookies needed to run the service</strong> -
              the one that keeps you signed in, the one that remembers you
              unlocked a password-protected album, the one that identifies you
              as an album&apos;s owner, and one that counts how many albums
              you have created without an account, so the free limit works.
            </li>
            <li>
              <strong style={INK}>A random id</strong> for the page you are
              reading now and for voting on polls, so a vote is counted once.
              It is not linked to you or to any account.
            </li>
          </ul>
          <p className="mt-3">
            We also run <strong style={INK}>Google Analytics</strong> to
            understand how people find Hushare - which sites and campaigns send
            visitors, and roughly where in the world they are. It sets its own
            cookies and assigns a random identifier to your browser. We do not
            use advertising cookies, we do not run ad networks, and we never
            sell or share your data with advertisers.
          </p>
          <p className="mt-3">
            Google Analytics is not used inside albums to profile anyone, and
            it never receives your photos. If you would rather not be counted,
            any browser-level tracking protection or ad blocker will stop it,
            and the rest of Hushare works exactly the same.
          </p>
        </Section>

        <Section id="sharing" number={6} heading="Who can see your album">
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

        <Section id="retention" number={7} heading="How long we keep things">
          <p>
            Free albums are retained for as long as they remain active. If an
            album sits untouched by everyone for <strong style={INK}>1 year</strong>,
            it is automatically retired and its media is permanently deleted.
            We email a warning first, so you can download everything before that
            happens. Paid plans are not subject to the inactivity rule: those
            albums are kept while the subscription is active and for a further
            year after it ends. You may request deletion of your album at any
            time by emailing us - see section 12.
          </p>
        </Section>

        <Section id="rights" number={8} heading="Your rights">
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

        <Section id="children" number={9} heading="Children">
          <p>
            Hushare is not aimed at children under 13 (or the equivalent
            minimum age where you live) as{' '}
            <strong style={INK}>account holders</strong>. That is a legal line,
            not a judgement about the service: collecting personal data from a
            younger child requires verifiable parental consent, and we are not
            set up to obtain it, so we do not knowingly create accounts for
            them. If you believe a child has created an account or an album,
            contact us and we will remove it.
          </p>
          <p className="mt-3">
            A child <em>looking at</em> a family album, or appearing in one, is
            an ordinary use of Hushare and always has been. Opening a shared
            link needs no account and collects essentially nothing.
          </p>
          <p className="mt-3">
            Photos <em>of</em> children are a different question, and a far more
            common one - a school trip, a family wedding, a race with a junior
            category. Hushare has no way to know who is in a photograph, so this
            sits with whoever runs the album: they choose who is photographed,
            who receives the link, and which features are switched on. If you
            are running an album where children will appear, that is yours to
            get right, including any consent a parent or guardian must give
            under your local law.
          </p>
          <p className="mt-3">
            We ask one thing specifically:{' '}
            <strong style={INK}>
              do not switch on face search for an album that is mainly of
              children
            </strong>
            . It is biometric processing, it is off unless someone deliberately
            enables it, and doing so for minors needs a better reason than
            convenience.
          </p>
          <p className="mt-3">
            A parent or guardian can ask us to take down a photograph of their
            child at any time, whether or not they hold the album link, by
            emailing{' '}
            <a
              href="mailto:husharesupport@gmail.com"
              style={{ color: '#630826', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
            >
              husharesupport@gmail.com
            </a>{' '}
            with enough detail to identify it. We will remove the photograph and
            any face data derived from it. We will not ask them to prove they
            own the album first.
          </p>
        </Section>

        <Section id="transfers" number={10} heading="International data transfers">
          <p>
            Hushare is built in Armenia and runs on infrastructure in several
            countries, so your data is processed outside the country you live
            in. Specifically:
          </p>
          <ul className="list-disc pl-5 space-y-2 mt-3">
            <li>Photos and videos: Cloudflare&apos;s global network, served from
              wherever is nearest to the viewer.</li>
            <li>The database (album records, captions, accounts):{' '}
              <strong style={INK}>Sydney, Australia</strong>.</li>
            <li>Face and race-number analysis, when an owner turns it on:{' '}
              <strong style={INK}>Ireland</strong>.</li>
          </ul>
          <p className="mt-3">
            Where such transfers require a legal basis, we rely on standard
            contractual clauses or equivalent safeguards with each provider.
          </p>
        </Section>

        <Section id="security" number={11} heading="Security">
          <p>
            Your photos are encrypted on the way to us and while they sit on
            our providers&apos; servers. An album can only be opened by someone
            who has its link; if you set a password, that password is needed
            both to see the album and to add to it; and only the management
            link can change anything. We never store your album password
            itself - only a scrambled version of it that cannot be turned back
            into the password. No system is perfectly secure, so share your
            management link only with people you trust.
          </p>
        </Section>

        <Section id="changes" number={12} heading="Changes to this policy">
          <p>
            We will post updates here. The &ldquo;Last updated&rdquo; date at
            the top reflects the most recent change. Material changes will be
            surfaced inside the product before they take effect.
          </p>
        </Section>

        <Section id="contact" number={13} heading="Contact">
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
