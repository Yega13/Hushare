import { describe, it, expect } from 'vitest'
import { jpegOrientation, stripExifFromJpeg, stripMetadataFromPng, stripMetadataFromWebp } from '@/lib/exif'

// THE CODE THAT KEEPS A GUEST'S LOCATION OUT OF EVERY PHOTO THEY UPLOAD.
//
// The privacy policy says location is removed in the browser before anything reaches us. These four
// functions are that promise, and until this file they were on the architecture test's untested list:
// the upload pipeline's tests ran them only as far as its own fixtures went. Every failure here is
// silent -- a photo stored with its GPS position, a photo stored sideways, a wide-gamut photo stored
// with its colours flattened, or a file corrupted on the way through.
//
// Byte fixtures are built to the formats' own layouts, so a test fails on what the file IS, not on a
// copy of the parser's logic (rule 17).

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
const bytes = (...parts: number[][]) => new Uint8Array(parts.flat())

function contains(hay: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}

// ── JPEG ────────────────────────────────────────────────────────────────────────────────────────

const SOI = [0xff, 0xd8]
/** A marker segment: FF, marker, big-endian length (payload + 2), payload. */
const seg = (marker: number, payload: number[]) => {
  const len = payload.length + 2
  return [0xff, marker, len >> 8, len & 0xff, ...payload]
}
/** Start-of-scan with image data and the end marker. Everything from here on is the picture. */
const SCAN = [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0x33, 0x44, 0xff, 0xd9]
const DQT = seg(0xdb, [0x00, 0x01, 0x02, 0x03])
const SOF0 = seg(0xc0, [0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00])
const APP0 = seg(0xe0, [...ascii('JFIF'), 0x00, 0x01, 0x02, 0x00, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00])
const ICC = seg(0xe2, [...ascii('ICC_PROFILE'), 0x00, 0x01, 0x01, 0xaa, 0xbb])
const IPTC = seg(0xed, [...ascii('Photoshop 3.0'), 0x00, 0x38, 0x42])
const COMMENT = seg(0xfe, ascii('shot at the venue'))

/** An EXIF APP1 payload holding one IFD entry: the orientation tag, and the letters GPS after it. */
function exifPayload(orientation: number, { bigEndian = false, tag = 0x0112 } = {}): number[] {
  const u16 = (v: number) => (bigEndian ? [v >> 8, v & 0xff] : [v & 0xff, v >> 8])
  const u32 = (v: number) => (bigEndian ? [0, 0, 0, v] : [v, 0, 0, 0])
  return [
    ...ascii('Exif'), 0x00, 0x00,
    ...ascii(bigEndian ? 'MM' : 'II'), ...u16(42), ...u32(8),
    ...u16(1),
    ...u16(tag), ...u16(3), ...u32(1), ...u16(orientation), 0x00, 0x00,
    ...u32(0),
    ...ascii('GPS'),
  ]
}
const EXIF = (orientation = 1) => seg(0xe1, exifPayload(orientation))

describe('jpegOrientation', () => {
  it('reads the orientation tag, whichever byte order the camera wrote', () => {
    expect(jpegOrientation(bytes(SOI, seg(0xe1, exifPayload(6)), SCAN))).toBe(6)
    expect(jpegOrientation(bytes(SOI, seg(0xe1, exifPayload(6, { bigEndian: true })), SCAN))).toBe(6)
    expect(jpegOrientation(bytes(SOI, APP0, seg(0xe1, exifPayload(8)), SCAN))).toBe(8)
  })

  it('a value outside 1-8 is not an orientation, and is read as upright', () => {
    expect(jpegOrientation(bytes(SOI, seg(0xe1, exifPayload(9)), SCAN))).toBe(1)
    expect(jpegOrientation(bytes(SOI, seg(0xe1, exifPayload(0)), SCAN))).toBe(1)
  })

  it('no EXIF, an EXIF block without the tag, or an APP1 that is not EXIF: upright', () => {
    expect(jpegOrientation(bytes(SOI, APP0, DQT, SCAN))).toBe(1)
    expect(jpegOrientation(bytes(SOI, seg(0xe1, exifPayload(6, { tag: 0x0110 })), SCAN))).toBe(1)
    expect(jpegOrientation(bytes(SOI, seg(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/'), 0x00, 0x06]), SCAN))).toBe(1)
  })

  it('anything that is not a JPEG, or is too short to be one, is upright', () => {
    expect(jpegOrientation(bytes(ascii('GIF89a')))).toBe(1)
    expect(jpegOrientation(bytes([0xff, 0xd8]))).toBe(1)
    expect(jpegOrientation(new Uint8Array(0))).toBe(1)
  })

  it('stops where the image data starts: an APP1 after the start of scan is never read', () => {
    // The SOS here claims no payload, so a parser that did not stop would step straight onto the APP1.
    expect(jpegOrientation(bytes(SOI, DQT, [0xff, 0xda, 0x00, 0x02], seg(0xe1, exifPayload(6))))).toBe(1)
  })

  it('skips fill bytes before a marker', () => {
    expect(jpegOrientation(bytes(SOI, [0xff, 0xff], seg(0xe1, exifPayload(3)), SCAN))).toBe(3)
  })

  it('a segment that claims more bytes than the file has is not read past the end', () => {
    expect(() => jpegOrientation(bytes(SOI, [0xff, 0xe1, 0x40, 0x00, 0x45, 0x78]))).not.toThrow()
    expect(jpegOrientation(bytes(SOI, [0xff, 0xe1, 0x40, 0x00, 0x45, 0x78]))).toBe(1)
  })
})

describe('stripExifFromJpeg', () => {
  it('removes EXIF (where GPS lives), IPTC and comments, and keeps everything that draws the picture', () => {
    const out = stripExifFromJpeg(bytes(SOI, APP0, EXIF(1), ICC, IPTC, COMMENT, DQT, SOF0, SCAN))
    expect([...out]).toEqual([...SOI, ...APP0, ...ICC, ...DQT, ...SOF0, ...SCAN])
    expect(contains(out, ascii('GPS')), 'the location survived').toBe(false)
  })

  it('KEEPS the ICC colour profile (APP2), so a wide-gamut iPhone photo keeps its colours', () => {
    const out = stripExifFromJpeg(bytes(SOI, APP0, ICC, EXIF(1), DQT, SCAN))
    expect(contains(out, ascii('ICC_PROFILE'))).toBe(true)
  })

  it('adds a JFIF header when the original had none -- a HEIC conversion stripped of APP1 has neither', () => {
    const out = stripExifFromJpeg(bytes(SOI, EXIF(1), DQT, SCAN))
    expect([...out.slice(0, 20)]).toEqual([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    ])
    expect([...out.slice(20)]).toEqual([...DQT, ...SCAN])
  })

  it('does not add a second JFIF header to a file that already has one', () => {
    const out = stripExifFromJpeg(bytes(SOI, APP0, EXIF(1), DQT, SCAN))
    let app0 = 0
    for (let i = 0; i < out.length - 1; i++) if (out[i] === 0xff && out[i + 1] === 0xe0) app0++
    expect(app0).toBe(1)
  })

  it('hands back anything that is not a JPEG untouched, as the same bytes', () => {
    const gif = bytes(ascii('GIF89a'), [0x01, 0x00])
    expect(stripExifFromJpeg(gif)).toBe(gif)
  })

  it('leaves a JPEG over 50 MB untouched rather than risk freezing the page', () => {
    const huge = new Uint8Array(50 * 1024 * 1024 + 1)
    huge[0] = 0xff
    huge[1] = 0xd8
    expect(stripExifFromJpeg(huge)).toBe(huge)
  })
})

// ── PNG ─────────────────────────────────────────────────────────────────────────────────────────

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const chunk = (type: string, data: number[]) => {
  const n = data.length
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...ascii(type), ...data, 0, 0, 0, 0]
}
const IHDR = chunk('IHDR', new Array(13).fill(1))
const ICCP = chunk('iCCP', ascii('sRGB'))
const IDAT = chunk('IDAT', [0x78, 0x9c, 0x01])
const IEND = chunk('IEND', [])

describe('stripMetadataFromPng', () => {
  it('removes every metadata chunk that can carry a location or a camera, and keeps the image', () => {
    const png = bytes(PNG_MAGIC, IHDR, chunk('eXIf', ascii('GPS')), chunk('tEXt', ascii('GPS 40.1')), chunk('zTXt', ascii('z')),
      chunk('iTXt', ascii('i')), chunk('tIME', [7, 234, 9, 14, 12, 0, 0]), ICCP, IDAT, IEND)
    expect([...stripMetadataFromPng(png)]).toEqual([...PNG_MAGIC, ...IHDR, ...ICCP, ...IDAT, ...IEND])
  })

  it('removes an eXIf chunk on its own -- the explicit location carrier', () => {
    const out = stripMetadataFromPng(bytes(PNG_MAGIC, IHDR, chunk('eXIf', ascii('GPS')), IDAT, IEND))
    expect(contains(out, ascii('eXIf'))).toBe(false)
  })

  it('hands back a PNG with nothing to remove as the very same bytes', () => {
    const png = bytes(PNG_MAGIC, IHDR, IDAT, IEND)
    expect(stripMetadataFromPng(png)).toBe(png)
  })

  it('hands back anything that is not a PNG, or a truncated one, untouched', () => {
    const notPng = bytes(ascii('RIFF'), [0, 0, 0, 0])
    expect(stripMetadataFromPng(notPng)).toBe(notPng)
    const truncated = bytes(PNG_MAGIC, IHDR, [0, 0, 0, 100], ascii('IDAT'), [1, 2, 3, 4])
    expect(stripMetadataFromPng(truncated)).toBe(truncated)
  })
})

// ── WebP ────────────────────────────────────────────────────────────────────────────────────────

const riffChunk = (type: string, data: number[]) => {
  const n = data.length
  return [...ascii(type), n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255, ...data, ...(n % 2 ? [0] : [])]
}
function webp(...chunks: number[][]): Uint8Array {
  const body = [...ascii('WEBP'), ...chunks.flat()]
  const n = body.length
  return bytes(ascii('RIFF'), [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255], body)
}
const riffSize = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(4, true)

describe('stripMetadataFromWebp', () => {
  it('removes the EXIF and XMP chunks, keeps the image and its colour profile, and rewrites the RIFF size', () => {
    const VP8X = riffChunk('VP8X', [0x2c, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const ICCPw = riffChunk('ICCP', ascii('sRGB'))
    const VP8 = riffChunk('VP8 ', [1, 2, 3, 4])
    const out = stripMetadataFromWebp(webp(VP8X, ICCPw, riffChunk('EXIF', ascii('GPS!')), riffChunk('XMP ', ascii('<x/>')), VP8))
    const expected = webp(VP8X, ICCPw, VP8)
    expect([...out]).toEqual([...expected])
    // Decoders read the size in the header, so a shortened file with the old size reads past its end.
    expect(riffSize(out)).toBe(out.length - 8)
  })

  it('removes an XMP chunk on its own', () => {
    const out = stripMetadataFromWebp(webp(riffChunk('VP8 ', [1, 2, 3, 4]), riffChunk('XMP ', ascii('<gps/>'))))
    expect(contains(out, ascii('XMP '))).toBe(false)
  })

  it('respects the padding byte after an odd-sized chunk', () => {
    const VP8odd = riffChunk('VP8 ', [9, 8, 7])
    const out = stripMetadataFromWebp(webp(VP8odd, riffChunk('EXIF', ascii('GPS'))))
    expect([...out]).toEqual([...webp(VP8odd)])
  })

  it('hands back a WebP with nothing to remove, or anything that is not a WebP, as the very same bytes', () => {
    const plain = webp(riffChunk('VP8 ', [1, 2, 3, 4]))
    expect(stripMetadataFromWebp(plain)).toBe(plain)
    const png = bytes(PNG_MAGIC, IHDR)
    expect(stripMetadataFromWebp(png)).toBe(png)
  })
})
