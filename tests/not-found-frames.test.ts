import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { FRAME, WINDOW, FRAMES, frameStyle, windowStyle } from '@/lib/not-found-frames'
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
// eye (the 88 x 83 window, three photos) are written out literally, so the module cannot vouch for itself.

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
  it('leaves an 88 x 83 window: a 108 x 118 border-box frame, less its 1px border and the insets', () => {
    expect(WINDOW).toEqual({ width: 88, height: 83 })
  })

  it('draws the frame at exactly the size the window is computed from', () => {
    const s = frameStyle(FRAMES[0])
    expect(s.width).toBe(FRAME.width)
    expect(s.height).toBe(FRAME.height)
    expect(s.boxSizing).toBe('border-box')
    expect(String(s.border).startsWith(`${FRAME.border}px `)).toBe(true)
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

  it('gives the pile a box at least one print tall, so the prints stay off the logo and heading', () => {
    const text = page()
    const start = text.indexOf('aria-hidden="true"')
    expect(start).toBeGreaterThan(-1)
    const pile = text.slice(start, text.indexOf('FRAMES.map(', start))
    expect(pile).toContain("position: 'relative'")
    const at = pile.indexOf('height: ')
    expect(at).toBeGreaterThan(-1)
    expect(Number.parseInt(pile.slice(at + 'height: '.length), 10)).toBeGreaterThanOrEqual(FRAME.height)
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
