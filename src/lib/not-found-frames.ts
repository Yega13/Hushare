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

export const FRAME = { width: 108, height: 118, border: 1, top: 9, side: 9, bottom: 24 } as const

/** The photo window inside a frame, in CSS pixels. The frame is border-box, so the border comes off first. */
export const WINDOW = {
  width: FRAME.width - 2 * FRAME.border - 2 * FRAME.side,
  height: FRAME.height - 2 * FRAME.border - FRAME.top - FRAME.bottom,
} as const

export const FRAMES = [
  { rotate: -9, x: -74, y: 10, delay: '0s', z: 1, photo: '/not-found/pexels-6942800.webp' },
  { rotate: 7, x: 74, y: 16, delay: '.9s', z: 2, photo: '/not-found/pexels-21939389.webp' },
  // Drawn last and centred, so the front frame of the pile is the one that reads first.
  { rotate: -2, x: 0, y: 0, delay: '.45s', z: 3, photo: '/not-found/pexels-4321802.webp' },
] as const

export type NotFoundFrame = (typeof FRAMES)[number]

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
    background: 'rgba(255, 253, 248, 0.92)',
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
