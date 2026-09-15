import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { FRAME, WINDOW, FRAMES, PILE_HEIGHT, frameStyle, pileExtent, pileScale, windowStyle } from '@/lib/not-found-frames'
import { stripJsComments } from './helpers/source-text'

// THE PHOTOS IN THE 404 PAGE'S FRAMES.
//
// This page is what somebody sees when a link already failed them, so the pile of photos on it may not
// fail loudly too. Every way it goes wrong is silent -- nothing throws, a frame just shows sand, a corner
// of a photo, or the same photo twice:
//   - a path typo, a renamed or deleted file, two frames pointing at one file,
//   - a file that is not whole WebP (cut off mid-upload, or another format renamed),
//   - a file re-exported smaller than the window needs, which is blurry on a phone,
//   - the window losing its cover sizing, its sand colour or its photo,
//   - the page drawing an <img> again, which shows a broken-image icon when a load fails.
// Sizes and photos are IMPORTED from src/lib/not-found-frames.ts; the numbers a person would check by
// eye (the 116 x 113 window, three photos) are written out literally, so the module cannot vouch for itself.

const ROOT = process.cwd()
const MAX_BYTES = 16_000

const fileOf = (photo: string) => join(ROOT, 'public', photo)
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

/**
 * Width and height of a WebP file, or null unless the whole file is structurally sound: the RIFF size
 * matches the length, the chunks end exactly at the end of the file, and the first chunk is a real
 * VP8 (with its start code), VP8L (with its signature) or VP8X header. It does not decode pixels.
 */
function webpInfo(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 20) return null
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return null
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) return null

  let first: { fourcc: string; data: number; size: number } | null = null
  let offset = 12
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return null
    const size = bytes.readUInt32LE(offset + 4)
    const next = offset + 8 + size + (size % 2)
    if (next > bytes.length) return null
    if (!first) first = { fourcc: bytes.toString('ascii', offset, offset + 4), data: offset + 8, size }
    offset = next
  }
  if (!first || offset !== bytes.length) return null

  const d = first.data
  if (first.fourcc === 'VP8 ') {
    if (first.size < 10 || bytes[d + 3] !== 0x9d || bytes[d + 4] !== 0x01 || bytes[d + 5] !== 0x2a) return null
    return { width: bytes.readUInt16LE(d + 6) & 0x3fff, height: bytes.readUInt16LE(d + 8) & 0x3fff }
  }
  if (first.fourcc === 'VP8L') {
    if (first.size < 5 || bytes[d] !== 0x2f) return null
    const bits = bytes.readUInt32LE(d + 1)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (first.fourcc === 'VP8X') {
    if (first.size < 10) return null
    return { width: bytes.readUIntLE(d + 4, 3) + 1, height: bytes.readUIntLE(d + 7, 3) + 1 }
  }
  return null
}

/** A one-chunk WebP file around the given payload, with every length field correct. */
function riff(fourcc: string, payload: Buffer): Buffer {
  const pad = payload.length % 2
  const out = Buffer.alloc(20 + payload.length + pad)
  out.write('RIFF', 0, 'ascii')
  out.writeUInt32LE(out.length - 8, 4)
  out.write('WEBP', 8, 'ascii')
  out.write(fourcc, 12, 'ascii')
  out.writeUInt32LE(payload.length, 16)
  payload.copy(out, 20)
  return out
}

describe('the pile of photos', () => {
  it('has three frames, each with its own photo file under public/not-found/', () => {
    expect(FRAMES).toHaveLength(3)
    for (const { photo } of FRAMES) {
      expect(photo).toMatch(/^\/not-found\/[a-z0-9-]+\.webp$/)
      expect(existsSync(fileOf(photo)), `${photo} is missing from public/`).toBe(true)
    }
  })

  it('shows three different photos, not one file twice', () => {
    const hashes = FRAMES.map(({ photo }) => createHash('sha1').update(readFileSync(fileOf(photo))).digest('hex'))
    expect(new Set(hashes).size).toBe(3)
  })

  it('ships whole WebP files, sharp at 3x the window, the window\'s shape, and small', () => {
    for (const { photo } of FRAMES) {
      const bytes = readFileSync(fileOf(photo))
      const info = webpInfo(bytes)
      expect(info, `${photo} is not a whole WebP file`).not.toBeNull()
      if (!info) continue
      expect(info.width, photo).toBeGreaterThanOrEqual(3 * WINDOW.width)
      expect(info.height, photo).toBeGreaterThanOrEqual(3 * WINDOW.height)
      const shape = info.width / info.height / (WINDOW.width / WINDOW.height)
      expect(Math.abs(shape - 1), `${photo} is not the window's shape`).toBeLessThanOrEqual(0.02)
      expect(statSync(fileOf(photo)).size, photo).toBeLessThanOrEqual(MAX_BYTES)
    }
  })
})

describe('the frame and its window', () => {
  it('leaves a 116 x 113 window: a 132 x 160 border-box frame, less its 1px border and the insets', () => {
    expect(WINDOW).toEqual({ width: 116, height: 113 })
  })

  it('is shaped like a real instant print: a tall card around a near-square picture', () => {
    // Polaroid's published size for I-Type / 600 / SX-70 film (its support article, as quoted in search
    // results), written out here rather than read from the module: a 3.483 x 4.233 in card around a
    // 3.108 x 3.024 in picture. The owner asked for prints that look real, and these two ratios are what
    // a real one is. A picture rounded to square would be 2.7% off and fail: these are Polaroid's own
    // figures, and it is those the test holds.
    const CARD_TALLER_BY = 4.233 / 3.483
    const PICTURE_WIDER_BY = 3.108 / 3.024
    expect(Math.abs(FRAME.height / FRAME.width / CARD_TALLER_BY - 1)).toBeLessThanOrEqual(0.02)
    expect(Math.abs(WINDOW.width / WINDOW.height / PICTURE_WIDER_BY - 1)).toBeLessThanOrEqual(0.02)
    // The thick lip under the picture is what makes a white square read as a print.
    expect(FRAME.bottom).toBeGreaterThanOrEqual(3 * FRAME.top)
  })

  it('draws the frame at exactly the size the window is computed from', () => {
    const s = frameStyle(FRAMES[0])
    expect(s.width).toBe(FRAME.width)
    expect(s.height).toBe(FRAME.height)
    expect(s.boxSizing).toBe('border-box')
    expect(String(s.border).startsWith(`${FRAME.border}px `)).toBe(true)
  })

  it('mounts each print at the centre of the pile, as a solid card', () => {
    const s = frameStyle(FRAMES[0])
    expect(s.position).toBe('absolute')
    expect([s.left, s.top]).toEqual(['50%', '50%'])
    // Without these the whole pile shifts right by half a print, and the right-hand print leaves a phone.
    expect([s.marginLeft, s.marginTop]).toEqual([-FRAME.width / 2, -FRAME.height / 2])
    // The see-through prints could come back this way too, through the photos as well as the lip.
    expect('opacity' in s).toBe(false)
  })

  it('is an opaque card, so a print behind never shows through the one in front', () => {
    // Real prints are card, not tracing paper. At 92% opacity the side photos showed as faint squares
    // through the front print's white lip once the bigger prints overlapped more (screenshot, 2026-09-15).
    expect(String(frameStyle(FRAMES[0]).background)).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })

  it('draws the photo over sand, covering the window, inset exactly as computed', () => {
    const w = windowStyle('/not-found/example.webp')
    expect([w.top, w.right, w.bottom, w.left]).toEqual([FRAME.top, FRAME.side, FRAME.bottom, FRAME.side])
    expect(w.backgroundImage).toBe('url("/not-found/example.webp")')
    expect(w.backgroundSize).toBe('cover')
    expect(w.backgroundPosition).toBe('center')
    expect(String(w.backgroundColor)).toMatch(/^#[0-9A-Fa-f]{6}$/)
    // A `background` shorthand next to the longhands would reset the image.
    expect('background' in w).toBe(false)
  })
})

describe('the 404 page', () => {
  const FRAME_CLASS = 'hush-404-frame'
  // Built from two pieces so this file never contains a block-comment opener of its own.
  const COMMENT_OPEN = '/' + '*'
  const page = () => stripJsComments(readFileSync(join(ROOT, 'src', 'app', 'not-found.tsx'), 'utf8'))

  it('draws every frame from the module, once, with CSS backgrounds and no <img>', () => {
    const text = page()
    expect(text).toContain("from '@/lib/not-found-frames'")
    expect(count(text, 'FRAMES.map(')).toBe(1)
    expect(count(text, `className="${FRAME_CLASS}" style={frameStyle(frame)}`)).toBe(1)
    expect(count(text, 'style={windowStyle(frame.photo)}')).toBe(1)
    expect(text).not.toContain('src={frame.')
    expect(text).not.toContain('photo:')
  })

  it('animates with the same custom properties the frames set', () => {
    const text = page()
    const keys = Object.keys(frameStyle(FRAMES[0])).filter((k) => k.startsWith('--'))
    expect(keys).toEqual(['--x', '--y', '--r'])
    for (const key of keys) expect(text).toContain(`var(${key})`)
  })

  it('holds each print at its tilt and offset when it is not drifting', () => {
    const text = page()
    // A block comment left after stripping can only sit inside the <style> template, where it could
    // answer the checks below while doing nothing.
    expect(text).not.toContain(COMMENT_OPEN)
    expect(count(text, `.${FRAME_CLASS} {`)).toBe(1)
    const start = text.indexOf(`.${FRAME_CLASS} {`)
    // Only up to the rule's own closing brace: the keyframes repeat the same transform.
    const rule = text.slice(start, text.indexOf('}', start))
    expect(rule).toContain('transform: translate(var(--x), var(--y)) rotate(var(--r));')
    const name = (rule.split('animation:')[1] ?? '').trim().split(' ')[0]
    expect(name.length).toBeGreaterThan(0)
    expect(count(text, `@keyframes ${name} {`)).toBe(1)
  })

  it('draws the pile with the height, drift and narrow-screen scale the geometry tests hold', () => {
    const text = page()
    const start = text.indexOf('aria-hidden="true"')
    expect(start).toBeGreaterThan(-1)
    const pile = text.slice(start, text.indexOf('FRAMES.map(', start))
    expect(pile).toContain("position: 'relative'")
    expect(pile).toContain('height: PILE_HEIGHT')
    expect(pile).toContain('className="hush-404-pile"')
    // The margins below are only true of the page if the page draws with these same numbers.
    expect(text).toContain('calc(var(--y) - ${DRIFT.lift}px)')
    expect(text).toContain('rotate(calc(var(--r) * ${DRIFT.tiltKept}))')
    expect(text).toContain('NARROW.map(')
    expect(text).toContain('@media (max-width: ${n.maxWidth}px) { .hush-404-pile { transform: scale(${n.scale}); } }')
  })
})

describe('the pile on a phone', () => {
  // THE WIDTH THAT WAS MISSED. The bigger prints were measured in Chrome at 1280, 390 and 360 px; a review
  // then computed that they reached the screen edge at 320 -- the smallest common phone -- where the page before them had 23 to 25 px each
  // side. Nothing scrolls sideways to warn anyone: base.css clips horizontal
  // overflow on html and body, so a pile too wide for the screen is cut off. A review found it by
  // computing the rotated boxes; this is that computation, held to real widths.
  const MIN_MARGIN = 12
  // EVERY WHOLE WIDTH from 300 to 1280, not a few sample points. With four fixed widths, moving a rule's
  // edge -- 359 down to 320, or 319 down to 300 -- passed every test while the phones between the old edge
  // and the new one had their prints cut off. Below 300 the narrowest rule still leaves about 10 px at
  // 280 px (a folded phone's cover screen), and the pile is only cut below about 259 px.
  it(`leaves at least ${MIN_MARGIN} px each side at every width from 300 to 1280 px, all through the drift`, () => {
    const tight: string[] = []
    for (let width = 300; width <= 1280; width++) {
      const e = pileExtent(pileScale(width))
      const least = Math.min(width / 2 - e.left, width / 2 - e.right)
      if (least < MIN_MARGIN) tight.push(`${width}px: ${least.toFixed(1)} px`)
    }
    expect(tight).toEqual([])
  })

  it('draws the pile smaller only below 360 px, so desktop and ordinary phones keep the full size', () => {
    expect(pileScale(1280)).toBe(1)
    expect(pileScale(390)).toBe(1)
    expect(pileScale(360)).toBe(1)
    expect(pileScale(320)).toBeLessThan(1)
    expect(pileScale(300)).toBeLessThanOrEqual(pileScale(320))
  })

  it('matches Chrome frozen at rest and at the top of the drift, pose by pose', () => {
    // Measured 2026-09-15 at 390 px with every print's animation frozen -- 'animation: none' for rest, a
    // paused -4.5 s delay for the peak -- and the front print's computed transform checked to confirm the
    // pose (rotate -2deg at rest; rotate -1.64deg and 7 px up at the peak), then the frames' bounding boxes
    // read from the pile's centre. The first comparison used a reading taken mid-drift and passed only
    // because 159.8 happened to round to 160, so each pose is now held to its own measurement.
    //
    // The GEOMETRY Chrome was measuring is written out here, not read from the module. These readings then
    // describe one fixed pile for good: a later change to the real sizes cannot make them stale, and
    // cannot tempt anyone to paste the function's own output in as if Chrome had said it.
    const MEASURED = {
      frame: { width: 132, height: 160 },
      frames: [{ x: -84, y: 14, rotate: -9 }, { x: 84, y: 22, rotate: 7 }, { x: 0, y: 0, rotate: -2 }],
      drift: { lift: 7, tiltKept: 0.82 },
    }
    const CHROME = {
      rest: { left: 161.7, right: 159.26, above: 82.25, below: 109.45 },
      peak: { left: 159.73, right: 157.67, above: 88.86, below: 101.2 },
    }
    for (const pose of ['rest', 'peak'] as const) {
      const e = pileExtent(1, pose, MEASURED)
      for (const side of ['left', 'right', 'above', 'below'] as const) {
        expect(Math.abs(e[side] - CHROME[pose][side]), `${pose} ${side}`).toBeLessThanOrEqual(0.05)
      }
    }
  })

  it('keeps the prints inside their box above, and at most a few px into the gap below, lift included', () => {
    // Under the pile come its own 4 px margin and gap-8's 32 px before the "404" label: 36 px. The right
    // print's lowest corner sits 3.45 px below the box at rest; more than 8 px would start closing on the
    // text. The highest point is the front print at the top of its lift, and the worst case must be the
    // larger of the two poses on EVERY side -- with the peak left out, the lift could grow into the logo
    // and nothing here would notice.
    const e = pileExtent(1)
    const rest = pileExtent(1, 'rest')
    const peak = pileExtent(1, 'peak')
    for (const side of ['left', 'right', 'above', 'below'] as const) {
      expect(e[side], side).toBe(Math.max(rest[side], peak[side]))
    }
    expect(e.above).toBeLessThanOrEqual(PILE_HEIGHT / 2)
    expect(e.below - PILE_HEIGHT / 2).toBeLessThanOrEqual(8)
    expect(PILE_HEIGHT).toBeGreaterThanOrEqual(FRAME.height)
  })
})

describe('webpInfo', () => {
  it('reads a lossy header with its start code', () => {
    const payload = Buffer.alloc(10)
    payload[3] = 0x9d
    payload[4] = 0x01
    payload[5] = 0x2a
    payload.writeUInt16LE(270, 6)
    payload.writeUInt16LE(255, 8)
    expect(webpInfo(riff('VP8 ', payload))).toEqual({ width: 270, height: 255 })
  })

  it('refuses a lossy chunk without its start code', () => {
    const payload = Buffer.alloc(10)
    payload.writeUInt16LE(270, 6)
    payload.writeUInt16LE(255, 8)
    expect(webpInfo(riff('VP8 ', payload))).toBeNull()
  })

  it('reads a lossless header, which stores each side minus one in 14 bits', () => {
    const payload = Buffer.alloc(5)
    payload[0] = 0x2f
    payload.writeUInt32LE((270 - 1) | ((255 - 1) << 14), 1)
    expect(webpInfo(riff('VP8L', payload))).toEqual({ width: 270, height: 255 })
  })

  it('reads an extended header, which stores each side minus one in 3 bytes', () => {
    const payload = Buffer.alloc(10)
    payload.writeUIntLE(270 - 1, 4, 3)
    payload.writeUIntLE(255 - 1, 7, 3)
    expect(webpInfo(riff('VP8X', payload))).toEqual({ width: 270, height: 255 })
  })

  it('refuses a real photo cut off partway, even with its header intact', () => {
    const whole = readFileSync(fileOf(FRAMES[2].photo))
    expect(webpInfo(whole)).not.toBeNull()
    expect(webpInfo(whole.subarray(0, 4000))).toBeNull()
  })

  it('refuses a file that is not WebP', () => {
    expect(webpInfo(readFileSync(join(ROOT, 'public', 'logo', 'logo-dark-transparent.png')))).toBeNull()
  })
})
