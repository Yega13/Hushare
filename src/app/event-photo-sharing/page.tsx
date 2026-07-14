import type { Metadata } from 'next'
import SeoLandingPage from '@/components/SeoLandingPage'

export const runtime = 'nodejs'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'
const PAGE_TITLE = 'Event Photo Sharing'
const PAGE_DESCRIPTION =
  'Collect photos from every attendee at your event. One link, no app required. Works for conferences, parties, school events, and corporate gatherings of any size.'

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/event-photo-sharing' },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/event-photo-sharing`,
    title: `${PAGE_TITLE} - Hushare`,
    description: PAGE_DESCRIPTION,
    siteName: 'Hushare',
    locale: 'en_US',
    images: [{ url: `${SITE_URL}/children.avif`, width: 1200, height: 900, alt: 'Event photo sharing' }],
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
        { '@type': 'ListItem', position: 2, name: 'Event Photo Sharing', item: `${SITE_URL}/event-photo-sharing` },
      ],
    },
    {
      '@type': 'WebPage',
      '@id': `${SITE_URL}/event-photo-sharing#webpage`,
      url: `${SITE_URL}/event-photo-sharing`,
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
          name: 'Does event photo sharing require an app download?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No. Attendees open the link or scan a QR code in any browser. No app, no account.',
          },
        },
        {
          '@type': 'Question',
          name: 'How many people can contribute photos to one event album?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'There is no limit. Any number of attendees can upload photos to the same album simultaneously.',
          },
        },
      ],
    },
  ],
}

export default function EventPhotoSharingPage() {
  return (
    <SeoLandingPage
      eyebrow="Event photo sharing"
      title="Every attendee is a photographer."
      intro="Create an event album in 30 seconds. Display the QR code on a screen, print it on a badge, or drop the link in the chat. Every attendee adds their shots, and you walk away with the whole story."
      image="/children.avif"
      imageAlt="Children at a school event - shared photo album"
      useCases={[
        'Conferences and workshops - collect speaker shots, networking moments, and slides',
        'School events, sports days, and classroom activities',
        'Corporate team-building days and company gatherings',
        'Birthday parties, anniversaries, and milestone celebrations',
        'Community events and festivals',
        'Sports matches - every goal, every cheer, from every angle',
      ]}
      details={[
        {
          title: 'No app, no account',
          body: 'Attendees open the link in any browser - on iPhone, Android, or a laptop. There is nothing to install, nothing to log in to. The album is ready in seconds.',
        },
        {
          title: 'QR code on any surface',
          body: 'Display the album QR code on a projector screen, print it on name badges, or put it on a sign at the entrance. Attendees scan once and photos start flowing in.',
        },
        {
          title: 'Walk away with everything',
          body: 'At the end of the event, download a ZIP of every photo at original quality. No compression, no watermarks, no chasing people to send you their shots.',
        },
      ]}
      faq={[
        {
          q: 'Does event photo sharing require an app download?',
          a: 'No. Attendees open the link or scan a QR code in any browser. No app, no account, no friction.',
        },
        {
          q: 'How many people can contribute photos to one event album?',
          a: 'There is no limit. Any number of attendees can upload photos to the same album simultaneously.',
        },
        {
          q: 'Can I use Hushare for a large conference or festival?',
          a: 'Yes. The platform handles many simultaneous uploads without issue. For very large events, a Pro or Max plan is recommended for HD video support and longer album retention.',
        },
        {
          q: 'Can I see photos in real time as guests upload them?',
          a: 'Yes. The album updates live. You can watch photos come in on a display screen during the event.',
        },
        {
          q: 'Can I restrict who can add photos?',
          a: 'Albums are unlisted - only people with the link can add photos. On Pro, you can add password protection so only invited attendees can contribute.',
        },
        {
          q: 'What file types are supported?',
          a: 'JPG, PNG, HEIC, and WebP on Free plans. HD video (MP4, MOV) is available on Pro and Max. Each file can be up to 25 MB on Free or 200 MB on paid plans.',
        },
        {
          q: 'How do I download all event photos at once?',
          a: 'One click in the album downloads a ZIP of every photo and video at original quality. No manual selecting or downloading one by one.',
        },
        {
          q: 'How long does the event album last?',
          a: 'Free albums are active as long as they receive uploads, and retire after 3 months of inactivity (we email a warning first). Pro and Max albums never expire.',
        },
      ]}
      jsonLd={jsonLd}
    />
  )
}
