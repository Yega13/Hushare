// Types are declared in @/types to avoid duplication across the codebase.
// Re-exported here so all existing imports of `@/lib/media-display` keep working.
export type {
  MediaDisplayFilter,
  MediaHoverEffect,
  MobileGridColumns,
  SlideshowAnimation,
} from '@/types'
import type { MediaDisplayFilter, MediaHoverEffect, MobileGridColumns, SlideshowAnimation } from '@/types'

// Per-photo filter override: null means "inherit global", 'global' is the explicit sentinel.
export type PhotoFilterChoice = MediaDisplayFilter | 'global'

export const MIN_MEDIA_RADIUS = 0
export const MAX_MEDIA_RADIUS = 500
export const MIN_SLIDESHOW_INTERVAL_MS = 2000
export const MAX_SLIDESHOW_INTERVAL_MS = 10000
export const DEFAULT_SLIDESHOW_INTERVAL_MS = 4200

export const MEDIA_DISPLAY_FILTER_OPTIONS: Array<{ value: MediaDisplayFilter; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'warm', label: 'Warm' },
  { value: 'cool', label: 'Cool' },
  { value: 'mono', label: 'Mono' },
  { value: 'vintage', label: 'Vintage' },
  { value: 'soft', label: 'Soft' },
]

export const MEDIA_HOVER_EFFECT_OPTIONS: Array<{ value: MediaHoverEffect; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'mono', label: 'Mono' },
  { value: 'fade', label: 'Fade in' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'lift', label: 'Lift' },
]

export const MOBILE_GRID_COLUMN_OPTIONS: Array<{ value: MobileGridColumns; label: string }> = [
  { value: 3, label: '3 in a row' },
  { value: 4, label: '4 in a row' },
  { value: 5, label: '5 in a row' },
  { value: 6, label: '6 in a row' },
]

export const SLIDESHOW_ANIMATION_OPTIONS: Array<{ value: SlideshowAnimation; label: string }> = [
  { value: 'fade', label: 'Fade' },
  { value: 'rise', label: 'Soft rise' },
  { value: 'zoom', label: 'Gentle zoom' },
  { value: 'none', label: 'None' },
]

const MEDIA_DISPLAY_FILTERS = new Set<MediaDisplayFilter>(
  MEDIA_DISPLAY_FILTER_OPTIONS.map((o) => o.value),
)
const MEDIA_HOVER_EFFECTS = new Set<MediaHoverEffect>(
  MEDIA_HOVER_EFFECT_OPTIONS.map((o) => o.value),
)
const SLIDESHOW_ANIMATIONS = new Set<SlideshowAnimation>(
  SLIDESHOW_ANIMATION_OPTIONS.map((o) => o.value),
)

export function isMediaDisplayFilter(value: unknown): value is MediaDisplayFilter {
  return typeof value === 'string' && MEDIA_DISPLAY_FILTERS.has(value as MediaDisplayFilter)
}

export function isMediaHoverEffect(value: unknown): value is MediaHoverEffect {
  return typeof value === 'string' && MEDIA_HOVER_EFFECTS.has(value as MediaHoverEffect)
}

export function isMobileGridColumns(value: unknown): value is MobileGridColumns {
  const n = typeof value === 'number' ? value : Number(value)
  return MOBILE_GRID_COLUMN_OPTIONS.some((o) => o.value === n)
}

export function isSlideshowAnimation(value: unknown): value is SlideshowAnimation {
  return typeof value === 'string' && SLIDESHOW_ANIMATIONS.has(value as SlideshowAnimation)
}

export function clampSlideshowInterval(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  return Math.max(MIN_SLIDESHOW_INTERVAL_MS, Math.min(MAX_SLIDESHOW_INTERVAL_MS, Math.round(n)))
}

export function clampMediaRadius(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  return Math.max(MIN_MEDIA_RADIUS, Math.min(MAX_MEDIA_RADIUS, Math.round(n)))
}

export function cssMediaDisplayFilter(filter: MediaDisplayFilter | null | undefined): string {
  switch (filter) {
    case 'warm':    return 'sepia(0.18) saturate(1.12) contrast(1.02)'
    case 'cool':    return 'saturate(1.05) hue-rotate(8deg) contrast(1.02)'
    case 'mono':    return 'grayscale(1) contrast(1.04)'
    case 'vintage': return 'sepia(0.32) saturate(0.92) contrast(1.08)'
    case 'soft':    return 'saturate(0.94) brightness(1.04) contrast(0.94)'
    default:        return 'none'
  }
}
