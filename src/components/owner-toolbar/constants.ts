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

// Whether a picked file is worth ATTEMPTING to upload. Deliberately looser than the set above,
// which is what we can store directly: a phone's picker regularly reports image/heic or no type at
// all for a picture the owner can see perfectly well in their gallery, and rejecting those up front
// meant "unsupported format" for a valid photo with no way forward. Anything that gets past this
// is normalised by prepareDesignImage() in owner-toolbar/api.ts, which re-encodes it through a
// canvas and only fails if the browser genuinely cannot draw it.
export function isPickableImage(file: File): boolean {
  return DESIGN_IMAGE_TYPES.has(file.type) || file.type === '' || file.type.startsWith('image/')
}
// A logo is a small mark, not a photo — tighter client pre-check matching the server's 5 MB cap
// (see /api/album/logo/upload) rather than reusing the general design-asset cap above.
export const MAX_LOGO_BYTES = 5 * 1024 * 1024
