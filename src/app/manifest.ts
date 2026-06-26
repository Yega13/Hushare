import type { MetadataRoute } from 'next'

export const runtime = 'nodejs'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Hushare - Shared photo albums from one link',
    short_name: 'Hushare',
    description: 'Create a shared photo album in seconds. Guests add photos from one link - no app, no sign-up.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FDFAF5',
    theme_color: '#254F22',
    categories: ['photo', 'social', 'lifestyle'],
    icons: [
      { src: '/logo/logo-favicon.png',                sizes: '64x64',   type: 'image/png'                    },
      { src: '/logo/logo-icon.png',                   sizes: '500x500', type: 'image/png', purpose: 'any'      },
      { src: '/logo/logo-icon-light-transparent.png', sizes: '500x500', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
