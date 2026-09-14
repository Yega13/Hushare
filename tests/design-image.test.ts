import { describe, it, expect, vi } from 'vitest'
import { prepareDesignImage, encodeOrderFor, scaledSize, type DesignImageDeps, type DecodedImage } from '@/lib/design-image'

// DESIGN IMAGES ARE STORED AT THE SIZE THEY ARE SHOWN.
//
// The race album's header went up as a 10,481,869-byte 7840x5229 JPEG and became the element every
// guest's first paint waited on; its logo was 6000x6000 at 40 px. The upload only resized a file that
// was too many BYTES, so a camera JPEG under 10 MB was stored untouched. These drive every branch with
// a fake decoder, because a canvas cannot run in a test -- and pin the direction it errs in: an owner is
// never blocked from a picture that uploaded before.

const HEADER_EDGE = 2560
const HEADER_BYTES = 10 * 1024 * 1024
const LOGO_EDGE = 1024
const LOGO_BYTES = 5 * 1024 * 1024

const fileOf = (type: string, size: number, name = 'pick') => new File([new Uint8Array(size)], name, { type })

type Encoded = { size: { width: number; height: number }; type: string; quality: number }

function fakeDeps(o: {
  width?: number
  height?: number
  decodes?: boolean
  readable?: boolean
  /** What the canvas hands back for a requested type: a size in bytes and the type it really produced. */
  produce?: (type: string) => { bytes: number; type: string } | null
}) {
  const encoded: Encoded[] = []
  const release = vi.fn()
  const deps: DesignImageDeps = {
    readBytes: async (file) => {
      if (o.readable === false) throw new Error('NotReadableError')
      return file
    },
    decode: async () => {
      if (o.decodes === false) return null
      const img: DecodedImage = {
        width: o.width ?? 1000,
        height: o.height ?? 800,
        encode: async (size, type, quality) => {
          encoded.push({ size, type, quality })
          const out = (o.produce ?? ((t) => ({ bytes: 300_000, type: t })))(type)
          return out ? new Blob([new Uint8Array(out.bytes)], { type: out.type }) : null
        },
        release,
      }
      return img
    },
  }
  return { deps, encoded, release }
}

describe('what gets resized', () => {
  it('THE RACE ALBUM HEADER: a 7840x5229 JPEG under the byte cap is redrawn at 2560 px, not stored as it came', async () => {
    const f = fakeDeps({ width: 7840, height: 5229 })
    const res = await prepareDesignImage(fileOf('image/jpeg', 10_481_869 - 1_000_000), HEADER_EDGE, HEADER_BYTES, f.deps)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(f.encoded[0]?.size).toEqual({ width: 2560, height: 1707 })
    expect(res.type).toBe('image/webp')
    expect(res.blob.size, 'the redrawn bytes, not the original').toBe(300_000)
  })

  it('A 6000x6000 LOGO is redrawn at 1024 px', async () => {
    const f = fakeDeps({ width: 6000, height: 6000 })
    const res = await prepareDesignImage(fileOf('image/png', 900_000), LOGO_EDGE, LOGO_BYTES, f.deps)
    expect(res.ok && f.encoded[0]?.size).toEqual({ width: 1024, height: 1024 })
  })

  it('a picture already within both caps is uploaded byte for byte, with no redraw', async () => {
    const f = fakeDeps({ width: 1600, height: 900 })
    const file = fileOf('image/jpeg', 250_000)
    const res = await prepareDesignImage(file, HEADER_EDGE, HEADER_BYTES, f.deps)
    expect(res.ok && res.blob.size).toBe(250_000)
    expect(res.ok && res.type).toBe('image/jpeg')
    expect(f.encoded, 'a redraw of an image already the right size only loses quality').toEqual([])
  })

  it('exactly at the edge cap counts as within it', async () => {
    const f = fakeDeps({ width: 2560, height: 1440 })
    await prepareDesignImage(fileOf('image/jpeg', 400_000), HEADER_EDGE, HEADER_BYTES, f.deps)
    expect(f.encoded).toEqual([])
  })

  it('within the edge but over the byte cap is still redrawn (what it did before)', async () => {
    // 800 px against the 1024 px logo cap: ONLY the bytes are over, so only the byte rule can send it on.
    const f = fakeDeps({ width: 800, height: 800 })
    const res = await prepareDesignImage(fileOf('image/png', LOGO_BYTES + 1), LOGO_EDGE, LOGO_BYTES, f.deps)
    expect(res.ok).toBe(true)
    expect(f.encoded.length).toBeGreaterThan(0)
  })

  it("a phone's HEIC or type-less pick is redrawn into a storable type", async () => {
    const f = fakeDeps({ width: 4032, height: 3024 })
    const res = await prepareDesignImage(fileOf('image/heic', 2_000_000), HEADER_EDGE, HEADER_BYTES, f.deps)
    expect(res.ok && res.type).toBe('image/webp')
  })
})

describe('transparency survives a redraw', () => {
  it('a PNG, WebP or AVIF never falls back to JPEG, which paints transparent pixels black', () => {
    for (const t of ['image/png', 'image/webp', 'image/avif']) {
      expect(encodeOrderFor(t).map(([type]) => type), t).not.toContain('image/jpeg')
    }
  })

  it('a canvas that cannot encode WebP gives a transparent logo PNG, not JPEG', async () => {
    const f = fakeDeps({ width: 6000, height: 6000, produce: (t) => (t === 'image/webp' ? { bytes: 90_000, type: 'image/png' } : { bytes: 90_000, type: t }) })
    const res = await prepareDesignImage(fileOf('image/png', 900_000), LOGO_EDGE, LOGO_BYTES, f.deps)
    expect(res.ok && res.type, "the blob's own type is trusted, not the one asked for").toBe('image/png')
  })

  it('a JPEG source may fall back to JPEG', () => {
    expect(encodeOrderFor('image/jpeg').map(([t]) => t)).toEqual(['image/webp', 'image/jpeg', 'image/png'])
  })
})

describe('scaledSize', () => {
  it('caps the long edge and keeps the aspect', () => {
    expect(scaledSize(7840, 5229, 2560)).toEqual({ width: 2560, height: 1707 })
    expect(scaledSize(5229, 7840, 2560)).toEqual({ width: 1707, height: 2560 })
  })
  it('never enlarges, never reaches zero', () => {
    expect(scaledSize(800, 600, 2560)).toEqual({ width: 800, height: 600 })
    expect(scaledSize(22_111, 3, 2560)).toEqual({ width: 2560, height: 1 })
  })
})

describe('the owner is never blocked from a picture that uploaded before', () => {
  it('a browser that cannot DECODE a huge image still uploads the storable original under the byte cap', async () => {
    // The race album's 22,111x11,906 PNG background is past what many phone decoders will draw.
    const f = fakeDeps({ decodes: false })
    const res = await prepareDesignImage(fileOf('image/png', 2_874_491), HEADER_EDGE, HEADER_BYTES, f.deps)
    expect(res.ok && res.blob.size).toBe(2_874_491)
  })

  it('a canvas that cannot ENCODE anything still uploads that original', async () => {
    const f = fakeDeps({ width: 7840, height: 5229, produce: () => null })
    const res = await prepareDesignImage(fileOf('image/jpeg', 3_000_000), HEADER_EDGE, HEADER_BYTES, f.deps)
    expect(res.ok && res.blob.size).toBe(3_000_000)
  })

  it('unreadable bytes and an undecodable image is a clear error, not a silent nothing', async () => {
    const f = fakeDeps({ readable: false, decodes: false })
    const res = await prepareDesignImage(fileOf('image/jpeg', 100), HEADER_EDGE, HEADER_BYTES, f.deps)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/Could not read this image/)
  })

  it('unreadable bytes but a drawable image is recovered through the redraw (the Android picker case)', async () => {
    const f = fakeDeps({ readable: false, width: 900, height: 900 })
    const res = await prepareDesignImage(fileOf('image/jpeg', 100_000), HEADER_EDGE, HEADER_BYTES, f.deps)
    expect(res.ok && res.type).toBe('image/webp')
  })

  it('a redraw still over the cap, with no original to fall back on, says so', async () => {
    const f = fakeDeps({ width: 9000, height: 9000, produce: (t) => ({ bytes: LOGO_BYTES + 1, type: t }) })
    const res = await prepareDesignImage(fileOf('image/png', LOGO_BYTES + 10), LOGO_EDGE, LOGO_BYTES, f.deps)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/too detailed/)
  })

  it('the decoded image is always released, including on the early keep', async () => {
    const kept = fakeDeps({ width: 100, height: 100 })
    await prepareDesignImage(fileOf('image/jpeg', 1000), HEADER_EDGE, HEADER_BYTES, kept.deps)
    expect(kept.release).toHaveBeenCalledTimes(1)
    const redrawn = fakeDeps({ width: 9000, height: 9000 })
    await prepareDesignImage(fileOf('image/jpeg', 1000), HEADER_EDGE, HEADER_BYTES, redrawn.deps)
    expect(redrawn.release).toHaveBeenCalledTimes(1)
  })
})
