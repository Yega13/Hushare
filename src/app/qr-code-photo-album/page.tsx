import type { Metadata } from 'next'
import SeoLandingPage from '@/components/SeoLandingPage'

export const runtime = 'nodejs'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'
const PAGE_TITLE = 'QR Code Photo Album'
const PAGE_DESCRIPTION =
  'Put a QR code at your event and let guests add photos instantly. No app download, no sign-up. Create a free QR code photo album with Hushare in seconds.'

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/qr-code-photo-album' },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/qr-code-photo-album`,
    title: `${PAGE_TITLE} - Hushare`,
    description: PAGE_DESCRIPTION,
    siteName: 'Hushare',
    locale: 'en_US',
    images: [{ url: `${SITE_URL}/card2.jpg`, width: 1200, height: 900, alt: 'QR code photo album' }],
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
        { '@type': 'ListItem', position: 2, name: 'QR Code Photo Album', item: `${SITE_URL}/qr-code-photo-album` },
      ],
    },
    {
      '@type': 'WebPage',
      '@id': `${SITE_URL}/qr-code-photo-album#webpage`,
      url: `${SITE_URL}/qr-code-photo-album`,
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
          name: 'How do I make a QR code for a photo album?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Create a free Hushare album, then use any QR code generator to turn the album link into a QR code. Print it and guests can scan to add photos instantly.',
          },
        },
        {
          '@type': 'Question',
          name: 'Do guests need to download an app to scan the QR code?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No. The camera app on any modern iPhone or Android phone can scan the QR code. It opens directly in the browser - no app needed.',
          },
        },
      ],
    },
  ],
}

export default function QrCodePhotoAlbumPage() {
  return (
    <SeoLandingPage
      eyebrow="QR code photo album"
      title="Scan. Add. Done."
      intro="Create a Hushare album, print the QR code, and place it at your event. Guests scan with their phone camera - no app, no sign-up - and their photos land in your album instantly."
      image="/card2.jpg"
      imageAlt="Table card with QR code linking to a shared photo album"
      useCases={[
        'Wedding table cards - one QR code per table, hundreds of candid shots',
        'Event signage - a QR code on a banner collects photos from the whole room',
        'Name badges at conferences - every attendee can contribute',
        'Printed invitations with a QR code guests scan on arrival',
        'Venue screens displaying a live album as guests add photos',
        'Birthday or anniversary cards that link to a shared memory album',
      ]}
      details={[
        {
          title: 'Any QR code, any printer',
          body: 'Create your Hushare album, copy the link, and paste it into any free QR code generator. Print the QR code on cards, signs, screens, or banners - it works immediately.',
        },
        {
          title: 'Scans instantly from camera',
          body: 'No QR scanner app needed. The built-in camera on any iPhone or Android phone can scan the code and open the album directly in the browser. One scan and guests are in.',
        },
        {
          title: 'Real-time photos, highest quality',
          body: 'Photos appear in the album the moment guests upload them. Everything is stored at original resolution. Download the full album as a ZIP at any time.',
        },
      ]}
      faq={[
        {
          q: 'How do I make a QR code for a photo album?',
          a: 'Create a free Hushare album, copy the link, and paste it into any free QR code generator (there are many online). Download the QR code image and print it. Guests scan it and are taken straight to the album.',
        },
        {
          q: 'Do guests need to download an app to scan the QR code?',
          a: 'No. The camera app on any modern iPhone or Android phone can scan QR codes natively. It opens directly in the browser - no app needed.',
        },
        {
          q: 'Can I get a short custom URL so the QR code is smaller and cleaner?',
          a: 'Yes. On Hushare Pro you can set a custom URL like hushare.space/our-wedding, which makes a smaller and cleaner QR code that is also easier to type if someone prefers to.',
        },
        {
          q: 'What is the best QR code size to print?',
          a: 'For a table card, 4 x 4 cm (1.5 inches) works well. For a poster or banner, go larger - at least 10 x 10 cm. Always test the scan before printing in bulk.',
        },
        {
          q: 'Can I use the same QR code on multiple signs or tables?',
          a: 'Yes. One QR code links to one album. Any number of people can scan the same code and all contribute to the same album simultaneously.',
        },
        {
          q: 'Can I password-protect the QR code album so only my guests can upload?',
          a: 'Yes. With a Hushare Pro plan you can add a password to your album. Only guests who know the password can view or add photos.',
        },
        {
          q: 'What file types can guests upload after scanning the QR code?',
          a: 'JPG, PNG, HEIC, and WebP on Free. HD video (MP4, MOV) is available on Pro and Max plans.',
        },
        {
          q: 'Is there a limit on how many guests can scan the same code and upload?',
          a: 'No limit. Any number of guests can scan and upload simultaneously.',
        },
      ]}
      jsonLd={jsonLd}
    />
  )
}
