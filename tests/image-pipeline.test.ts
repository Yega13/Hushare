import { describe, it, expect, vi } from 'vitest'
import { createImagePipeline, type PipelineDeps } from '@/lib/upload/image-pipeline'

// THE DECISIONS MADE ABOUT SOMEBODY'S PHOTO BEFORE IT LEAVES THEIR PHONE.
//
// Until this file, none of it ran under test: whether a photo is kept exactly as shot or re-encoded,
// whether its location is removed, how far it shrinks, what a HEIC becomes, and what happens to a
// file the device will display but not hand over. Every failure it guards against is silent -- a
// photo stored sideways, stored with the guest's GPS position, stored as PNG bytes under a .webp
// name, or never stored at all -- so each is asserted on the bytes and labels that come out.
//
// The browser is faked (deps); exif, upload-policy and media are REAL, so the tests run the actual
// rules (rule 17). Numbers are written as numbers, not read from the constants the code reads.

const CAP = 25 * 1024 * 1024
const MAX = 3500

type FakeBitmap = ImageBitmap & { close: ReturnType<typeof vi.fn> }
const bitmap = (width: number, height: number) => ({ width, height, close: vi.fn() }) as unknown as FakeBitmap

type Encode = { source: unknown; w: number; h: number; mime: string; quality: number }

function rig(over: Partial<PipelineDeps> = {}, sizeFor: (w: number, h: number) => number = () => 10) {
  const encodes: Encode[] = []
  const resized: FakeBitmap[] = []
  const deps: PipelineDeps = {
    bitmapToBlob: vi.fn(async (source: CanvasImageSource, w: number, h: number, mime: string, quality: number) => {
      encodes.push({ source, w, h, mime, quality })
      return new Blob([new Uint8Array(sizeFor(w, h))], { type: mime })
    }),
    resizeBitmap: vi.fn(async (_b: ImageBitmap, w: number, h: number) => {
      const r = bitmap(w, h)
      resized.push(r)
      return r
    }),
    decodeImageSource: vi.fn(async () => null),
    decodeBitmapSafe: vi.fn(async () => null),
    convertHeicViaWorker: vi.fn(async () => { throw new Error('worker unavailable in this test') }),
    convertHeicMainThread: vi.fn(async () => { throw new Error('converter unavailable in this test') }),
    readBytes: vi.fn(async (b: Blob) => b.arrayBuffer()),
    createObjectURL: vi.fn(() => 'blob:fake-url'),
    revokeObjectURL: vi.fn(),
    loadImageElement: vi.fn(async () => { throw new Error('img element load failed') }),
    acquireDecode: vi.fn(async () => () => {}),
    ...over,
  }
  const pipeline = createImagePipeline(deps)
  return { deps, encodes, resized, run: (file: File, cap = CAP, maxDim = MAX) => pipeline.processImage(file, cap, maxDim) }
}

// ── byte fixtures, built to what lib/exif actually parses ─────────────────────────────────────────

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer())
function contains(hay: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}
const APP1 = [0xff, 0xe1]
const GPS = ascii('GPS')

/** A JPEG with an APP1/EXIF segment carrying an orientation tag and the letters GPS, or none. */
function jpeg(orientation: number | null): Uint8Array<ArrayBuffer> {
  const out = [0xff, 0xd8]
  if (orientation !== null) {
    const body = [
      ...ascii('Exif'), 0, 0,
      0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, // little-endian TIFF header, IFD at offset 8
      1, 0, // one entry
      0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, // 0x0112 Orientation, SHORT
      0, 0, 0, 0,
      ...GPS,
    ]
    const len = body.length + 2
    out.push(0xff, 0xe1, len >> 8, len & 0xff, ...body)
  }
  out.push(0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6, 0xff, 0xd9)
  return new Uint8Array(out)
}

function pngChunk(type: string, data: number[]) {
  const n = data.length
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...ascii(type), ...data, 0, 0, 0, 0]
}
function png(withMetadata: boolean): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk('IHDR', new Array(13).fill(0)),
    ...(withMetadata ? pngChunk('tEXt', [...GPS, ...ascii(' 40.18 44.51')]) : []),
    ...pngChunk('IEND', []),
  ])
}

function webpChunk(type: string, data: number[]) {
  const n = data.length
  return [...ascii(type), n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255, ...data, ...(n % 2 ? [0] : [])]
}
function webp(withMetadata: boolean): Uint8Array<ArrayBuffer> {
  const body = [...ascii('WEBP'), ...webpChunk('VP8 ', [1, 2, 3, 4]), ...(withMetadata ? webpChunk('EXIF', [...GPS, 0x34, 0x30, 0x2e]) : [])]
  const n = body.length
  return new Uint8Array([...ascii('RIFF'), n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255, ...body])
}

const file = (bytes: Uint8Array<ArrayBuffer> | number, name: string, type: string) =>
  new File([typeof bytes === 'number' ? new Uint8Array(bytes) : bytes], name, { type })
/**
 * The same File, reporting exactly `type`. The File constructor lowercases its type option, so
 * 'image/HEIC' passed to it never reaches the code -- the review of ccb9b1d found a test passing for
 * that reason. A picked file's type is whatever the browser reports, so the code must not rely on it.
 */
const withType = (f: File, type: string) => Object.defineProperty(f, 'type', { value: type }) as File
const reject = (message: string) => vi.fn(async () => { throw new Error(message) })
const onlyThumbs = (encodes: Encode[]) => encodes.every((e) => e.quality === 0.85)

describe('the decode slot', () => {
  it('is taken before the photo is decoded and given back after', async () => {
    const events: string[] = []
    const r = rig({
      acquireDecode: vi.fn(async () => { events.push('acquire'); return () => { events.push('release') } }),
      decodeBitmapSafe: vi.fn(async () => { events.push('decode'); return bitmap(100, 100) }),
    })
    await r.run(file(jpeg(1), 'a.jpg', 'image/jpeg'))
    expect(events).toEqual(['acquire', 'decode', 'release'])
  })

  it('is given back when processing throws -- otherwise two failures lock every later photo out', async () => {
    const released = vi.fn()
    const r = rig({ acquireDecode: vi.fn(async () => released) })
    await expect(r.run(file(10, 'scan.tiff', 'image/tiff'))).rejects.toThrow('Unsupported image format')
    expect(released).toHaveBeenCalledTimes(1)
  })
})

describe('a JPEG that fits', () => {
  it('goes up as its own pixels with the location segment removed -- never re-encoded', async () => {
    const bm = bitmap(3000, 2000)
    const r = rig({ decodeBitmapSafe: vi.fn(async () => bm) })
    const out = await r.run(file(jpeg(1), 'IMG_1.jpg', 'image/jpeg'))
    const bytes = await bytesOf(out.blob)
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8])
    expect(contains(bytes, APP1), 'the EXIF segment survived').toBe(false)
    expect(contains(bytes, GPS), 'the location survived').toBe(false)
    expect(out).toMatchObject({ mimeType: 'image/jpeg', name: 'IMG_1.jpg', width: 3000, height: 2000 })
    // One encode only: the 600px grid thumbnail, at 0.85, through the high-quality resample.
    expect(r.encodes).toEqual([{ source: r.resized[0], w: 600, h: 400, mime: 'image/jpeg', quality: 0.85 }])
    expect(out.thumbBlob).not.toBeNull()
    expect(bm.close).toHaveBeenCalledTimes(1)
    expect(r.resized[0].close).toHaveBeenCalledTimes(1)
  })

  it('image/jpg is the same format and takes the same path', async () => {
    const r = rig({ decodeBitmapSafe: vi.fn(async () => bitmap(800, 600)) })
    const out = await r.run(file(jpeg(1), 'a.jpg', 'image/jpg'))
    expect(contains(await bytesOf(out.blob), APP1)).toBe(false)
    expect(out.mimeType).toBe('image/jpeg')
  })

  it('a JPEG that displays ROTATED is re-encoded at 0.92 -- stripping the tag would store it sideways', async () => {
    const bm = bitmap(3000, 2000)
    const r = rig({ decodeBitmapSafe: vi.fn(async () => bm) })
    const out = await r.run(file(jpeg(6), 'IMG_2.jpg', 'image/jpeg'))
    expect(r.encodes).toContainEqual({ source: bm, w: 3000, h: 2000, mime: 'image/jpeg', quality: 0.92 })
    expect(out).toMatchObject({ mimeType: 'image/jpeg', name: 'IMG_2.jpg', width: 3000, height: 2000 })
    expect(out.blob.size).toBe(10) // the encoder's output, not the original bytes
    expect(bm.close).toHaveBeenCalledTimes(1)
  })

  it('bytes that vanish after the decode are re-encoded from the bitmap in hand, not lost', async () => {
    const bm = bitmap(3000, 2000)
    const r = rig({ decodeBitmapSafe: vi.fn(async () => bm), readBytes: reject('NotReadableError') })
    const out = await r.run(file(jpeg(1), 'IMG_3.jpg', 'image/jpeg'))
    expect(r.encodes).toContainEqual({ source: bm, w: 3000, h: 2000, mime: 'image/jpeg', quality: 0.92 })
    expect(out).toMatchObject({ mimeType: 'image/jpeg', name: 'IMG_3.jpg', width: 3000, height: 2000 })
  })

  it('a thumbnail that fails costs the grid its thumbnail, not the guest their photo', async () => {
    const r = rig({
      decodeBitmapSafe: vi.fn(async () => bitmap(3000, 2000)),
      bitmapToBlob: vi.fn(async (_s: CanvasImageSource, _w: number, _h: number, mime: string, quality: number) => {
        if (quality === 0.85) throw new Error('encode failed')
        return new Blob([new Uint8Array(5)], { type: mime })
      }),
    })
    const out = await r.run(file(jpeg(6), 'IMG_4.jpg', 'image/jpeg'))
    expect(out.thumbBlob).toBeNull()
    expect(out.blob.size).toBe(5)
  })
})

describe('too big', () => {
  it('a long edge over 3500px is brought to 3500 through the high-quality resample', async () => {
    const bm = bitmap(7000, 3500)
    const r = rig({ decodeBitmapSafe: vi.fn(async () => bm) })
    const out = await r.run(file(jpeg(1), 'big.jpg', 'image/jpeg'))
    expect(r.deps.resizeBitmap).toHaveBeenCalledWith(bm, 3500, 1750)
    expect(r.encodes).toContainEqual({ source: r.resized[1], w: 3500, h: 1750, mime: 'image/jpeg', quality: 0.92 })
    expect(out).toMatchObject({ mimeType: 'image/jpeg', name: 'big.jpg', width: 3500, height: 1750 })
    expect(out.thumbBlob).not.toBeNull()
    for (const x of [bm, ...r.resized]) expect(x.close).toHaveBeenCalledTimes(1)
  })

  it('where the resample is refused, the original bitmap is drawn at the same size instead', async () => {
    const bm = bitmap(7000, 3500)
    const r = rig({ decodeBitmapSafe: vi.fn(async () => bm), resizeBitmap: reject('resize options unsupported') })
    const out = await r.run(file(jpeg(1), 'big.jpg', 'image/jpeg'))
    expect(r.encodes).toEqual([
      { source: bm, w: 600, h: 300, mime: 'image/jpeg', quality: 0.85 },
      { source: bm, w: 3500, h: 1750, mime: 'image/jpeg', quality: 0.92 },
    ])
    expect(out.width).toBe(3500)
  })

  it('a resized bitmap is released even when encoding it fails -- 48 MP decodes exhaust a phone', async () => {
    const r = rig({ decodeBitmapSafe: vi.fn(async () => bitmap(7000, 3500)), bitmapToBlob: reject('out of memory') })
    await expect(r.run(file(jpeg(1), 'big.jpg', 'image/jpeg'))).rejects.toThrow('out of memory')
    expect(r.resized.length).toBeGreaterThan(0)
    for (const x of r.resized) expect(x.close).toHaveBeenCalledTimes(1)
  })

  it('never produces a zero-pixel side, however thin the image', async () => {
    const r = rig({ decodeBitmapSafe: vi.fn(async () => bitmap(10000, 1)) })
    const out = await r.run(file(jpeg(1), 'strip.jpg', 'image/jpeg'))
    expect(out).toMatchObject({ width: 3500, height: 1 })
  })

  it('a TALL photo is judged on its long edge too -- a portrait over 3500px is brought down', async () => {
    const bm = bitmap(3500, 7000)
    const r = rig({ decodeBitmapSafe: vi.fn(async () => bm) })
    const out = await r.run(file(jpeg(1), 'tall.jpg', 'image/jpeg'))
    expect(r.deps.resizeBitmap).toHaveBeenCalledWith(bm, 1750, 3500)
    expect(out).toMatchObject({ width: 1750, height: 3500 })
  })

  it('walks 3500 -> 2560 and STOPS at the first size under the album cap', async () => {
    const sizes: Record<number, number> = { 3500: 2_000_000, 2560: 900_000, 1920: 500_000 }
    const r = rig({ decodeBitmapSafe: vi.fn(async () => bitmap(7000, 7000)) }, (w) => sizes[w] ?? 100)
    const out = await r.run(file(jpeg(1), 'big.jpg', 'image/jpeg'), 1_000_000)
    expect(r.encodes.filter((e) => e.quality === 0.92).map((e) => e.w)).toEqual([3500, 2560])
    expect(out.width).toBe(2560)
  })

  it('uses the last rung when nothing fits -- a smaller photo beats a refused one', async () => {
    const sizes: Record<number, number> = { 3500: 2_000_000, 2560: 1_500_000, 1920: 1_200_000 }
    const r = rig({ decodeBitmapSafe: vi.fn(async () => bitmap(7000, 7000)) }, (w) => sizes[w] ?? 100)
    const out = await r.run(file(jpeg(1), 'big.jpg', 'image/jpeg'), 1_000_000)
    expect(r.encodes.filter((e) => e.quality === 0.92).map((e) => e.w)).toEqual([3500, 2560, 1920])
    expect(out.width).toBe(1920)
  })

  it('a PNG is re-encoded AS PNG, so a transparent background does not turn black', async () => {
    const r = rig({ decodeBitmapSafe: vi.fn(async () => bitmap(7000, 7000)) })
    const out = await r.run(file(png(false), 'logo.png', 'image/png'))
    expect(r.encodes.filter((e) => e.quality === 0.92).map((e) => e.mime)).toEqual(['image/png'])
    expect(out).toMatchObject({ mimeType: 'image/png', name: 'logo.png' })
  })

  it('is labelled with what the encoder PRODUCED: a WebP that came out as PNG is stored as PNG', async () => {
    const r = rig({
      decodeBitmapSafe: vi.fn(async () => bitmap(7000, 7000)),
      bitmapToBlob: vi.fn(async () => new Blob([new Uint8Array(10)], { type: 'image/png' })),
    })
    const out = await r.run(file(webp(false), 'shot.webp', 'image/webp'))
    expect(out).toMatchObject({ mimeType: 'image/png', name: 'shot.png' })
  })

  it('an encoder that reports no type is labelled with what was asked for', async () => {
    const r = rig({
      decodeBitmapSafe: vi.fn(async () => bitmap(7000, 7000)),
      bitmapToBlob: vi.fn(async () => new Blob([new Uint8Array(10)])),
    })
    const out = await r.run(file(webp(false), 'shot.webp', 'image/webp'))
    expect(out).toMatchObject({ mimeType: 'image/webp', name: 'shot.webp' })
  })

  it('an encoder type the server would refuse is not trusted as the label', async () => {
    const r = rig({
      decodeBitmapSafe: vi.fn(async () => bitmap(7000, 7000)),
      bitmapToBlob: vi.fn(async () => new Blob([new Uint8Array(10)], { type: 'image/bmp' })),
    })
    const out = await r.run(file(webp(false), 'shot.webp', 'image/webp'))
    expect(out).toMatchObject({ mimeType: 'image/webp', name: 'shot.webp' })
  })
})

describe('a PNG or WebP that fits', () => {
  it('a PNG keeps its pixels and loses its text metadata', async () => {
    const bm = bitmap(800, 600)
    const r = rig({ decodeBitmapSafe: vi.fn(async () => bm) })
    const original = png(true)
    const out = await r.run(file(original, 'map.png', 'image/png'))
    const bytes = await bytesOf(out.blob)
    expect(contains(bytes, ascii('tEXt'))).toBe(false)
    expect(contains(bytes, GPS)).toBe(false)
    expect(contains(bytes, ascii('IHDR'))).toBe(true)
    expect(out).toMatchObject({ mimeType: 'image/png', name: 'map.png', width: 800, height: 600 })
    expect(out.thumbBlob).not.toBeNull()
    expect(out.blob.type).toBe('image/png')
    expect(onlyThumbs(r.encodes)).toBe(true)
    expect(bm.close).toHaveBeenCalledTimes(1)
  })

  it('a PNG with nothing to remove goes up as the very same file', async () => {
    const r = rig({ decodeBitmapSafe: vi.fn(async () => bitmap(800, 600)) })
    const f = file(png(false), 'plain.png', 'image/png')
    expect((await r.run(f)).blob).toBe(f)
  })

  it('a WebP loses its EXIF chunk', async () => {
    const r = rig({ decodeBitmapSafe: vi.fn(async () => bitmap(800, 600)) })
    const out = await r.run(file(webp(true), 'x.webp', 'image/webp'))
    const bytes = await bytesOf(out.blob)
    expect(contains(bytes, ascii('EXIF'))).toBe(false)
    expect(contains(bytes, GPS)).toBe(false)
    expect(out.mimeType).toBe('image/webp')
  })

  it('unreadable after decode: re-encoded in its own format, labelled by what came out', async () => {
    const png2 = rig({ decodeBitmapSafe: vi.fn(async () => bitmap(800, 600)), readBytes: reject('NotReadableError') })
    const outPng = await png2.run(file(png(true), 'a.png', 'image/png'))
    expect(png2.encodes).toContainEqual(expect.objectContaining({ w: 800, h: 600, mime: 'image/png', quality: 0.92 }))
    expect(outPng).toMatchObject({ mimeType: 'image/png', name: 'a.png' })

    const webp2 = rig({
      decodeBitmapSafe: vi.fn(async () => bitmap(800, 600)),
      readBytes: reject('NotReadableError'),
      bitmapToBlob: vi.fn(async (_s: CanvasImageSource, _w: number, _h: number, mime: string) =>
        new Blob([new Uint8Array(10)], { type: mime === 'image/webp' ? 'image/png' : mime })),
    })
    const outWebp = await webp2.run(file(webp(true), 'b.webp', 'image/webp'))
    expect(webp2.deps.bitmapToBlob).toHaveBeenCalledWith(expect.anything(), 800, 600, 'image/webp', 0.92)
    expect(outWebp).toMatchObject({ mimeType: 'image/png', name: 'b.png' })
  })

  it('an unreadable WebP whose re-encode IS WebP keeps its .webp name', async () => {
    const r = rig({ decodeBitmapSafe: vi.fn(async () => bitmap(800, 600)), readBytes: reject('NotReadableError') })
    const out = await r.run(file(webp(true), 'c.webp', 'image/webp'))
    expect(out).toMatchObject({ mimeType: 'image/webp', name: 'c.webp' })
  })
})

describe('formats the server will not store', () => {
  it('a decodable AVIF is converted to JPEG rather than refused', async () => {
    const r = rig({ decodeBitmapSafe: vi.fn(async () => bitmap(800, 600)) })
    const out = await r.run(file(10, 'photo.avif', 'image/avif'))
    expect(r.encodes).toContainEqual(expect.objectContaining({ w: 800, h: 600, mime: 'image/jpeg', quality: 0.92 }))
    expect(out).toMatchObject({ mimeType: 'image/jpeg', name: 'photo.jpg', width: 800, height: 600 })
  })

  it('an undecodable TIFF is refused before any upload, in words the classifiers read as a refusal', async () => {
    const r = rig()
    await expect(r.run(file(10, 'scan.tiff', 'image/tiff'))).rejects.toThrow(
      new Error('Unsupported image format. Please upload JPEG, PNG, HEIC, WebP or GIF.'),
    )
    expect(r.encodes).toEqual([])
  })
})

describe('will not decode, but displays', () => {
  const img = (naturalWidth: number, naturalHeight: number) =>
    vi.fn(async () => ({ naturalWidth, naturalHeight }) as unknown as HTMLImageElement)

  it('is redrawn through an <img> into fresh bytes, as JPEG, and the object URL is released', async () => {
    const r = rig({ loadImageElement: img(4000, 3000) })
    const out = await r.run(file(jpeg(1), 'IMG_5.jpeg', 'image/jpeg'))
    expect(r.deps.loadImageElement).toHaveBeenCalledWith('blob:fake-url')
    expect(r.encodes.map(({ w, h, mime, quality }) => ({ w, h, mime, quality }))).toEqual([
      { w: 600, h: 450, mime: 'image/jpeg', quality: 0.85 },
      { w: 3500, h: 2625, mime: 'image/jpeg', quality: 0.92 },
    ])
    expect(out).toMatchObject({ mimeType: 'image/jpeg', name: 'IMG_5.jpg', width: 3500, height: 2625 })
    expect(r.deps.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
  })

  it('a PNG redrawn this way stays PNG', async () => {
    const r = rig({ loadImageElement: img(800, 600) })
    const out = await r.run(file(png(false), 'art.png', 'image/png'))
    // And at its own size: this path must never ENLARGE an 800px image to the 3500px limit.
    expect(out).toMatchObject({ mimeType: 'image/png', name: 'art.png', width: 800, height: 600 })
  })

  it('a type written in capitals is still recognised as PNG on this path', async () => {
    const r = rig({ loadImageElement: img(800, 600) })
    const out = await r.run(withType(file(png(false), 'art.png', ''), 'IMAGE/PNG'))
    expect(out.mimeType).toBe('image/png')
  })

  it('its thumbnail failing does not lose the photo', async () => {
    const r = rig({
      loadImageElement: img(800, 600),
      bitmapToBlob: vi.fn(async (_s: CanvasImageSource, _w: number, _h: number, mime: string, quality: number) => {
        if (quality === 0.85) throw new Error('encode failed')
        return new Blob([new Uint8Array(7)], { type: mime })
      }),
    })
    const out = await r.run(file(jpeg(1), 'a.jpg', 'image/jpeg'))
    expect(out.thumbBlob).toBeNull()
    expect(out.blob.size).toBe(7)
  })

  it('an <img> that reports no size is not trusted, and the URL is still released', async () => {
    const r = rig({ loadImageElement: img(0, 600) })
    const out = await r.run(file(jpeg(1), 'a.jpg', 'image/jpeg'))
    expect(r.encodes).toEqual([])
    expect(out.width).toBeNull()
    expect(r.deps.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
  })
})

describe('will not decode, will not display', () => {
  it('a JPEG goes up untouched except for its location segment', async () => {
    const r = rig()
    const out = await r.run(file(jpeg(1), 'a.jpg', 'image/jpeg'))
    expect(contains(await bytesOf(out.blob), GPS)).toBe(false)
    expect(out).toMatchObject({ thumbBlob: null, mimeType: 'image/jpeg', name: 'a.jpg', width: null, height: null })
    expect(out.blob.type).toBe('image/jpeg')
  })

  it('image/jpg is stripped the same way on this path -- its location does not survive either', async () => {
    const r = rig()
    const out = await r.run(file(jpeg(1), 'a.jpg', 'image/jpg'))
    expect(contains(await bytesOf(out.blob), GPS)).toBe(false)
  })

  it('and when even its bytes cannot be read, the original File goes up -- the PUT is another read path', async () => {
    const r = rig({ readBytes: reject('NotReadableError') })
    const f = file(jpeg(1), 'a.jpg', 'image/jpeg')
    expect((await r.run(f)).blob).toBe(f)
  })

  it('a PNG goes up as itself', async () => {
    const r = rig()
    const f = file(png(false), 'a.png', 'image/png')
    const out = await r.run(f)
    expect(out.blob).toBe(f)
    expect(out.mimeType).toBe('image/png')
  })

  it('a file with no type at all is treated as a JPEG', async () => {
    const r = rig()
    const out = await r.run(file(jpeg(1), 'noext', ''))
    expect(out.mimeType).toBe('image/jpeg')
    expect(contains(await bytesOf(out.blob), GPS)).toBe(false)
  })
})

describe('GIF', () => {
  it('is NEVER re-encoded -- a canvas would flatten the animation -- and gets a first-frame thumbnail', async () => {
    const bm = bitmap(1200, 800)
    const r = rig({ decodeBitmapSafe: vi.fn(async () => bm) })
    const f = file(10, 'party.gif', 'image/gif')
    const out = await r.run(f)
    expect(out.blob).toBe(f)
    expect(r.encodes).toEqual([{ source: r.resized[0], w: 600, h: 400, mime: 'image/jpeg', quality: 0.85 }])
    expect(out).toMatchObject({ mimeType: 'image/gif', name: 'party.gif', width: 1200, height: 800 })
    expect(bm.close).toHaveBeenCalledTimes(1)
  })

  it('still goes up when it will not decode', async () => {
    const r = rig()
    const f = file(10, 'party.gif', 'image/gif')
    expect(await r.run(f)).toEqual({ blob: f, thumbBlob: null, mimeType: 'image/gif', name: 'party.gif', width: null, height: null })
  })

  it('is never re-encoded EVEN WHEN it is over the size limit that shrinks every other format', async () => {
    // Without this, a missing GIF branch passes the small-GIF test above: a small GIF falls through
    // to the metadata strip, which leaves unrecognised bytes alone and hands back the same File.
    const r = rig({ decodeBitmapSafe: vi.fn(async () => bitmap(4000, 4000)) })
    const f = file(10, 'huge.gif', 'image/gif')
    const out = await r.run(f)
    expect(out.blob).toBe(f)
    expect(out.mimeType).toBe('image/gif')
    expect(onlyThumbs(r.encodes)).toBe(true)
  })

  it('a type written in capitals is still a GIF, and still never re-encoded', async () => {
    const r = rig({ decodeBitmapSafe: vi.fn(async () => bitmap(4000, 4000)) })
    const f = withType(file(10, 'x.gif', ''), 'IMAGE/GIF')
    const out = await r.run(f)
    expect(out.blob).toBe(f)
    expect(out.mimeType).toBe('image/gif')
  })
})

describe('HEIC', () => {
  const small = () => new Blob([jpeg(1)], { type: 'image/jpeg' })

  it('is recognised by type or by extension, in any case, and only a HEIC extension becomes .jpg', async () => {
    for (const [name, type, expected] of [
      ['IMG_1.HEIC', '', 'IMG_1.jpg'],
      ['IMG_2.heif', '', 'IMG_2.jpg'],
      ['photo', 'image/heif', 'photo'],
      ['photo', 'image/HEIC', 'photo'],
      ['photo.jpeg', 'image/heic', 'photo.jpeg'],
    ] as const) {
      const r = rig({ decodeImageSource: vi.fn(async () => bitmap(800, 600)) })
      const out = await r.run(withType(file(10, name, ''), type))
      expect(r.deps.decodeImageSource, name).toHaveBeenCalledTimes(1)
      expect(out.name, name).toBe(expected)
      expect(out.mimeType, name).toBe('image/jpeg')
    }
  })

  it('decoded natively: encoded straight to JPEG at 0.92, the converter never loaded', async () => {
    const bm = bitmap(4032, 3024)
    const r = rig({ decodeImageSource: vi.fn(async () => bm) })
    const out = await r.run(file(10, 'IMG.HEIC', 'image/heic'))
    expect(r.encodes).toContainEqual({ source: r.resized[1], w: 3500, h: 2625, mime: 'image/jpeg', quality: 0.92 })
    expect(out).toMatchObject({ width: 3500, height: 2625 })
    expect(out.thumbBlob, 'without it the grid downloads the full photo').not.toBeNull()
    expect(r.deps.convertHeicViaWorker).not.toHaveBeenCalled()
    expect(r.deps.convertHeicMainThread).not.toHaveBeenCalled()
    expect(bm.close).toHaveBeenCalledTimes(1)
  })

  it('a native bitmap is released even when its encode fails', async () => {
    const bm = bitmap(800, 600)
    const r = rig({ decodeImageSource: vi.fn(async () => bm), bitmapToBlob: reject('out of memory') })
    await expect(r.run(file(10, 'IMG.HEIC', 'image/heic'))).rejects.toThrow('out of memory')
    expect(bm.close).toHaveBeenCalledTimes(1)
  })

  it('the worker converts first; the main thread is tried only when the worker fails', async () => {
    const ok = rig({ convertHeicViaWorker: vi.fn(async () => small()), decodeBitmapSafe: vi.fn(async () => bitmap(800, 600)) })
    await ok.run(file(10, 'IMG.HEIC', 'image/heic'))
    expect(ok.deps.convertHeicMainThread).not.toHaveBeenCalled()

    const crashed = rig({ convertHeicMainThread: vi.fn(async () => small()), decodeBitmapSafe: vi.fn(async () => bitmap(800, 600)) })
    const out = await crashed.run(file(10, 'IMG.HEIC', 'image/heic'))
    expect(crashed.deps.convertHeicMainThread).toHaveBeenCalledTimes(1)
    expect(out.name).toBe('IMG.jpg')
  })

  const FRIENDLY = 'This browser cannot convert iPhone photo files (HEIC). Ask for the photo as a JPEG, or add it from an iPhone.'

  it('a CSP that refuses the converter gets a sentence a guest can act on, not a policy dump', async () => {
    const r = rig({ convertHeicMainThread: reject("Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source") })
    await expect(r.run(file(10, 'IMG.HEIC', 'image/heic'))).rejects.toThrow(new Error(FRIENDLY))
  })

  it('is classified on the error NAME: an EvalError whose message says nothing about CSP', async () => {
    const e = new Error('call to Function() was stopped')
    e.name = 'EvalError'
    const r = rig({ convertHeicMainThread: vi.fn(async () => { throw e }) })
    await expect(r.run(file(10, 'IMG.HEIC', 'image/heic'))).rejects.toThrow(new Error(FRIENDLY))
  })

  it('any other converter failure says so with the message -- and never the error name', async () => {
    const r = rig({ convertHeicMainThread: vi.fn(async () => { throw new TypeError('memory access out of bounds') }) })
    await expect(r.run(file(10, 'IMG.HEIC', 'image/heic'))).rejects.toThrow(new Error('HEIC conversion failed: memory access out of bounds'))
  })

  it('a converted JPEG that will not decode goes up as converted, location removed, no size claimed', async () => {
    const r = rig({ convertHeicViaWorker: vi.fn(async () => small()) })
    const out = await r.run(file(10, 'IMG.HEIC', 'image/heic'))
    expect(contains(await bytesOf(out.blob), GPS)).toBe(false)
    expect(out).toMatchObject({ thumbBlob: null, mimeType: 'image/jpeg', name: 'IMG.jpg', width: null, height: null })
  })

  it('re-encodes a conversion OVER 2 MB, even for an album that would accept it', async () => {
    const bm = bitmap(3000, 2000)
    const r = rig({ convertHeicViaWorker: vi.fn(async () => new Blob([new Uint8Array(2_097_153)], { type: 'image/jpeg' })), decodeBitmapSafe: vi.fn(async () => bm) })
    const out = await r.run(file(10, 'IMG.HEIC', 'image/heic'), CAP)
    expect(r.encodes).toContainEqual({ source: bm, w: 3000, h: 2000, mime: 'image/jpeg', quality: 0.92 })
    expect(out.blob.size).toBe(10)
    expect(bm.close).toHaveBeenCalledTimes(1)
  })

  it('keeps a conversion of exactly 2 MB or less, even for an album whose cap it exceeds', async () => {
    for (const size of [2_097_152, 60]) {
      const bm = bitmap(3000, 2000)
      const r = rig({ convertHeicViaWorker: vi.fn(async () => new Blob([size === 60 ? jpeg(1) : new Uint8Array(size)], { type: 'image/jpeg' })), decodeBitmapSafe: vi.fn(async () => bm) })
      const out = await r.run(file(10, 'IMG.HEIC', 'image/heic'), 10)
      expect(onlyThumbs(r.encodes), String(size)).toBe(true)
      expect(out, String(size)).toMatchObject({ width: 3000, height: 2000, name: 'IMG.jpg' })
      expect(out.thumbBlob, String(size)).not.toBeNull()
      expect(bm.close).toHaveBeenCalledTimes(1)
    }
  })

  it('re-encodes a small conversion whose long edge is over the limit', async () => {
    const r = rig({ convertHeicViaWorker: vi.fn(async () => small()), decodeBitmapSafe: vi.fn(async () => bitmap(5000, 3000)) })
    const out = await r.run(file(10, 'IMG.HEIC', 'image/heic'))
    expect(out).toMatchObject({ width: 3500, height: 2100 })
  })

  it('and judges a TALL conversion on its long edge', async () => {
    const r = rig({ convertHeicViaWorker: vi.fn(async () => small()), decodeBitmapSafe: vi.fn(async () => bitmap(3000, 5000)) })
    const out = await r.run(file(10, 'IMG.HEIC', 'image/heic'))
    expect(out).toMatchObject({ width: 2100, height: 3500 })
  })
})
