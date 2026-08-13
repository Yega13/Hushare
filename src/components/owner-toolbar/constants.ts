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

export const DEFAULT_BG = '#FDFAF5'
// Client-side pre-check for a design-asset image upload (currently: the header photo). Deliberately
// narrower than lib/cloudflare/r2.ts's ALLOWED_IMAGE_TYPES (the main photo pipeline's server-
// enforced set, which also allows GIF/HEIC/HEIF) — a styling asset has no reason to accept those.
// Different name on purpose: these two sets are NOT interchangeable, don't merge them.
export const MAX_DESIGN_IMAGE_BYTES = 10 * 1024 * 1024
export const DESIGN_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
// A logo is a small mark, not a photo — tighter client pre-check matching the server's 5 MB cap
// (see /api/album/logo/upload) rather than reusing the general design-asset cap above.
export const MAX_LOGO_BYTES = 5 * 1024 * 1024
