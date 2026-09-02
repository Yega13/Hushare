import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { decodeBitmapSafe, decodeViaImageDecoder, decodeImageSource } from '@/lib/image-decode'

// THE DECODE CHAIN A GUEST'S PHOTO ACTUALLY TAKES.
//
// This lived inside UploadZone.tsx and four mutations to it survived the whole suite: deleting the
// WebCodecs attempt, reversing the order of the two native attempts, dropping `image.close()`, and
// skipping `isTypeSupported`. Every one is silent — no throw, no error row, no visible difference in
// review — and between them they decide whether an Android guest can upload a HEIC at all, whether
// every photo pays for an extra full-resolution copy, and whether the phone runs out of memory
// partway through a wedding's worth of uploads.
//
// The browser APIs are faked on globalThis, which is where the module reads them from. What is being
// asserted is the ORDER, the questions asked before each attempt, and the cleanup — not that
// Chromium decodes HEIF correctly, which is not ours to test.

type Fake = { closed: boolean; label: string }

const realCreateImageBitmap = globalThis.createImageBitmap
const realImageDecoder = (globalThis as Record<string, unknown>).ImageDecoder

/** Calls in the order they happened, so ordering is observable rather than assumed. */
let log: string[] = []
let cfg: {
  bitmapFrom: (source: unknown, opts?: { imageOrientation?: string }) => Fake | 'throw'
  typeSupported: boolean
  isTypeSupportedThrows: boolean
  decodeThrows: boolean
  frames: Fake[]
  /** What each ImageDecoder was actually BUILT from. The fake ignored its init entirely, so
   *  building from an empty buffer or a hardcoded type survived every test. */
  built: Array<{ byteLength: number | undefined; type: unknown }>
  /** What decode() was asked for. `frameIndex: 1` survived every test for the same reason. */
  decodeOptions: unknown[]
}

function blob(type: string): Blob {
  return { type, arrayBuffer: async () => new ArrayBuffer(8) } as unknown as Blob
}

beforeEach(() => {
  log = []
  cfg = {
    bitmapFrom: (source) => ({ closed: false, label: `bitmap-of-${(source as Fake)?.label ?? 'blob'}` }),
    typeSupported: true,
    isTypeSupportedThrows: false,
    decodeThrows: false,
    frames: [],
    built: [],
    decodeOptions: [],
  }

  globalThis.createImageBitmap = (async (source: unknown, opts?: { imageOrientation?: string }) => {
    log.push(`createImageBitmap(${(source as Fake)?.label ?? 'blob'}, ${opts?.imageOrientation ?? 'none'})`)
    const r = cfg.bitmapFrom(source, opts)
    if (r === 'throw') throw new Error('cannot decode')
    return r
  }) as unknown as typeof createImageBitmap

  class FakeImageDecoder {
    static async isTypeSupported(type: string) {
      log.push(`isTypeSupported(${type})`)
      if (cfg.isTypeSupportedThrows) throw new Error('bad type')
      return cfg.typeSupported
    }
    closed = false
    constructor(init: { data?: ArrayBuffer; type?: unknown }) {
      cfg.built.push({ byteLength: init?.data?.byteLength, type: init?.type })
      // The log STRING stays exactly 'new ImageDecoder' — the end-to-end ordering assertion below
      // compares the whole log with toEqual, and putting the arguments in here would break it.
      log.push('new ImageDecoder')
    }
    async decode(o: unknown) {
      cfg.decodeOptions.push(o)
      log.push('decode')
      if (cfg.decodeThrows) throw new Error('decode failed')
      const image: Fake = { closed: false, label: 'frame' }
      cfg.frames.push(image)
      return { image: { ...image, close: () => { image.closed = true; log.push('image.close') } } }
    }
    close() { this.closed = true; log.push('decoder.close') }
  }
  // Always defined here. The one test that needs it ABSENT redefines the global itself, which is
  // the real mechanism — the old `cfg.decoderDefined` knob was set true in this same block eight
  // lines above the ternary that read it, so no test could ever make it false and the branch was
  // dead (MISTAKES entry 22).
  Object.defineProperty(globalThis, 'ImageDecoder', {
    value: FakeImageDecoder, configurable: true, writable: true,
  })
})

afterEach(() => {
  globalThis.createImageBitmap = realCreateImageBitmap
  Object.defineProperty(globalThis, 'ImageDecoder', { value: realImageDecoder, configurable: true, writable: true })
})

describe('a rotated photo is never uploaded sideways', () => {
  it('asks for EXIF orientation to be baked into the pixels', async () => {
    // Modern browsers default to this; older Android WebViews defaulted to 'none' and decoded a
    // rotated photo un-rotated, so the re-encoded upload arrived on its side.
    await decodeBitmapSafe(blob('image/jpeg'))
    expect(log[0]).toBe('createImageBitmap(blob, from-image)')
  })

  it('retries WITHOUT the options bag when an old engine rejects it', async () => {
    // The fallback is the whole reason the explicit option is safe to ask for.
    let first = true
    cfg.bitmapFrom = () => {
      if (first) { first = false; return 'throw' }
      return { closed: false, label: 'plain' }
    }
    const r = await decodeBitmapSafe(blob('image/jpeg'))
    expect(r).not.toBeNull()
    expect(log).toEqual([
      'createImageBitmap(blob, from-image)',
      'createImageBitmap(blob, none)',
    ])
  })

  it('answers null rather than throwing when both attempts fail', async () => {
    // Null is a decision the caller acts on. A throw here would surface as a failed upload.
    cfg.bitmapFrom = () => 'throw'
    expect(await decodeBitmapSafe(blob('image/jpeg'))).toBeNull()
  })

  it('gives the WebCodecs frame the SAME orientation handling', async () => {
    // The frame used to go through a bare createImageBitmap(image) — a second, subtly different copy
    // of "how to turn a source into a bitmap" (rule 13).
    await decodeViaImageDecoder(blob('image/heic'))
    expect(log).toContain('createImageBitmap(frame, from-image)')
  })
})

describe('the platform is asked before the decoder is built', () => {
  it('asks isTypeSupported first and stops there when the answer is no', async () => {
    // Skipping the question makes an unsupported type THROW inside the decoder rather than falling
    // through, which turns a photo the WASM converter could still have handled into a failed upload.
    cfg.typeSupported = false
    expect(await decodeViaImageDecoder(blob('image/heic'))).toBeNull()
    expect(log).toEqual(['isTypeSupported(image/heic)'])
    expect(log).not.toContain('new ImageDecoder')
  })

  it('asks about the file own type, not a hardcoded one', async () => {
    await decodeViaImageDecoder(blob('image/avif'))
    expect(log[0]).toBe('isTypeSupported(image/avif)')
  })

  it('does nothing when the browser has no ImageDecoder at all', async () => {
    Object.defineProperty(globalThis, 'ImageDecoder', { value: undefined, configurable: true, writable: true })
    expect(await decodeViaImageDecoder(blob('image/heic'))).toBeNull()
    expect(log).toEqual([])
  })

  it('does nothing for a file with no type', async () => {
    // A blob with an empty type would ask isTypeSupported('') — which some engines throw on.
    expect(await decodeViaImageDecoder(blob(''))).toBeNull()
    expect(log).toEqual([])
  })

  it('builds the decoder from THIS file bytes and THIS file type', async () => {
    // The fake used to name its init `_init` and never read it, so `data: new ArrayBuffer(0)` or a
    // hardcoded type both survived the whole file. An empty buffer decodes nothing; a hardcoded type
    // decodes the wrong thing or throws.
    //
    // heif, NOT heic, deliberately: 'image/heic' is the value a hardcoding mutation would most
    // naturally use, and a fixture equal to the mutation cannot detect it — the same coincidence
    // that let `toContain('23')` be answered by the slug abc123 (MISTAKES entry 21).
    await decodeViaImageDecoder(blob('image/heif'))
    expect(cfg.built).toHaveLength(1)
    expect(cfg.built[0].type).toBe('image/heif')
    expect(cfg.built[0].byteLength, 'the file own bytes, not an empty buffer').toBe(8)
  })

  it('decodes the FIRST frame', async () => {
    // image/heic-sequence matches the caller's /heic|heif/i test, so a wrong frame index would
    // upload the wrong picture out of a live photo.
    await decodeViaImageDecoder(blob('image/heic'))
    expect(cfg.decodeOptions).toEqual([{ frameIndex: 0 }])
  })

  it('answers null when isTypeSupported itself throws', async () => {
    cfg.isTypeSupportedThrows = true
    expect(await decodeViaImageDecoder(blob('image/heic'))).toBeNull()
  })
})

describe('nothing is left holding memory a phone cannot reclaim', () => {
  it('closes the decoded frame and the decoder on the happy path', async () => {
    // A VideoFrame holds memory OUTSIDE the JS heap that the collector cannot reclaim. Thirty photos
    // without this is gigabytes, on a phone, mid-event.
    await decodeViaImageDecoder(blob('image/heic'))
    expect(log).toContain('image.close')
    expect(log).toContain('decoder.close')
    // And the frame is released before the decoder, not after it.
    expect(log.indexOf('image.close')).toBeLessThan(log.indexOf('decoder.close'))
  })

  it('closes the frame even when converting it to a bitmap fails', async () => {
    // The failure path is where a leak actually happens — the happy path is easy to get right.
    cfg.bitmapFrom = (source) => ((source as Fake)?.label === 'frame' ? 'throw' : { closed: false, label: 'b' })
    await decodeViaImageDecoder(blob('image/heic'))
    expect(log).toContain('image.close')
    expect(log).toContain('decoder.close')
  })

  it('closes the decoder even when decode itself throws', async () => {
    cfg.decodeThrows = true
    expect(await decodeViaImageDecoder(blob('image/heic'))).toBeNull()
    expect(log).toContain('decoder.close')
  })
})

describe('the ordinary decoder is tried first, and the WebCodecs one only after it fails', () => {
  it('never builds a decoder when the first attempt succeeds', async () => {
    // Reversing the order sends EVERY photo on EVERY device through a path that copies a
    // full-resolution frame an extra time, to reach the same pixels.
    const r = await decodeImageSource(blob('image/jpeg'))
    expect(r).not.toBeNull()
    expect(log).toEqual(['createImageBitmap(blob, from-image)'])
    expect(log).not.toContain('isTypeSupported(image/jpeg)')
  })

  it('falls through to WebCodecs when the ordinary decoder cannot read the file', async () => {
    // Chrome on Android with a HEIC: the case this whole path exists for. Deleting the second
    // attempt sends the guest to a WASM converter our CSP refuses to run — they cannot upload at all.
    cfg.bitmapFrom = (source) => ((source as Fake)?.label === 'frame'
      ? { closed: false, label: 'decoded' }
      : 'throw')
    const r = await decodeImageSource(blob('image/heic')) as unknown as Fake
    // The bitmap the caller gets back is the one made from the DECODED FRAME, not from the blob the
    // first attempt already choked on.
    expect(r?.label).toBe('decoded')
    expect(log).toEqual([
      'createImageBitmap(blob, from-image)',
      'createImageBitmap(blob, none)',
      'isTypeSupported(image/heic)',
      'new ImageDecoder',
      'decode',
      'createImageBitmap(frame, from-image)',
      'image.close',
      'decoder.close',
    ])
  })

  it('answers null when neither platform decoder can read it', async () => {
    // Null is what tells UploadZone to reach for the WASM converter. Anything else — a throw, or a
    // bitmap of nothing — breaks the fallback the Android path depends on.
    cfg.bitmapFrom = () => 'throw'
    expect(await decodeImageSource(blob('image/heic'))).toBeNull()
  })
})
