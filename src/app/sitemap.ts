import type { MetadataRoute } from 'next'

export const runtime = 'nodejs'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space').replace(/\/+$/, '')

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return [
    { url: `${SITE_URL}/`,                      lastModified: now, changeFrequency: 'weekly',  priority: 1    },
    { url: `${SITE_URL}/shared-photo-album`,    lastModified: now, changeFrequency: 'monthly', priority: 0.85 },
    { url: `${SITE_URL}/wedding-photo-sharing`, lastModified: now, changeFrequency: 'monthly', priority: 0.85 },
    { url: `${SITE_URL}/event-photo-sharing`,   lastModified: now, changeFrequency: 'monthly', priority: 0.80 },
    { url: `${SITE_URL}/qr-code-photo-album`,   lastModified: now, changeFrequency: 'monthly', priority: 0.80 },
    { url: `${SITE_URL}/pricing`,               lastModified: now, changeFrequency: 'monthly', priority: 0.80 },
    { url: `${SITE_URL}/about`,                 lastModified: now, changeFrequency: 'monthly', priority: 0.70 },
    { url: `${SITE_URL}/collabs`,               lastModified: now, changeFrequency: 'monthly', priority: 0.65 },
    { url: `${SITE_URL}/support`,               lastModified: now, changeFrequency: 'monthly', priority: 0.60 },
    { url: `${SITE_URL}/privacy`,               lastModified: now, changeFrequency: 'yearly',  priority: 0.50 },
    { url: `${SITE_URL}/terms`,                 lastModified: now, changeFrequency: 'yearly',  priority: 0.50 },
  ]
}
