import { STOCK_ALBUM_BACKGROUNDS } from '@/lib/album-backgrounds'

export const PRESETS = [
  { label: 'Cream', value: '#FDFAF5' },
  { label: 'White', value: '#FFFFFF' },
  { label: 'Sky', value: '#EDF4FB' },
  { label: 'Sage', value: '#EFF4EE' },
  { label: 'Blush', value: '#FDF0F2' },
  { label: 'Lavender', value: '#F2EFF8' },
  { label: 'Midnight', value: '#1C2333' },
  { label: 'Forest', value: '#1A2B1A' },
]

export const FEATURED_STOCK_BACKGROUNDS = STOCK_ALBUM_BACKGROUNDS.slice(0, 5)
export const DEFAULT_BG = '#FDFAF5'
export const MAX_BACKGROUND_BYTES = 10 * 1024 * 1024
export const BACKGROUND_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
