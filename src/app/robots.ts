import type { MetadataRoute } from 'next'

export const runtime = 'nodejs'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space').replace(/\/+$/, '')

const PUBLIC_AGENTS = [
  'Googlebot', 'Googlebot-Image', 'Bingbot', 'Slurp',
  'DuckDuckBot', 'YandexBot', 'YandexImages', 'Baiduspider', 'Applebot',
]

export default function robots(): MetadataRoute.Robots {
  const rules = {
    allow: [
      '/',
      '/shared-photo-album',
      '/wedding-photo-sharing',
      '/event-photo-sharing',
      '/qr-code-photo-album',
      '/pricing',
      '/about',
      '/collabs',
      '/support',
      '/privacy',
      '/terms',
    ],
    disallow: ['/api/', '/account', '/login', '/auth/', '/report', '/card-editor'],
  }

  return {
    rules: [
      { userAgent: '*', ...rules },
      ...PUBLIC_AGENTS.map((userAgent) => ({ userAgent, ...rules })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
