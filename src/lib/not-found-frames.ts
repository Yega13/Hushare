import type { CSSProperties } from 'react'

// THE PILE OF PHOTOS ON THE 404 PAGE: what is in it, and every size its parts share.
//
// Three framed beach photos, tilted the way prints sit when they have been put down on a table. They
// were empty dashed frames until 2026-09-14, when the owner chose photos; the page's heading carries
// "the album is not here" on its own now.
//
// ONE PLACE FOR THE SIZES. The frame, its border, the insets of the photo window and the size the files
// were encoded at are one fact. It was written four times -- the styles, a comment, an <Image>'s width
// and height, and the files -- and the comment was already wrong: it said the window was 90 x 85, and
// Chrome measured 88 x 83, because the frame is border-box and its 1px border comes off before the
// inset. WINDOW is computed from FRAME here, and tests/not-found-frames.test.ts holds the files to it.
//
// A CSS BACKGROUND, NOT AN <img>. A photo that failed to load as an <img alt=""> drew Chrome's
// broken-image icon and a grey border over the sand (screenshot, 2026-09-14). A background image that
// fails draws nothing, so the sand colour behind it shows: a blank print, not a broken one. It also
// keeps React from adding a <link rel="preload"> for three decorative files -- it does that for every
// server-rendered <img> that is not lazy or low priority, and an unmatched URL (which renders this page
// with a real 404 status) carried three of them, measured. The cost: a background is requested once the
// styles apply, slightly after an <img> would be. For decoration that does not matter.
// windowStyle uses longhands only: a `background` shorthand would reset the image.
//
// OUR FILES, ENCODED ONCE. They live in public/not-found/, not on Pexels' CDN: this page is what people
// see when something else already failed, so it must not depend on another company. Nothing on this
// site resizes images on the way out (no IMAGES binding, so /_next/image returns the original file --
// checked in production 2026-09-14), so the files are encoded once, at 3x the window or more and in
// its shape; tests/not-found-frames.test.ts reads the real files and holds them to WINDOW.
// WebP rather than AVIF because there is one file and no format negotiation: iOS Safari decodes WebP
// from 14 and AVIF from 16, with caveats until 16.4 (caniuse-lite 1.0.30001799). Next 16 supports
// Safari 16.4 and later (node_modules/next/dist/docs/03-architecture/supported-browsers.md), so either
// format reaches every browser the app supports; WebP is simply the one with no caveat at all.
//
// Pexels licence: free, no credit required. Not allowed: implying that the people pictured endorse us,
// which is why none of the three shows a recognisable person.

// SHAPED LIKE A REAL INSTANT PRINT, since 2026-09-15, when the owner asked for bigger prints with "a more
// realistic look". Polaroid's support article "What are Polaroid photo dimensions?" gives I-Type / 600 /
// SX-70 film as a 3.483 x 4.233 in card around a 3.108 x 3.024 in picture -- quoted from search results,
// because the page itself refuses an automated read. Other sources round the picture to 79 x 79 mm or
// swap its two sides, so the one fact they all agree on is the one used: a card about 1.215 times taller
// than it is wide, around a picture that is very nearly square, with side borders about 5% of the width.
// tests/not-found-frames.test.ts holds the frames to that. Nobody publishes how the leftover height splits
// between the top and bottom borders, only that the bottom is deeper; 9 above and 36 below is set by eye,
// to the thick white lip a print is recognised by.
//
// The spread between prints grew less than the prints did (84 against 74, +14%, where the card grew
// +22% wide and +36% tall), so the pile overlaps a little more. At full size, at rest, that still leaves
// 18 px on the left and 21 px on the right of a 360 px phone. It did not on a 320 px one -- see NARROW.
export const FRAME = { width: 132, height: 160, border: 1, top: 9, side: 7, bottom: 36 } as const

/** The photo window inside a frame, in CSS pixels. The frame is border-box, so the border comes off first. */
export const WINDOW = {
  width: FRAME.width - 2 * FRAME.border - 2 * FRAME.side,
  height: FRAME.height - 2 * FRAME.border - FRAME.top - FRAME.bottom,
} as const

export const FRAMES = [
  { rotate: -9, x: -84, y: 14, delay: '0s', z: 1, photo: '/not-found/pexels-6942800.webp' },
  { rotate: 7, x: 84, y: 22, delay: '.9s', z: 2, photo: '/not-found/pexels-21939389.webp' },
  // Drawn last and centred, so the front frame of the pile is the one that reads first.
  { rotate: -2, x: 0, y: 0, delay: '.45s', z: 3, photo: '/not-found/pexels-4321802.webp' },
] as const

export type NotFoundFrame = (typeof FRAMES)[number]

/** The drift at its peak: how far the pile lifts, and how much of each print's tilt it keeps. */
export const DRIFT = { lift: 7, tiltKept: 0.82 } as const

/** The height the page reserves for the pile, in CSS pixels. */
export const PILE_HEIGHT = 212

// THE WIDTH THAT WAS MISSED. The bigger prints were measured in Chrome at 1280, 390 and 360 px, and a
// review then computed that at 320 -- the smallest common phone -- the side prints reached the screen
// edge, where the smaller pile before them had 23 to 25 px each side. Nothing scrolls sideways to warn
// anyone: styles/base.css clips horizontal overflow on html and body, so a pile too wide for the screen is
// simply cut off, and a "does the page scroll sideways" check cannot see it. So below these widths the
// whole pile is drawn smaller, and pileExtent below is what the tests hold the margins to. A desktop
// window zoomed far in reaches these rules too, but its media-query width still counts the scrollbar
// gutter (base.css keeps it stable) while its layout does not, so its margins can come out up to about
// 8 px smaller than a phone's -- half a 17 px gutter: tighter, not cut off. Widest first: the page emits the rules in this order, and the
// later, narrower one wins.
export const NARROW = [
  { maxWidth: 359, scale: 0.9 },
  { maxWidth: 319, scale: 0.8 },
] as const

/** The scale the page draws the pile at, for a viewport this many CSS pixels wide. */
export function pileScale(viewportWidth: number): number {
  let scale = 1
  for (const rule of NARROW) if (viewportWidth <= rule.maxWidth) scale = rule.scale
  return scale
}

export type PileExtent = { left: number; right: number; above: number; below: number }

/** Which moment of the drift to measure: at rest, at its peak, or the worse of the two on every side. */
export type PilePose = 'rest' | 'peak' | 'worst'

/**
 * The sizes pileExtent works from: the page's own unless others are passed. Tests pass fixed ones to compare
 * the arithmetic against a Chrome measurement, so those readings describe one pile forever instead of going
 * stale -- or being quietly replaced by this function's own output -- the next time a size changes.
 */
export type PileGeometry = {
  frame: { width: number; height: number }
  frames: readonly { x: number; y: number; rotate: number }[]
  drift: { lift: number; tiltKept: number }
}

const PAGE_GEOMETRY: PileGeometry = { frame: FRAME, frames: FRAMES, drift: DRIFT }

/**
 * How far the pile reaches from its centre, in CSS pixels, at a given scale and pose, for every print at
 * its own tilt.
 *
 * The drift has no worse moment than its two ends: all three keyframes use the same translate-then-rotate
 * list, so the browser blends the lift and the tilt separately and every in-between frame lies between
 * rest and peak. That alone would not settle the top edge, where the lift rises while the tilt's height
 * shrinks; but 7 px of lift outweighs about 1.5 px of height, and a review's sweep of the whole cycle in
 * 2,001 steps found no frame beyond the two ends. So 'worst' -- the
 * default, and what the margins are held to -- is the larger of the two on every side.
 *
 * This is each print's TRANSFORMED BORDER BOX, which is what getBoundingClientRect reports; Chrome frozen
 * at rest and at the peak agrees with it to 0.01 px. It is not what is painted: the rounded corners sit
 * 0.3 to 1.4 px inside it, depending on the tilt, so the margin visible on screen is a little larger.
 */
export function pileExtent(scale = 1, pose: PilePose = 'worst', g: PileGeometry = PAGE_GEOMETRY): PileExtent {
  let left = 0
  let right = 0
  let above = 0
  let below = 0
  for (const f of g.frames) {
    const rest = { dy: 0, tilt: f.rotate }
    const peak = { dy: -g.drift.lift, tilt: f.rotate * g.drift.tiltKept }
    const poses = pose === 'rest' ? [rest] : pose === 'peak' ? [peak] : [rest, peak]
    for (const { dy, tilt } of poses) {
      const rad = (Math.abs(tilt) * Math.PI) / 180
      const halfWidth = (g.frame.width * Math.cos(rad) + g.frame.height * Math.sin(rad)) / 2
      const halfHeight = (g.frame.height * Math.cos(rad) + g.frame.width * Math.sin(rad)) / 2
      left = Math.max(left, halfWidth - f.x)
      right = Math.max(right, f.x + halfWidth)
      above = Math.max(above, halfHeight - (f.y + dy))
      below = Math.max(below, f.y + dy + halfHeight)
    }
  }
  return { left: left * scale, right: right * scale, above: above * scale, below: below * scale }
}

/** One print in the pile: its mount, its resting tilt, and the custom properties the drift animation reads. */
export function frameStyle(frame: NotFoundFrame): CSSProperties {
  return {
    position: 'absolute',
    left: '50%',
    top: '50%',
    boxSizing: 'border-box',
    width: FRAME.width,
    height: FRAME.height,
    marginLeft: -FRAME.width / 2,
    marginTop: -FRAME.height / 2,
    zIndex: frame.z,
    borderRadius: 10,
    // OPAQUE, like card. At 92% the side photos showed through the front print's white lip as faint
    // squares, which the bigger, more overlapping prints made plain in a screenshot (2026-09-15). A print
    // you can see through is the one detail that reads as fake.
    background: '#FFFDF8',
    border: `${FRAME.border}px solid #E3D6C0`,
    boxShadow: '0 10px 26px rgba(99, 8, 38, 0.10)',
    // Custom properties so one keyframe can drive all three: the animation adds its drift on top of
    // each frame's own resting position instead of overwriting it.
    ['--x' as string]: `${frame.x}px`,
    ['--y' as string]: `${frame.y}px`,
    ['--r' as string]: `${frame.rotate}deg`,
    animationDelay: frame.delay,
  }
}

/** The photo window: sand underneath, the photo drawn over it, covering the window. */
export function windowStyle(photo: string): CSSProperties {
  return {
    position: 'absolute',
    top: FRAME.top,
    right: FRAME.side,
    bottom: FRAME.bottom,
    left: FRAME.side,
    borderRadius: 5,
    backgroundColor: '#EFE3CE',
    backgroundImage: `url("${photo}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  }
}
