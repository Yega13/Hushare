import type { Metadata } from 'next'
import SeoLandingPage from '@/components/SeoLandingPage'

export const runtime = 'nodejs'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'
const PAGE_TITLE = 'Shared Photo Album'
const PAGE_DESCRIPTION =
  'Create a free shared photo album in seconds. Everyone adds photos from their own phones - no app download, no sign-up. Works at weddings, trips, and family events.'

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/shared-photo-album' },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/shared-photo-album`,
    title: `${PAGE_TITLE} - Hushare`,
    description: PAGE_DESCRIPTION,
    siteName: 'Hushare',
    locale: 'en_US',
    images: [{ url: `${SITE_URL}/shared-album.jpg`, width: 1200, height: 900, alt: 'Shared photo album' }],
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
        { '@type': 'ListItem', position: 2, name: 'Shared Photo Album', item: `${SITE_URL}/shared-photo-album` },
      ],
    },
    {
      '@type': 'WebPage',
      '@id': `${SITE_URL}/shared-photo-album#webpage`,
      url: `${SITE_URL}/shared-photo-album`,
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
          name: 'Do guests need to download an app to add photos?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No. Anyone with the link can add photos directly from their phone browser. No app, no sign-up.',
          },
        },
        {
          '@type': 'Question',
          name: 'How many photos can be in a shared album?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Free albums support unlimited photos per album. Each file can be up to 25 MB on Free, or 200 MB on paid plans.',
          },
        },
      ],
    },
  ],
}

export default function SharedPhotoAlbumPage() {
  return (
    <SeoLandingPage
      eyebrow="Shared photo album"
      title="One album. Everyone's photos."
      intro="Create a shared album in seconds and send one link. Friends and family add their own photos from any phone - no app, no account. You get every shot from every angle."
      image="/shared-album.jpg"
      imageAlt="Shared photo album with photos from multiple contributors"
      useCases={[
        'Wedding receptions where every guest is a photographer',
        'Family reunions and holiday gatherings',
        'Birthday parties - collect every candid, every group shot',
        'School events, sports days, and class trips',
        'Travel with friends - everyone\'s photos in one place',
        'Any event where photos end up scattered across a dozen phones',
      ]}
      details={[
        {
          title: 'No download, no sign-up',
          body: 'Share one link. Anyone can open it on any device, view photos already in the album, and add their own. It works on iPhone, Android, and any modern browser.',
        },
        {
          title: 'Scan a QR code at the venue',
          body: 'Print a Hushare QR code at your event - on tables, signs, or screens. Guests scan it, join the album, and the photos roll in from every corner of the room.',
        },
        {
          title: 'Highest quality, always',
          body: 'Photos are stored at the resolution they were taken. No compression, no watermarks. Download the full album as a ZIP whenever you want.',
        },
      ]}
      faq={[
        {
          q: 'Do guests need to download an app to add photos?',
          a: 'No. Anyone with the link can add photos directly from their phone browser. No app, no sign-up, no friction.',
        },
        {
          q: 'How many photos can be in a shared album?',
          a: 'Free albums support unlimited photos per album. Each file can be up to 25 MB on Free, or 200 MB on paid plans. There is no cap on the number of files.',
        },
        {
          q: 'Can I make the album private so only invited guests can see it?',
          a: 'Albums are unlisted by default - not indexed, not searchable. Only people with the link can see them. On Pro or Max you can also add password protection.',
        },
        {
          q: 'What file types can guests upload?',
          a: 'JPG, PNG, HEIC, and WebP on Free. HD video (MP4, MOV) is available on Pro and Max plans.',
        },
        {
          q: 'Can I download all the photos at once?',
          a: 'Yes - there is a one-click ZIP download that packages every photo and video in the album at original quality.',
        },
        {
          q: 'How long does the album last?',
          a: 'Free albums are retained as long as they are active. If an album sits untouched for 3 months it is automatically retired (we email a warning first). Pro and Max albums never expire due to inactivity.',
        },
        {
          q: 'Is there a limit on how many people can contribute?',
          a: 'No. Any number of people can add photos using the same link.',
        },
        {
          q: 'Can I share the album on social media or embed it somewhere?',
          a: 'You can share the album link anywhere - Whatsapp, Instagram, email, or printed QR code. Embedding is not yet supported, but it is on the roadmap.',
        },
      ]}
      jsonLd={jsonLd}
    />
  )
}
