import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { Check, ArrowRight } from 'lucide-react'
import AccountNavLink from '@/components/AccountNavLink'
import HamburgerMenu from '@/components/HamburgerMenu'
import CheckoutResumer from '@/components/CheckoutResumer'
import FaqList from '@/components/FaqList'

export const runtime = 'nodejs'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'

const PAGE_TITLE = 'Pricing'
const PAGE_DESCRIPTION =
  'Hushare pricing - a generous free tier, plus Pro and Max plans for password-protected albums, custom URLs, HD video, and no inactivity expiry.'

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/pricing' },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/pricing`,
    title: `${PAGE_TITLE} - Hushare`,
    description: PAGE_DESCRIPTION,
    siteName: 'Hushare',
    locale: 'en_US',
    images: [{ url: '/wedding.jpg', width: 700, height: 1052, alt: 'Hushare pricing plans' }],
  },
  twitter: {
    card: 'summary_large_image',
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

type Tier = {
  name: string
  tagline: string
  price: string
  cadence: string
  annual?: string
  promo?: string
  renewText?: string
  cta: string
  href?: string
  monthlyProductId?: string
  yearlyProductId?: string
  highlight: boolean
  features: string[]
}

const proMonthlyId    = process.env.POLAR_PRODUCT_PRO_MONTHLY    ?? ''
const proYearlyId     = process.env.POLAR_PRODUCT_PRO_YEARLY     ?? ''
const maxMonthlyId    = process.env.POLAR_PRODUCT_STUDIO_MONTHLY ?? ''
const maxYearlyId     = process.env.POLAR_PRODUCT_STUDIO_YEARLY  ?? ''

const tiers: Tier[] = [
  {
    name: 'Free',
    tagline: 'For one-off events and trips',
    price: '$0',
    cadence: 'forever',
    cta: 'Create your album',
    href: '/',
    highlight: false,
    features: [
      'Unlimited photos per album',
      'Anyone can view & add via the link',
      'Download full album as ZIP',
      'Photos up to 25 MB · videos up to 50 MB',
      'Album auto-retires after 3 months of inactivity',
    ],
  },
  {
    name: 'Pro',
    tagline: 'For people who keep coming back',
    price: '$4',
    cadence: 'per month',
    annual: '$40 / year - save 2 months',
    promo: 'First month $1.99',
    renewText: 'Intro offer: $1.99 first month, then $4/month. Auto-renews until cancelled.',
    cta: 'Get Pro',
    monthlyProductId: proMonthlyId,
    yearlyProductId: proYearlyId,
    highlight: true,
    features: [
      'Everything in Free, plus -',
      'Password-protect your albums',
      'Custom album URLs (e.g. hushare.space/anna-and-david)',
      'No inactivity expiry - albums live as long as you subscribe',
      'HD video - large uploads up to 1 GB (Free: 50 MB)',
      'Larger photos - up to 200 MB per upload',
      'Account dashboard to manage your subscription',
    ],
  },
  {
    name: 'Max',
    tagline: 'For photographers & event planners',
    price: '$10',
    cadence: 'per month',
    annual: '$100 / year - save 2 months',
    promo: 'First month $6.99',
    renewText: 'Intro offer: $6.99 first month, then $10/month. Auto-renews until cancelled.',
    cta: 'Get Max',
    monthlyProductId: maxMonthlyId,
    yearlyProductId: maxYearlyId,
    highlight: false,
    features: [
      'Everything in Pro, plus -',
      'Face finder — guests find their own photos by selfie',
      'Manage many albums from one dashboard',
      'Custom branding (logo, colours, cover image)',
      'Client-ready download links',
      'Priority support - replies within 24 hrs',
      'Account dashboard to manage your subscription',
    ],
  },
]

const billingFaq = [
  {
    q: 'Do I need a Hushare account for Pro or Max?',
    a: 'Yes - paid plans need a free Hushare account so we can attach your subscription to a stable identity (and so you can manage or cancel it anytime). Sign in with your email at the top of any page; no password needed, just a magic link. Your account is free forever; only Pro and Max cost money.',
  },
  {
    q: 'Why does Free not need an account?',
    a: 'Free albums are designed for the moment - share a link, everyone adds photos, done. We do not want sign-up to be a barrier for one-off events. Pro and Max need an account because subscriptions need to belong to someone.',
  },
  {
    q: 'What happens to my free albums if I cancel Pro or Max?',
    a: 'Nothing changes for guests. Your albums are kept for a full year after you cancel, then revert to Free behaviour - the password and custom URL are removed, the album becomes accessible by its original random link, and the 3-month inactivity rule applies from then.',
  },
  {
    q: 'What do Max Collections do?',
    a: 'Collections are Max-only pages that group several albums under one public /c/... link. They are built for photographers, planners, and families who need to present or manage related albums together instead of sending many separate links.',
  },
  {
    q: 'Can I recover a lost owner link?',
    a: 'Contact support with the album name, approximate creation date, and any details that help us verify ownership. Owner links control album management, so recovery is handled carefully instead of automatically exposing private tokens.',
  },
  {
    q: 'Can I try Pro before I pay?',
    a: 'There is no separate no-card trial right now. Monthly plans have a first-month intro price, then renew at the standard rate from month two. You can cancel anytime from your account.',
  },
  {
    q: 'How do you handle refunds?',
    a: "Refunds are handled by support, not automatically in the app. Email husharesupport@gmail.com with your account email and we'll review it manually within two business days.",
  },
  {
    q: 'Do you offer annual pricing?',
    a: 'Yes - Pro is $40/year and Max is $100/year, both with two months free compared to paying month-by-month. Choose annual at checkout. Want to lock it in before launch? Email us and we\'ll honour the annual price for your first year.',
  },
  {
    q: 'Is there a first-month discount?',
    a: 'Yes - Pro is $1.99 for the first month, then $4/month after. Max is $6.99 for the first month, then $10/month. The discount applies once per account, on monthly plans, and renews at the standard rate from month two.',
  },
  {
    q: 'Which currencies do you accept?',
    a: 'USD for now. We may add local currency pricing later if demand is strong enough, but the current checkout is USD.',
  },
  {
    q: 'Is there a discount for non-profits or weddings?',
    a: 'Registered non-profits can contact support for a manual Max discount. For one-off weddings, a single month of Pro usually covers it; we do not currently offer a wedding-specific discount.',
  },
]

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'Pricing', item: `${SITE_URL}/pricing` },
      ],
    },
    {
      '@type': 'WebPage',
      '@id': `${SITE_URL}/pricing#webpage`,
      url: `${SITE_URL}/pricing`,
      name: `${PAGE_TITLE} - Hushare`,
      description: PAGE_DESCRIPTION,
      inLanguage: 'en',
      isPartOf: { '@id': `${SITE_URL}#website` },
    },
    {
      '@type': 'Product',
      name: 'Hushare',
      description: PAGE_DESCRIPTION,
      brand: { '@type': 'Brand', name: 'Hushare' },
      offers: [
        {
          '@type': 'Offer',
          name: 'Hushare Free',
          price: '0',
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
          url: `${SITE_URL}/pricing#free`,
        },
        {
          '@type': 'Offer',
          name: 'Hushare Pro (monthly)',
          price: '4',
          priceCurrency: 'USD',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: '4',
            priceCurrency: 'USD',
            referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'MON' },
          },
          availability: 'https://schema.org/InStock',
          url: `${SITE_URL}/pricing#pro`,
        },
        {
          '@type': 'Offer',
          name: 'Hushare Pro (annual)',
          price: '40',
          priceCurrency: 'USD',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: '40',
            priceCurrency: 'USD',
            referenceQuantity: { '@type': 'QuantitativeValue', value: 12, unitCode: 'MON' },
          },
          availability: 'https://schema.org/InStock',
          url: `${SITE_URL}/pricing#pro`,
        },
        {
          '@type': 'Offer',
          name: 'Hushare Max (monthly)',
          price: '10',
          priceCurrency: 'USD',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: '10',
            priceCurrency: 'USD',
            referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'MON' },
          },
          availability: 'https://schema.org/InStock',
          url: `${SITE_URL}/pricing#max`,
        },
        {
          '@type': 'Offer',
          name: 'Hushare Max (annual)',
          price: '100',
          priceCurrency: 'USD',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: '100',
            priceCurrency: 'USD',
            referenceQuantity: { '@type': 'QuantitativeValue', value: 12, unitCode: 'MON' },
          },
          availability: 'https://schema.org/InStock',
          url: `${SITE_URL}/pricing#max`,
        },
      ],
    },
    {
      '@type': 'FAQPage',
      '@id': `${SITE_URL}/pricing#faq`,
      mainEntity: billingFaq.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
  ],
}

const SERIF = { fontFamily: 'var(--font-serif)' } as const
const INK   = { color: '#630826' } as const

export default function PricingPage() {
  return (
    <main
      className="min-h-screen"
      style={{ background: '#FDFAF5', fontFamily: 'var(--font-sans)' }}
    >
      <CheckoutResumer />

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
          <span className="text-sm font-semibold underline underline-offset-4" style={{ color: '#630826' }}>Pricing</span>
          <Link href="/about" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>About</Link>
          <Link href="/collabs" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>Collabs</Link>
          <Link href="/support" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>Support</Link>
          <AccountNavLink />
        </HamburgerMenu>
      </nav>

      {/* Hero */}
      <section className="hush-readable hush-fade-up pt-12 sm:pt-20 pb-10 text-center">
        <p
          className="text-xs sm:text-sm font-medium uppercase mb-4"
          style={{ color: '#8B6F4E', letterSpacing: '0.18em' }}
        >
          Pricing
        </p>
        <h1
          style={{
            ...SERIF,
            ...INK,
            fontSize: 'clamp(2.2rem, 6vw, 4.4rem)',
            lineHeight: 1.1,
            fontWeight: 700,
          }}
        >
          Free for the moments<br />
          <em style={{ color: '#7C4A2D' }}>worth keeping forever</em>
        </h1>
        <p
          className="mt-5 text-base sm:text-lg leading-relaxed mx-auto"
          style={{ color: '#6B5A4E', maxWidth: '560px' }}
        >
          A generous free tier for one-off events. Two paid tiers for people who
          want passwords, custom URLs, HD video, and albums that never expire.
        </p>
      </section>

      {/* Tiers */}
      <section className="hush-container pb-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-5 xl:gap-7 items-stretch">
          {tiers.map((t) => (
            <article
              key={t.name}
              id={t.name.toLowerCase()}
              className="hush-hover-lift relative rounded-3xl flex flex-col"
              style={{
                background: t.highlight ? '#630826' : '#FFFFFF',
                color: t.highlight ? '#FDFAF5' : '#630826',
                border: t.highlight ? '1px solid #630826' : '1px solid #DDD5C5',
                boxShadow: t.highlight
                  ? '0 18px 48px rgba(99,8,38,0.30)'
                  : '0 4px 24px rgba(99,8,38,0.08)',
                padding: '2rem 1.75rem',
              }}
            >
              {t.highlight && (
                <span
                  className="absolute -top-3 left-1/2 text-[10px] font-semibold tracking-[0.18em] uppercase px-3 py-1 rounded-full"
                  style={{
                    transform: 'translateX(-50%)',
                    background: '#F3E0BC',
                    color: '#7C4A2D',
                    border: '1px solid #C4A678',
                  }}
                >
                  Most loved
                </span>
              )}

              <h2 style={{ ...SERIF, fontSize: '1.6rem', fontWeight: 700, lineHeight: 1.1 }}>
                {t.name}
              </h2>
              <p
                className="text-sm mt-1 mb-5"
                style={{ color: t.highlight ? 'rgba(253,250,245,0.75)' : '#8B6F4E' }}
              >
                {t.tagline}
              </p>

              <div className="flex items-baseline gap-2 mb-1">
                <span style={{ ...SERIF, fontSize: '2.6rem', fontWeight: 700, lineHeight: 1 }}>
                  {t.price}
                </span>
                <span className="text-sm" style={{ color: t.highlight ? 'rgba(253,250,245,0.75)' : '#8B6F4E' }}>
                  {t.cadence}
                </span>
              </div>

              {t.annual && (t.yearlyProductId ? (
                <form action="/api/checkout" method="POST" className="mt-1">
                  <input type="hidden" name="productId" value={t.yearlyProductId} />
                  <button
                    type="submit"
                    className="text-xs hover:underline cursor-pointer text-left"
                    style={{
                      color: t.highlight ? 'rgba(253,250,245,0.85)' : '#8B6F4E',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                    }}
                  >
                    or <span style={{ fontWeight: 600 }}>{t.annual}</span>
                  </button>
                </form>
              ) : (
                <p className="text-xs mt-1" style={{ color: t.highlight ? 'rgba(253,250,245,0.75)' : '#8B6F4E' }}>
                  or <span style={{ fontWeight: 600 }}>{t.annual}</span>
                </p>
              ))}

              {t.promo && (
                <p
                  className="inline-block text-[11px] font-semibold tracking-wide uppercase mt-3 px-2.5 py-1 rounded-full"
                  style={{
                    background: t.highlight ? '#F3E0BC' : '#F6E9EE',
                    color: t.highlight ? '#7C4A2D' : '#630826',
                    border: t.highlight ? '1px solid #C4A678' : '1px solid rgba(99,8,38,0.18)',
                  }}
                >
                  {t.promo}
                </p>
              )}

              <div
                className="my-6 h-px w-full"
                style={{ background: t.highlight ? 'rgba(253,250,245,0.18)' : '#E8E0D0' }}
              />

              <ul className="flex-1 space-y-3 mb-8">
                {t.features.map((f, i) => {
                  const isHeader = f.endsWith(' -')
                  return (
                    <li
                      key={i}
                      className="flex items-start gap-3 text-[0.95rem] leading-snug"
                      style={{
                        color: t.highlight
                          ? isHeader ? 'rgba(253,250,245,0.7)' : '#FDFAF5'
                          : isHeader ? '#8B6F4E' : '#5C4A3C',
                        fontWeight: isHeader ? 600 : 400,
                      }}
                    >
                      {!isHeader && (
                        <Check
                          className="w-4 h-4 flex-none mt-0.5"
                          style={{ color: t.highlight ? '#F3E0BC' : '#630826' }}
                        />
                      )}
                      <span>{f}</span>
                    </li>
                  )
                })}
              </ul>

              {t.monthlyProductId ? (
                <form action="/api/checkout" method="POST" className="w-full">
                  <input type="hidden" name="productId" value={t.monthlyProductId} />
                  <button
                    type="submit"
                    className="w-full inline-flex items-center justify-center gap-2 font-semibold rounded-xl py-3 transition hover:opacity-90 cursor-pointer"
                    style={{
                      background: t.highlight ? '#FDFAF5' : '#630826',
                      color: t.highlight ? '#630826' : '#FDFAF5',
                      border: 'none',
                    }}
                  >
                    {t.cta} <ArrowRight className="w-4 h-4" />
                  </button>
                  {t.renewText && (
                    <p className="mt-2 text-[11px] text-center leading-snug" style={{ color: t.highlight ? 'rgba(253,250,245,0.60)' : '#A89880' }}>
                      {t.renewText}
                    </p>
                  )}
                </form>
              ) : (
                <Link
                  href={t.href ?? '/'}
                  className="w-full inline-flex items-center justify-center gap-2 font-semibold rounded-xl py-3 transition hover:opacity-90"
                  style={{
                    background: t.highlight ? '#FDFAF5' : '#630826',
                    color: t.highlight ? '#630826' : '#FDFAF5',
                  }}
                >
                  {t.cta} <ArrowRight className="w-4 h-4" />
                </Link>
              )}
            </article>
          ))}
        </div>

        <p
          className="text-center text-xs mt-6 italic"
          style={{ color: '#8B6F4E', fontFamily: 'var(--font-serif)' }}
        >
          Prices in USD &middot; Subscriptions auto-renew monthly or annually until cancelled &middot; Cancel anytime from your account dashboard &middot; No refunds except as required by law.
        </p>
      </section>

      {/* Why pay section */}
      <section className="hush-readable pb-20">
        <div
          className="hush-reveal rounded-2xl px-6 py-8 sm:px-10 sm:py-10"
          style={{ background: '#FBF4E4', border: '1px solid rgba(196,166,120,0.35)' }}
        >
          <p
            className="text-xs uppercase mb-3"
            style={{ color: '#8B6F4E', letterSpacing: '0.18em', fontWeight: 600 }}
          >
            Why we charge
          </p>
          <h2
            className="mb-4"
            style={{ ...SERIF, ...INK, fontSize: '1.6rem', fontWeight: 700, lineHeight: 1.2 }}
          >
            Free for the world. Paid for the keepers.
          </h2>
          <p className="text-[0.98rem] leading-relaxed" style={{ color: '#5C4A3C' }}>
            A wedding, a birthday, a one-week trip - these belong on the free tier
            forever. But a wedding photographer running ten albums a month, or a
            family that wants a single album to live for twenty years with a name
            you can actually remember - that costs us in storage and bandwidth, and
            it costs you a little to keep it. No ads. No selling your photos.
            Just a small subscription that pays for the servers and our coffee.
          </p>
        </div>
      </section>

      {/* Billing FAQ */}
      <section className="hush-readable pb-24">
        <div className="flex items-center gap-6 mb-8">
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
          <p
            style={{
              ...INK,
              ...SERIF,
              fontSize: '1.4rem',
              fontWeight: 700,
              letterSpacing: '0.22em',
              whiteSpace: 'nowrap',
              lineHeight: 1,
            }}
          >
            BILLING FAQ
          </p>
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
        </div>

        <div
          className="hush-reveal rounded-[8px] px-6 py-2 sm:px-10 sm:py-4"
          style={{
            background: '#FBF4E4',
            border: '1px solid rgba(196,166,120,0.35)',
            boxShadow: '0 10px 36px rgba(99,8,38,0.08)',
          }}
        >
          <FaqList items={billingFaq} compactCount={6} plusSize={26} />
        </div>

        <p
          className="text-center text-sm mt-8 italic"
          style={{ color: '#8B6F4E', fontFamily: 'var(--font-serif)' }}
        >
          Other questions? Write to{' '}
          <a href="mailto:husharesupport@gmail.com" style={{ color: '#630826', fontWeight: 600 }}>
            husharesupport@gmail.com
          </a>
        </p>
      </section>
    </main>
  )
}
