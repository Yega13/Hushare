import EngagementBeacon from '@/components/EngagementBeacon'
import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { Check, ArrowRight } from 'lucide-react'
import AccountNavLink from '@/components/AccountNavLink'
import HamburgerMenu from '@/components/HamburgerMenu'
import CheckoutResumer from '@/components/CheckoutResumer'
import FaqList from '@/components/FaqList'
import { getServerLocale } from '@/i18n/server'
import { getDictionary, interpolate } from '@/i18n/get-dictionary'
import { en } from '@/i18n/dictionaries/en'
import {
  albumMediaCapForTier, albumCountLimitForTier, uploadCapsForTier, formatCapSize,
  ANON_ALBUM_MEDIA, ANON_ALBUM_LIMIT,
} from '@/lib/media'
import type { DictKey } from '@/i18n/dictionaries/en'
import type { PlanKey } from '@/lib/polar'
import { PLAN_CATALOGUE, formatPrice, monthsSaved } from '@/lib/plan-catalogue'

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
  // What the big number and the line under it become when the Yearly side of the switch is on.
  // Derived from PLAN_CATALOGUE (lib/plan-catalogue.ts), which is the same table the Polar
  // health check verifies against Polar — so the switch cannot advertise a price Polar will
  // not charge, which is exactly how "$100 / year" ended up sold as $100 a month.
  yearlyPrice?: string
  yearlyCadence?: string
  yearlyRenewText?: string
  promo?: string
  renewText?: string
  cta: string
  href?: string
  // Stable plan keys (never a raw Polar product ID — see lib/polar.ts productIdForPlan). The
  // checkout route resolves the actual product ID from env at request time, so this page never
  // needs to read POLAR_PRODUCT_* itself and its 24h-cached HTML can never go stale on a secret
  // change or product rotation.
  monthlyPlan?: PlanKey
  yearlyPlan?: PlanKey
  highlight: boolean
  // NOTE: these strings are never rendered. Line ~306 maps over this array purely for its LENGTH
  // and pulls the real text from the dictionary (`pricing.<tier>.f<n>`). They are kept in step with
  // the dictionary anyway because a developer reading this file will otherwise believe them — the
  // free-tier number sat 4x below what the code actually grants and was wrong here first.
  // Changing the LENGTH of any of these arrays changes how many dictionary keys are read.
  features: string[]
}

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
      'Up to 1,000 photos & videos per album (250 as a guest)',
      'Anyone can view & add via the link',
      'Download full album as ZIP',
      'Photos up to 25 MB · videos up to 200 MB',
      'Album auto-retires after 1 year of inactivity',
      'Create up to 3 albums (2 as a guest)',
      'Password-protect your albums',
    ],
  },
  {
    name: 'Pro',
    tagline: 'For people who keep coming back',
    price: '$4',
    cadence: 'per month',
    annual: '$40 / year - save 2 months',
    yearlyPrice: formatPrice(PLAN_CATALOGUE.pro_yearly.amountCents),
    yearlyCadence: 'per year',
    yearlyRenewText: 'Billed once a year. Auto-renews until cancelled.',
    promo: 'First month $1.99',
    renewText: 'Intro offer: $1.99 first month, then $4/month. Auto-renews until cancelled.',
    cta: 'Get Pro',
    monthlyPlan: 'pro_monthly',
    yearlyPlan: 'pro_yearly',
    highlight: true,
    features: [
      'Everything in Free, plus -',
      'Remove Hushare branding from your albums',
      'Your own logo on the album',
      'Countdown reveal and photo moderation',
      'Custom album URLs (e.g. hushare.space/anna-and-david)',
      'No inactivity expiry - albums live as long as you subscribe',
      'HD video - large uploads up to 1 GB (Free: 50 MB)',
      'Larger photos - up to 200 MB per upload',
      'Account dashboard to manage your subscription',
      'Up to 3,000 photos & videos per album',
      'Create up to 15 albums',
    ],
  },
  {
    name: 'Max',
    tagline: 'For photographers & event planners',
    price: '$10',
    cadence: 'per month',
    annual: '$100 / year - save 2 months',
    yearlyPrice: formatPrice(PLAN_CATALOGUE.studio_yearly.amountCents),
    yearlyCadence: 'per year',
    yearlyRenewText: 'Billed once a year. Auto-renews until cancelled.',
    promo: 'First month $6.99',
    renewText: 'Intro offer: $6.99 first month, then $10/month. Auto-renews until cancelled.',
    cta: 'Get Max',
    monthlyPlan: 'studio_monthly',
    yearlyPlan: 'studio_yearly',
    highlight: false,
    features: [
      'Everything in Pro, plus -',
      'Face finder — guests find their own photos by selfie',
      'Manage many albums from one dashboard',
      'Sponsor logos and bib-number search for events',
      'Live photo wall for the big screen',
      'Priority support - replies within 24 hrs',
      'Account dashboard to manage your subscription',
      'Up to 10,000 photos & videos per album',
      'Create up to 50 albums',
    ],
  },
]

// ONE SOURCE FOR BOTH COPIES OF THIS FAQ.
//
// This used to be a hand-typed duplicate of the strings the page actually renders, kept here only
// because the JSON-LD is built at module scope where `dict` does not exist. The two drifted, and
// the copy that drifted is the one nobody looks at: the cancellation answer was corrected in the
// dictionary and this block went on serving the old, wrong wording to search engines. Reading the
// English dictionary directly costs nothing and removes the second place to forget.
//
// English on purpose — structured data is emitted once, for the canonical page.
const PRICING_FAQ_COUNT = Object.keys(en).filter((k) => /^pricing\.faq\.q\d+$/.test(k)).length

const billingFaq = Array.from({ length: PRICING_FAQ_COUNT }, (_, i) => ({
  q: en[`pricing.faq.q${i + 1}` as keyof typeof en] as string,
  a: en[`pricing.faq.a${i + 1}` as keyof typeof en] as string,
}))

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

export default async function PricingPage() {
  const dict = getDictionary(await getServerLocale())
  // Every number in the copy comes from the constants the API routes check against, so a limit
  // cannot be changed in code and left stale on the page that sells it.
  const planNumbers = {
    freeItems: albumMediaCapForTier('free').toLocaleString('en-US'),
    proItems: albumMediaCapForTier('pro').toLocaleString('en-US'),
    maxItems: albumMediaCapForTier('studio').toLocaleString('en-US'),
    anonItems: String(ANON_ALBUM_MEDIA),
    freeAlbums: String(albumCountLimitForTier('free')),
    proAlbums: String(albumCountLimitForTier('pro')),
    maxAlbums: String(albumCountLimitForTier('studio')),
    anonAlbums: String(ANON_ALBUM_LIMIT),
    freePhoto: formatCapSize(uploadCapsForTier('free').image),
    freeVideo: formatCapSize(uploadCapsForTier('free').video),
    proPhoto: formatCapSize(uploadCapsForTier('pro').image),
    proVideo: formatCapSize(uploadCapsForTier('pro').video),
    maxVideo: formatCapSize(uploadCapsForTier('studio').video),
    // Bare numbers as well as formatted ones. Russian and Armenian write the unit themselves
    // ("МБ", "ՄԲ"), so those sentences need the figure without an English "MB" welded to it.
    freePhoto_n: String(Math.round(uploadCapsForTier('free').image / (1024 * 1024))),
    freeVideo_n: String(Math.round(uploadCapsForTier('free').video / (1024 * 1024))),
    proPhoto_n: String(Math.round(uploadCapsForTier('pro').image / (1024 * 1024))),
    proVideo_n: String(Math.round(uploadCapsForTier('pro').video / (1024 * 1024 * 1024))),
    maxVideo_n: String(Math.round(uploadCapsForTier('studio').video / (1024 * 1024 * 1024))),
  }
  const tt = (k: string) => interpolate(dict[k as DictKey] ?? k, planNumbers)
  const localizedTiers = tiers.map((tier) => {
    const key = tier.name.toLowerCase()
    return {
      ...tier,
      tagline: tt(`pricing.${key}.tagline`),
      cadence: key === 'free' ? tt('pricing.cadenceForever') : tt('pricing.cadenceMonth'),
      cta: tt(`pricing.${key}.cta`),
      annual: tier.annual ? tt(`pricing.${key}.annual`) : tier.annual,
      yearlyCadence: tier.yearlyCadence ? tt('pricing.cadenceYear') : tier.yearlyCadence,
      yearlyRenewText: tier.yearlyRenewText ? tt(`pricing.${key}.yearlyRenew`) : tier.yearlyRenewText,
      promo: tier.promo ? tt(`pricing.${key}.promo`) : tier.promo,
      renewText: tier.renewText ? tt(`pricing.${key}.renew`) : tier.renewText,
      features: tier.features.map((_, i) => tt(`pricing.${key}.f${i + 1}`)),
    }
  })
  const pricingFaq = Array.from({ length: PRICING_FAQ_COUNT }, (_, i) => ({
    q: tt(`pricing.faq.q${i + 1}`),
    a: tt(`pricing.faq.a${i + 1}`),
  }))
  return (
    <main
      className="min-h-screen"
      style={{ background: '#FDFAF5', fontFamily: 'var(--font-sans)' }}
    >
      <EngagementBeacon page="pricing" />
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
          <span className="text-sm font-semibold" style={{ color: '#630826' }}>{dict['nav.pricing']}</span>
          <Link href="/about" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>{dict['nav.about']}</Link>
          <Link href="/collabs" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>{dict['nav.collabs']}</Link>
          <Link href="/support" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>{dict['nav.support']}</Link>
          <AccountNavLink />
        </HamburgerMenu>
      </nav>

      {/* Hero */}
      <section className="hush-readable hush-fade-up pt-12 sm:pt-20 pb-10 text-center">
        <p
          className="text-xs sm:text-sm font-medium uppercase mb-4"
          style={{ color: '#8B6F4E', letterSpacing: '0.18em' }}
        >
          {dict['pricing.eyebrow']}
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
          {dict['pricing.title1']}<br />
          <em style={{ color: '#7C4A2D' }}>{dict['pricing.title2']}</em>
        </h1>
        <p
          className="mt-5 text-base sm:text-lg leading-relaxed mx-auto"
          style={{ color: '#6B5A4E', maxWidth: '560px' }}
        >
          {dict['pricing.subtitle']}
        </p>
      </section>

      {/* Tiers */}
      <section className="hush-container pb-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-5 xl:gap-7 items-stretch">
          {localizedTiers.map((t) => (
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
                  {dict['pricing.mostLoved']}
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

              {/* ONE SWITCH PER CARD, each its own radio group.
                  A single switch above the grid forced one decision onto every plan at once —
                  but somebody comparing Pro monthly against Max yearly could not see both, and
                  the control that changed the card they were reading was somewhere else on the
                  page. Each card now answers for itself.
                  The radios sit here, directly before the price and the checkout buttons, because
                  the CSS reaches them as SIBLINGS. Move either into a wrapper and the switch
                  silently stops working — nothing throws, the button just never changes. */}
              {t.yearlyPlan && (
                <>
                  <input
                    type="radio" value="monthly" defaultChecked
                    id={`cyc-${t.name.toLowerCase()}-m`} name={`cyc-${t.name.toLowerCase()}`}
                    className="hush-cycle-radio" aria-label={`${t.name} ${dict['pricing.cycleMonthly']}`}
                  />
                  <input
                    type="radio" value="yearly"
                    id={`cyc-${t.name.toLowerCase()}-y`} name={`cyc-${t.name.toLowerCase()}`}
                    className="hush-cycle-radio" aria-label={`${t.name} ${dict['pricing.cycleYearly']}`}
                  />
                </>
              )}

              {/* Both prices ship in the HTML; CSS shows one. A plan with no yearly option (Free)
                  carries no cycle class at all, so the switch simply does not touch it. */}
              <div className={`flex items-baseline gap-2 mb-1${t.yearlyPrice ? ' hush-monthly-only' : ''}`}>
                <span style={{ ...SERIF, fontSize: '2.6rem', fontWeight: 700, lineHeight: 1 }}>
                  {t.price}
                </span>
                <span className="text-sm" style={{ color: t.highlight ? 'rgba(253,250,245,0.75)' : '#8B6F4E' }}>
                  {t.cadence}
                </span>
              </div>
              {t.yearlyPrice && (
                <div className="flex items-baseline gap-2 mb-1 hush-yearly-only hush-cycle-price">
                  <span style={{ ...SERIF, fontSize: '2.6rem', fontWeight: 700, lineHeight: 1 }}>
                    {t.yearlyPrice}
                  </span>
                  <span className="text-sm" style={{ color: t.highlight ? 'rgba(253,250,245,0.75)' : '#8B6F4E' }}>
                    {t.yearlyCadence}
                  </span>
                </div>
              )}

              {/* The switch sits UNDER the price it changes, so the price stays the loudest thing
                  on the card and the control reads as a modifier of it. The radios above are
                  invisible and stay where they are — the CSS reaches these as SIBLINGS, so
                  wrapping any of it in a div silently stops the switch working. */}
              {t.yearlyPlan && (
                <div className={`hush-cycle${t.highlight ? ' is-dark' : ''}`}>
                  {/* aria-hidden: the labels are the real, announced controls. */}
                  <span className="hush-cycle-thumb" aria-hidden />
                  <label className="hush-cycle-opt hush-cycle-opt-monthly" htmlFor={`cyc-${t.name.toLowerCase()}-m`}>
                    {dict['pricing.cycleMonthly']}
                  </label>
                  <label className="hush-cycle-opt hush-cycle-opt-yearly" htmlFor={`cyc-${t.name.toLowerCase()}-y`}>
                    {dict['pricing.cycleYearly']}
                  </label>
                </div>
              )}

              {t.yearlyPlan && (
                <p className="hush-yearly-only" style={{ margin: '2px 0 0' }}>
                  <span className="hush-cycle-save" style={t.highlight ? { color: '#A8D5B5' } : undefined}>
                    {interpolate(dict['pricing.cycleSave'], {
                      n: String(monthsSaved(
                        PLAN_CATALOGUE[t.monthlyPlan as 'pro_monthly'].amountCents,
                        PLAN_CATALOGUE[t.yearlyPlan as 'pro_yearly'].amountCents,
                      )),
                    })}
                  </span>
                </p>
              )}

              {/* THE YEARLY OPTION HAS TO LOOK LIKE A BUTTON.
                  This was 12px muted text with no border, no background and no padding — pixel
                  for pixel the same as the plain caption rendered in the else-branch below for
                  plans that have no yearly option. It was clickable and nobody could tell: the
                  OWNER could not find how to buy an annual plan on their own pricing page. A
                  yearly sale is two months' more revenue and far less churn, and it was hiding
                  behind a footnote. */}
              {/* The "or $40 / year" line is GONE, not restyled. With a real Monthly/Yearly
                  switch above the cards it was a second route to the same purchase sitting
                  inside the first — and a second place for the yearly price to be written,
                  which is how the price on this page drifted from Polar in the first place.
                  A plan with no yearly option (Free) simply says nothing here. */}
              {t.annual && !t.yearlyPlan && (
                <p className="text-xs mt-1" style={{ color: t.highlight ? 'rgba(253,250,245,0.75)' : '#8B6F4E' }}>
                  or <span style={{ fontWeight: 600 }}>{t.annual}</span>
                </p>
              )}

              {/* A first-MONTH intro price is meaningless beside a yearly plan, and showing it
                  there would advertise a discount the yearly checkout does not apply. */}
              {t.promo && (
                <p
                  className={`inline-block text-[11px] font-semibold tracking-wide uppercase mt-3 px-2.5 py-1 rounded-full${t.yearlyPrice ? ' hush-monthly-only' : ''}`}
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

              {t.monthlyPlan ? (
                <>
                <form action="/api/checkout" method="POST" className={`w-full${t.yearlyPlan ? ' hush-monthly-only' : ''}`}>
                  <input type="hidden" name="plan" value={t.monthlyPlan} />
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
                {/* The yearly button posts the YEARLY plan key. A single form with a swapped
                    hidden value would need JavaScript; two forms need none, and the wrong one
                    is never in the page for CSS to have to guard. */}
                {t.yearlyPlan && (
                  <form action="/api/checkout" method="POST" className="w-full hush-yearly-only">
                    <input type="hidden" name="plan" value={t.yearlyPlan} />
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
                    {t.yearlyRenewText && (
                      <p className="mt-2 text-[11px] text-center leading-snug" style={{ color: t.highlight ? 'rgba(253,250,245,0.60)' : '#A89880' }}>
                        {t.yearlyRenewText}
                      </p>
                    )}
                  </form>
                )}
                </>
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
          {dict['pricing.disclaimer']}
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
            {dict['pricing.whyCharge']}
          </p>
          <h2
            className="mb-4"
            style={{ ...SERIF, ...INK, fontSize: '1.6rem', fontWeight: 700, lineHeight: 1.2 }}
          >
            {dict['pricing.whyTitle']}
          </h2>
          <p className="text-[0.98rem] leading-relaxed" style={{ color: '#5C4A3C' }}>
            {dict['pricing.whyBody']}
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
            {dict['pricing.billingFaqTitle']}
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
          <FaqList items={pricingFaq} compactCount={6} plusSize={26} />
        </div>

        <p
          className="text-center text-sm mt-8 italic"
          style={{ color: '#8B6F4E', fontFamily: 'var(--font-serif)' }}
        >
          {dict['pricing.otherQuestions']}{' '}
          <a href="mailto:husharesupport@gmail.com" style={{ color: '#630826', fontWeight: 600 }}>
            husharesupport@gmail.com
          </a>
        </p>
      </section>
    </main>
  )
}
