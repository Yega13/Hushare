import type { Metadata } from 'next'
import SeoLandingPage from '@/components/SeoLandingPage'

export const runtime = 'nodejs'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'
const PAGE_TITLE = 'Wedding Photo Sharing'
const PAGE_DESCRIPTION =
  'The easiest wedding photo sharing app - no download required. Print a QR code, guests scan it, and every photo from every table lands in one shared album.'

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/wedding-photo-sharing' },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/wedding-photo-sharing`,
    title: `${PAGE_TITLE} - Hushare`,
    description: PAGE_DESCRIPTION,
    siteName: 'Hushare',
    locale: 'en_US',
    images: [{ url: `${SITE_URL}/wedding.jpg`, width: 700, height: 1052, alt: 'Wedding photo sharing' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${PAGE_TITLE} - Hushare`,
    description: PAGE_DESCRIPTION,
  },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'Wedding Photo Sharing', item: `${SITE_URL}/wedding-photo-sharing` },
      ],
    },
    {
      '@type': 'WebPage',
      '@id': `${SITE_URL}/wedding-photo-sharing#webpage`,
      url: `${SITE_URL}/wedding-photo-sharing`,
      name: `${PAGE_TITLE} - Hushare`,
      description: PAGE_DESCRIPTION,
      inLanguage: 'en',
      isPartOf: { '@id': `${SITE_URL}#website` },
    },
    {
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Do wedding guests need to download an app?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No. Guests scan a QR code or open the link in their browser. No app download, no sign-up.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can we password-protect the wedding album?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes, on every plan including free. Add password protection so only your guests can see the photos.',
          },
        },
      ],
    },
  ],
}

export default function WeddingPhotoSharingPage() {
  return (
    <SeoLandingPage
      eyebrow="Wedding photo sharing"
      title="Every guest. Every table. One album."
      intro="Put a QR code on every table. Guests scan it, add their photos, and by the end of the night you have every shot from every angle in one beautiful shared album - no app download, no sign-up."
      image="/wedding.jpg"
      imageAlt="Bride and groom at a wedding - shared photo album"
      useCases={[
        'Collect candid shots from every table, not just the photographer\'s angles',
        'Share photos with guests the same night while everything is still fresh',
        'Give family abroad a live look at the celebration as it happens',
        'Build a complete album across the ceremony, cocktail hour, and reception',
        'Add a personal touch - guests contribute their favourite moment, not just posed shots',
        'Give the photographer\'s gallery a companion full of real, unposed moments',
      ]}
      details={[
        {
          title: 'QR code on every table',
          body: 'Print the Hushare QR code on place cards, table signs, or the menu. Guests scan and start adding photos immediately - no instructions needed.',
        },
        {
          title: 'Password-protect for guests only',
          body: 'Add a password so only your guests can open the album - free on every plan. Share it in the invite; the album is yours and theirs alone.',
        },
        {
          title: 'Download everything after',
          body: 'When the night is over, download all guest photos as a single ZIP. Every candid, every detail shot, every tearful hug. Photos up to 3500px are kept exactly as shot and larger ones are resized to 3500px — enough for a full-page print — while lightweight thumbnails keep the album quick on a phone; videos are kept exactly as uploaded.',
        },
      ]}
      faq={[
        {
          q: 'Do wedding guests need to download an app?',
          a: 'No. Guests scan the QR code or open the link in any browser - iPhone, Android, or anything else. No app download, no sign-up.',
        },
        {
          q: 'Can we password-protect the wedding album?',
          a: 'Yes, on every plan including Free. Add a password to your album, share it with invited guests, and no one else can see the photos.',
        },
        {
          q: 'How do I print the QR code for the tables?',
          a: 'From your album\'s share menu, copy the link and generate a QR code using any free QR code generator. You can also print the link directly if you have a short custom URL (available on Pro).',
        },
        {
          q: 'Can guests see each other\'s photos as they upload?',
          a: 'Yes. The album updates in real time. Guests can scroll through photos from other tables while the reception is still going.',
        },
        {
          q: 'Is there a limit on photos or guests?',
          a: 'Any number of guests can contribute — there is no limit on people. Free albums hold up to 500 photos and videos (250 without an account); Pro holds 3,000 and Max 10,000. Each photo can be up to 25 MB on Free and 200 MB on paid plans.',
        },
        {
          q: 'How long will the wedding album last?',
          a: 'Free albums are kept as long as the album is active - they retire after 1 year of inactivity. If you made the album while signed in, we email a warning first - albums made without an account have no address to warn. On Pro, albums never expire. For a wedding album you want to keep forever, Pro is the right tier.',
        },
        {
          q: 'Can we add a custom URL like hushare.space/anna-and-david?',
          a: 'Yes, custom URLs are available on Pro. You get a short, memorable link that you can print anywhere without needing a QR code at all.',
        },
        {
          q: 'What file types can guests upload?',
          a: 'JPG, PNG, HEIC and WebP images, plus MP4, MOV and WebM video — on every plan including free. Photos are up to 25 MB on Free and 200 MB on paid plans; video is 200 MB on Free, 1 GB on Pro and 4 GB on Max.',
        },
      ]}
      jsonLd={jsonLd}
    />
  )
}
