import type { CSSProperties } from 'react'
import type { SlideshowAnimation, SlideshowMotion, SlideshowMove, SlideshowDirection, SlideshowEasing } from '@/types'

// Composable slideshow transitions.
//
// The old model was four preset names, so every Hushare slideshow moved in one of four identical
// ways — the definition of stock. Here a transition is instead a point in a space: what moves,
// where it comes from, how far, how soft, how long, on what curve. Every combination is expressed
// through CSS custom properties feeding ONE keyframe (see styles/slideshow.css), so adding an axis
// never means adding another animation, and the browser still gets a plain compositor-friendly
// transform + opacity + filter.

export const SLIDESHOW_MOVES: Array<{ value: SlideshowMove; label: string }> = [
  { value: 'none', label: 'Still' },
  { value: 'slide', label: 'Slide' },
  { value: 'zoomIn', label: 'Zoom in' },
  { value: 'zoomOut', label: 'Zoom out' },
]

export const SLIDESHOW_DIRECTIONS: Array<{ value: SlideshowDirection; label: string }> = [
  { value: 'up', label: 'From above' },
  { value: 'down', label: 'From below' },
  { value: 'left', label: 'From the left' },
  { value: 'right', label: 'From the right' },
]

// Named curves rather than raw cubic-beziers: an owner picking how a photo should feel arriving is
// not going to type control points, and every one of these is a genuinely different character.
export const SLIDESHOW_EASINGS: Array<{ value: SlideshowEasing; label: string; css: string }> = [
  { value: 'smooth', label: 'Smooth', css: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  { value: 'even',   label: 'Even',   css: 'linear' },
  { value: 'gentle', label: 'Gentle', css: 'cubic-bezier(0.4, 0, 0.2, 1)' },
  { value: 'sharp',  label: 'Sharp',  css: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  { value: 'spring', label: 'Spring', css: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
]

export const MIN_SLIDESHOW_DURATION_MS = 150
export const MAX_SLIDESHOW_DURATION_MS = 2000

const MOVES = new Set(SLIDESHOW_MOVES.map((m) => m.value))
const DIRECTIONS = new Set(SLIDESHOW_DIRECTIONS.map((d) => d.value))
const EASINGS = new Map(SLIDESHOW_EASINGS.map((e) => [e.value, e.css]))

// How far the extremes of the `distance` axis actually travel. Kept here rather than in the UI so
// the stored value stays a neutral 0–100 and the physical feel can be retuned without a migration.
const MAX_SLIDE_PX = 220
const MAX_ZOOM = 0.4      // distance 100 → starts at 0.6× (zoom in) or 1.4× (zoom out)
const MAX_BLUR_PX = 24

export const DEFAULT_SLIDESHOW_MOTION: SlideshowMotion = {
  move: 'none', direction: 'up', distance: 0, fade: 100, blur: 0, durationMs: 620, easing: 'smooth',
}

// The four retired presets, expressed in the new space. This is what an album that has never opened
// the new controls resolves to, so nothing anyone already set up changes appearance.
const LEGACY_MOTION: Record<SlideshowAnimation, SlideshowMotion> = {
  none: { ...DEFAULT_SLIDESHOW_MOTION, fade: 0, durationMs: MIN_SLIDESHOW_DURATION_MS },
  fade: { ...DEFAULT_SLIDESHOW_MOTION },
  rise: { ...DEFAULT_SLIDESHOW_MOTION, move: 'slide', direction: 'down', distance: 4 },
  zoom: { ...DEFAULT_SLIDESHOW_MOTION, move: 'zoomIn', distance: 5 },
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

// Validate + coerce anything (a request body, a jsonb column) into a usable motion. Returns null
// only when the input isn't an object at all; every individual axis falls back rather than failing,
// so one bad field can never make an album's slideshow unrenderable.
export function normalizeSlideshowMotion(value: unknown): SlideshowMotion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const move = typeof v.move === 'string' && MOVES.has(v.move as SlideshowMove)
    ? (v.move as SlideshowMove) : DEFAULT_SLIDESHOW_MOTION.move
  const direction = typeof v.direction === 'string' && DIRECTIONS.has(v.direction as SlideshowDirection)
    ? (v.direction as SlideshowDirection) : DEFAULT_SLIDESHOW_MOTION.direction
  const easing = typeof v.easing === 'string' && EASINGS.has(v.easing as SlideshowEasing)
    ? (v.easing as SlideshowEasing) : DEFAULT_SLIDESHOW_MOTION.easing
  return {
    move,
    direction,
    distance: clampInt(v.distance, 0, 100, DEFAULT_SLIDESHOW_MOTION.distance),
    fade: clampInt(v.fade, 0, 100, DEFAULT_SLIDESHOW_MOTION.fade),
    blur: clampInt(v.blur, 0, 100, DEFAULT_SLIDESHOW_MOTION.blur),
    durationMs: clampInt(v.durationMs, MIN_SLIDESHOW_DURATION_MS, MAX_SLIDESHOW_DURATION_MS, DEFAULT_SLIDESHOW_MOTION.durationMs),
    easing,
  }
}

// What this album's slideshow should actually do: its own composed motion if it has one, otherwise
// the preset it has been using all along.
export function resolveSlideshowMotion(album: {
  slideshow_motion?: SlideshowMotion | null
  slideshow_animation?: SlideshowAnimation | null
}): SlideshowMotion {
  return normalizeSlideshowMotion(album.slideshow_motion)
    ?? LEGACY_MOTION[album.slideshow_animation ?? 'fade']
    ?? LEGACY_MOTION.fade
}

// The starting frame, as custom properties. Everything the keyframe needs is here; nothing about
// the transition lives in a class name any more.
export function slideshowMotionVars(m: SlideshowMotion): CSSProperties {
  const slide = m.move === 'slide' ? (m.distance / 100) * MAX_SLIDE_PX : 0
  const zoomDelta = (m.move === 'zoomIn' || m.move === 'zoomOut') ? (m.distance / 100) * MAX_ZOOM : 0
  // `direction` is where the photo comes FROM, so it starts offset on the opposite side.
  const x = m.direction === 'left' ? -slide : m.direction === 'right' ? slide : 0
  const y = m.direction === 'up' ? -slide : m.direction === 'down' ? slide : 0
  return {
    '--hush-ss-x': `${Math.round(x)}px`,
    '--hush-ss-y': `${Math.round(y)}px`,
    '--hush-ss-scale': String(m.move === 'zoomIn' ? 1 - zoomDelta : m.move === 'zoomOut' ? 1 + zoomDelta : 1),
    '--hush-ss-opacity': String(Math.max(0, Math.min(1, 1 - m.fade / 100))),
    '--hush-ss-blur': `${Math.round((m.blur / 100) * MAX_BLUR_PX)}px`,
    '--hush-ss-duration': `${m.durationMs}ms`,
    '--hush-ss-easing': EASINGS.get(m.easing) ?? 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  } as CSSProperties
}

// Nothing to animate: no movement, no fade, no blur. Skips the animation entirely rather than
// running a no-op one on every slide.
export function slideshowMotionIsStill(m: SlideshowMotion): boolean {
  return (m.move === 'none' || m.distance === 0) && m.fade === 0 && m.blur === 0
}
