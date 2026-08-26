import type { CSSProperties } from 'react'
import { resolveAlbumBackgroundImage } from '@/lib/album-backgrounds'
import type { Photo, HeaderVideoMode } from '@/types'

// Shared album "accent color" config — used by BOTH the design API route (server validation) and
// the OwnerToolbar UI (swatches), so the palette can never drift between them.
//
// The accent colors the album HEADER band. Text/logo on the band auto-contrast (see contrastText),
// so ANY color works — dark, light, even white — and stays readable. That's why the palette can mix
// rich darks and soft lights, and why custom hex has no darkness restriction.

export const ACCENT_PALETTE: string[] = [
  // Rich / dark
  '#630826', // Hushare maroon — the default
  '#7a1533', '#9b1b30', '#a63a1e', '#b4531f',
  '#1f5136', '#12664b', '#0f5e63', '#1e3a5f',
  '#21458c', '#33307a', '#5b2a86', '#6a2a5b',
  '#8a1e5c', '#3a4750', '#2b2b2e', '#4a2c1a', '#4b5320',
  // Soft / light (dark text auto-applies)
  '#fdfaf5', '#f3d9de', '#f6e7c6', '#dceadf', '#d7e3f2', '#e7ddf1',
]

export const DEFAULT_ACCENT = '#630826'

const HEX_RE = /^#[0-9a-fA-F]{6}$/
const PALETTE_SET = new Set(ACCENT_PALETTE.map((c) => c.toLowerCase()))

export function isValidHex(hex: string): boolean {
  return HEX_RE.test(hex)
}

export function isPaletteColor(hex: string): boolean {
  return PALETTE_SET.has(hex.toLowerCase())
}

// Returns the readable text/ink color to place ON TOP of the given accent: cream on dark accents,
// dark ink on light accents. WCAG relative luminance with a mid threshold. Used for the header band.
export function contrastText(hex: string): string {
  const m = HEX_RE.exec(hex)
  if (!m) return '#FDFAF5'
  const n = parseInt(hex.slice(1), 16)
  const chan = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  const L = 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255)
  return L > 0.42 ? '#241a15' : '#FDFAF5'
}

// A QR code's dark modules need strong contrast against a light background to scan reliably — a
// pastel accent used directly would make the code unreadable. Reuses contrastText's darkness test:
// if the accent is already dark enough to need light ink on top of it (header band), it's dark
// enough to serve as a QR foreground against white too. Light accents fall back to the brand
// maroon instead of ever rendering an unscannable code. Used by every QR/share-card surface so
// they can't drift into inconsistent (or invalid) colors independently.
export function qrForegroundColor(accent: string | null | undefined): string {
  if (!accent || !isValidHex(accent)) return DEFAULT_ACCENT
  return contrastText(accent) === '#FDFAF5' ? accent : DEFAULT_ACCENT
}

// ── Album title fonts (owner-selectable). Playfair (--font-serif) and Geist (--font-sans) are
// already loaded app-wide; Fraunces / Space Grotesk / Caveat are self-hosted (see base.css). The
// Noto Armenian vars are appended as fallbacks so Armenian titles still render (these display faces
// have no Armenian glyphs).
export type AlbumFont = { key: string; label: string; stack: string }
export const ALBUM_FONTS: AlbumFont[] = [
  { key: 'serif',   label: 'Classic',     stack: "var(--font-serif), var(--font-serif-am), Georgia, serif" },
  { key: 'sans',    label: 'Modern',      stack: "var(--font-sans), var(--font-sans-am), system-ui, sans-serif" },
  { key: 'elegant', label: 'Elegant',     stack: "'Fraunces', var(--font-serif-am), Georgia, serif" },
  { key: 'bold',    label: 'Bold',        stack: "'Space Grotesk', var(--font-sans-am), system-ui, sans-serif" },
  { key: 'script',  label: 'Handwritten', stack: "'Caveat', var(--font-serif-am), cursive" },
]
export const DEFAULT_FONT = 'serif'
export function isValidFont(key: string): boolean {
  return ALBUM_FONTS.some((f) => f.key === key)
}
export function fontStack(key: string | null | undefined): string {
  return (ALBUM_FONTS.find((f) => f.key === key) ?? ALBUM_FONTS[0]).stack
}

// ── One-tap "looks" — event-type presets. Each dresses the whole album in a tap (accent + title
// font + photo layout). Every accent is a palette colour, so applying a look is always free.

// ── Header video playback modes (used when the chosen header photo is a video).
export const HEADER_VIDEO_MODES: { key: HeaderVideoMode; label: string }[] = [
  { key: 'loop', label: 'Loop' },
  { key: 'once', label: 'Play once' },
  { key: 'hoverPlay', label: 'Hover: once' },
  { key: 'hoverLoop', label: 'Hover: loop' },
]
export function isValidHeaderVideoMode(key: string): key is HeaderVideoMode {
  return key === 'once' || key === 'loop' || key === 'hoverPlay' || key === 'hoverLoop'
}
// Resolve a tile's radius + whether it wears a white matte, from the album's photo_style.
// `mediaRadius` is the album's own per-tile radius, used only for the default style.
// ── Photo style — how the tiles present. null/'default' = the album's own media_radius; the three
// named styles override every tile's look. Chosen in the Album Designer.
export type AlbumPhotoStyle = { key: string; label: string }
export const ALBUM_PHOTO_STYLES: AlbumPhotoStyle[] = [
  { key: 'default', label: 'Standard' },
  { key: 'edge', label: 'Edge to edge' },
  { key: 'rounded', label: 'Rounded' },
  { key: 'framed', label: 'Framed' },
]
export function isValidPhotoStyle(key: string): boolean {
  return key === 'edge' || key === 'rounded' || key === 'framed'
}

export function photoStyleTile(style: string | null | undefined, mediaRadius: number): { radius: number; framed: boolean } {
  switch (style) {
    case 'edge': return { radius: 0, framed: false }
    case 'rounded': return { radius: 22, framed: false }
    case 'framed': return { radius: 8, framed: true }
    default: return { radius: mediaRadius, framed: false }
  }
}

// ── Album page background ("background_theme"). Shared between the live album page and the
// Album Designer's preview pane so the two can never drift apart — a background that "does
// nothing" in one but not the other is exactly the kind of split that reads as broken.
const HEX_BG_RE = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/

export function isImageBackground(theme: string | null | undefined): theme is string {
  return !!theme && (theme.startsWith('image:') || theme.startsWith('stock:'))
}

export function getBackgroundImageUrl(theme: string): string {
  // stock: → resolve to Pexels CDN URL via the shared helper
  if (theme.startsWith('stock:')) return resolveAlbumBackgroundImage(theme)
  // image: → custom uploaded image stored as "image:https://..."
  if (theme.startsWith('image:')) {
    const url = theme.slice('image:'.length)
    return url.startsWith('https://') ? url : ''  // reject non-https from DB
  }
  return ''
}

export function getBackgroundColorStyle(theme: string | null | undefined): CSSProperties {
  if (!theme) return { backgroundColor: '#FDFAF5' }
  if (isImageBackground(theme)) return {}  // transparent — an image layer shows through
  if (HEX_BG_RE.test(theme)) return { background: theme }
  return { backgroundColor: '#FDFAF5' }  // unrecognised value → safe fallback
}

// ── Header/hero image resolution — shared by the live album page and the Designer's preview so
// they can never resolve to different images. header_image (a direct R2 upload) always wins when
// set; otherwise falls back to the chosen cover_photo_id among the album's own photos. The two
// are kept mutually exclusive server-side (see /api/album/header-image and /api/album/cover), so
// this order only matters as a defensive fallback.
export function resolveHeaderImageUrl(
  album: { header_image?: string | null; cover_photo_id?: string | null },
  photos: Photo[],
): string | null {
  if (album.header_image) return album.header_image
  const p = album.cover_photo_id ? photos.find((x) => x.id === album.cover_photo_id) : undefined
  if (!p) return null
  return p.media_type === 'video'
    ? (p.poster_url || p.stream_thumbnail_url || p.thumb_url || null)
    : (p.url || p.thumb_url || null)
}

// The header photo when it's a VIDEO — returns the Photo itself so the header can embed a real
// Stream player over the poster that resolveHeaderImageUrl already provides. Null whenever the
// header is a still image (a custom header_image upload is always an image), which keeps the
// existing static-hero path completely untouched for every album that isn't using a video.
export function resolveHeaderVideo(
  album: { header_image?: string | null; cover_photo_id?: string | null },
  photos: Photo[],
): Photo | null {
  if (album.header_image || !album.cover_photo_id) return null
  const p = photos.find((x) => x.id === album.cover_photo_id)
  return p && p.media_type === 'video' && p.stream_uid ? p : null
}

// Cloudflare Stream iframe URL for a header video, with the params its playback mode needs.
// Always muted: a header video plays without a user gesture, and browsers only permit muted
// autoplay. `loop` covers both always-loop and hover-loop; hover modes start paused and are
// (re)started by the header's own hover handling.
export function headerVideoIframeSrc(photo: Photo, mode: HeaderVideoMode, autoplay: boolean): string {
  const base = photo.stream_iframe_url || (photo.stream_uid ? `https://iframe.videodelivery.net/${photo.stream_uid}` : '')
  if (!base) return ''
  const url = new URL(base)
  url.searchParams.set('muted', 'true')
  url.searchParams.set('controls', 'false')
  url.searchParams.set('preload', 'auto')
  if (mode === 'loop' || mode === 'hoverLoop') url.searchParams.set('loop', 'true')
  if (autoplay) url.searchParams.set('autoplay', 'true')
  return url.toString()
}
