import { describe, it, expect, vi } from 'vitest'
import {
  createImageEncoder, dataUrlToBlob, ENCODE_FAILED, ENCODE_RETRY_MS,
  MAIN_QUALITY, THUMB_QUALITY, THUMB_MAX_DIM,
  type Surface,
} from '@/lib/upload/image-encode'

// THE CODE THAT LOST TWELVE PHOTOS, now somewhere a test can reach it.
//
// Album dm1ybi7j, 2026-09-12: twelve rows, twelve zero-byte objects in R2, every tile green. The
// encoder returned an empty blob and the check was `if (blob)` -- an empty Blob is truthy. It lived
// inside UploadZone.tsx, so none of the suite's tests executed a line of it, and no mutation could
// reach it either.
//
// Every failure below is one a real device produces and CI never will: WebKit returning null from
// toBlob under memory pressure, a 2D context refused outright, OffscreenCanvas absent on Safari
// < 16.4, and an encoder that reports success while handing back nothing.

const SRC = {} as CanvasImageSource

/** A surface whose every response is scripted. `encode` walks the list, repeating its last entry. */
function surface(script: Array<Blob | null>, dataUrl?: string | null | (() => never)) {
  let i = 0
  const draws: Array<[number, number]> = []
  const s: Surface = {
    draw: (_src, w, h) => { draws.push([w, h]) },
    encode: async () => script[Math.min(i++, script.length - 1)],
  }
  if (dataUrl !== undefined) {
    s.encodeDataUrl = () => {
      if (typeof dataUrl === 'function') return dataUrl()
      return dataUrl
    }
  }
  return { s, draws, calls: () => i }
}

const bytes = (n: number) => new Blob([new Uint8Array(n)], { type: 'image/jpeg' })
const EMPTY = new Blob([], { type: 'image/jpeg' })
/** A one-pixel JPEG as a data: URL, so the fallback path returns something real. */
const REAL_DATA_URL = 'data:image/jpeg;base64,' + btoa('not-a-real-jpeg-but-has-bytes')

// Sleep is injected everywhere so the 150ms memory-pressure retry costs the suite nothing.
const encoder = (surfaces: Parameters<typeof createImageEncoder>[0]['surfaces']) =>
  createImageEncoder({ surfaces, sleep: async () => {} })

describe('dataUrlToBlob', () => {
  it('decodes a base64 data URL, keeping its declared type', async () => {
    const blob = dataUrlToBlob(REAL_DATA_URL)
    expect(blob).not.toBeNull()
    expect(blob!.type).toBe('image/jpeg')
    expect(blob!.size).toBeGreaterThan(0)
  })

  it('refuses anything that is not a base64 data URL, rather than returning empty bytes', () => {
    // Each of these used to be a plausible way to end up with a 0-byte Blob further down.
    expect(dataUrlToBlob('')).toBeNull()
    expect(dataUrlToBlob('data:image/jpeg,notbase64')).toBeNull()
    expect(dataUrlToBlob('https://example.com/a.jpg')).toBeNull()
    expect(dataUrlToBlob('nocomma')).toBeNull()
    // Reaches the comma guard rather than being turned away by the prefix check before it: this one
    // looks like a data URL right up until you ask where the payload starts. Without the guard,
    // atob() is handed the whole string and throws instead of returning null.
    expect(dataUrlToBlob('data:image/jpeg;base64x')).toBeNull()
  })
})

describe('encodeSurface -- an empty result is a failure, at every attempt', () => {
  it('takes the first encode when it has bytes, and does not retry', async () => {
    const { s, calls } = surface([bytes(100)])
    const { encodeSurface } = encoder({ offscreen: null, element: () => s })
    await expect(encodeSurface(s, 'image/jpeg', MAIN_QUALITY)).resolves.toHaveProperty('size', 100)
    expect(calls(), 'a successful encode must not be repeated').toBe(1)
  })

  it('retries once when the encoder returns NULL -- WebKit under memory pressure', async () => {
    const { s, calls } = surface([null, bytes(50)])
    const { encodeSurface } = encoder({ offscreen: null, element: () => s })
    await expect(encodeSurface(s, 'image/jpeg', MAIN_QUALITY)).resolves.toHaveProperty('size', 50)
    expect(calls()).toBe(2)
  })

  it('RETRIES ON AN EMPTY BLOB TOO -- the defect that stored twelve photos as nothing', async () => {
    // An empty Blob is truthy. This is the exact shape that reached R2 on 2026-09-12: the encoder
    // reported success and handed back zero bytes, and every layer downstream believed it.
    const { s, calls } = surface([EMPTY, bytes(70)])
    const { encodeSurface } = encoder({ offscreen: null, element: () => s })
    await expect(encodeSurface(s, 'image/jpeg', MAIN_QUALITY)).resolves.toHaveProperty('size', 70)
    expect(calls()).toBe(2)
  })

  it('falls back to the data URL when both encodes come back empty', async () => {
    const { s } = surface([EMPTY, EMPTY], REAL_DATA_URL)
    const { encodeSurface } = encoder({ offscreen: null, element: () => s })
    const out = await encodeSurface(s, 'image/jpeg', MAIN_QUALITY)
    expect(out.size).toBeGreaterThan(0)
  })

  it('throws rather than returning an empty blob when every encoder fails', async () => {
    const { s } = surface([EMPTY, EMPTY], null)
    const { encodeSurface } = encoder({ offscreen: null, element: () => s })
    await expect(encodeSurface(s, 'image/jpeg', MAIN_QUALITY)).rejects.toThrow(ENCODE_FAILED)
  })

  it('throws when the data URL itself decodes to nothing', async () => {
    // 'data:image/jpeg;base64,' with no payload decodes to a real, valid, EMPTY Blob. Accepting it
    // would put the same zero bytes in R2 by the scenic route.
    const { s } = surface([null, null], 'data:image/jpeg;base64,')
    const { encodeSurface } = encoder({ offscreen: null, element: () => s })
    await expect(encodeSurface(s, 'image/jpeg', MAIN_QUALITY)).rejects.toThrow(ENCODE_FAILED)
  })

  it('throws, rather than escaping, when the data-URL encoder itself blows up', async () => {
    const { s } = surface([null, null], () => { throw new Error('canvas is tainted') })
    const { encodeSurface } = encoder({ offscreen: null, element: () => s })
    await expect(encodeSurface(s, 'image/jpeg', MAIN_QUALITY)).rejects.toThrow(ENCODE_FAILED)
  })

  it('throws when there is no data-URL encoder at all (OffscreenCanvas has none)', async () => {
    const { s } = surface([EMPTY, EMPTY])
    const { encodeSurface } = encoder({ offscreen: null, element: () => s })
    await expect(encodeSurface(s, 'image/jpeg', MAIN_QUALITY)).rejects.toThrow(ENCODE_FAILED)
  })

  it('waits between the two attempts, because the point is to let buffers be released', async () => {
    const sleep = vi.fn(async () => {})
    const { s } = surface([null, bytes(10)])
    const enc = createImageEncoder({ surfaces: { offscreen: null, element: () => s }, sleep })
    await enc.encodeSurface(s, 'image/jpeg', MAIN_QUALITY)
    // The NUMBER, not the constant. `toHaveBeenCalledWith(ENCODE_RETRY_MS)` reads the same value
    // the code does, so a mutation setting it to 0 stayed green -- and a retry that does not wait
    // asks the encoder again before any buffer has been released, which is the entire mechanism.
    expect(sleep).toHaveBeenCalledWith(150)
    expect(ENCODE_RETRY_MS, 'the wait must be long enough to matter').toBeGreaterThanOrEqual(100)
  })
})

describe('bitmapToBlob -- two genuinely different encoders, in order', () => {
  it('uses OffscreenCanvas when it is there, and never touches the DOM canvas', async () => {
    const off = surface([bytes(200)])
    const el = surface([bytes(1)])
    const { bitmapToBlob } = encoder({ offscreen: () => off.s, element: () => el.s })
    await expect(bitmapToBlob(SRC, 800, 600, 'image/jpeg', MAIN_QUALITY)).resolves.toHaveProperty('size', 200)
    expect(el.calls(), 'the DOM canvas must not run when the offscreen one succeeded').toBe(0)
    expect(off.draws).toEqual([[800, 600]])
  })

  it('falls through to the DOM canvas when the offscreen 2D context is refused', async () => {
    const el = surface([bytes(300)])
    const { bitmapToBlob } = encoder({
      offscreen: () => ({ draw: () => { throw new Error('OffscreenCanvas 2D context unavailable') }, encode: async () => null }),
      element: () => el.s,
    })
    await expect(bitmapToBlob(SRC, 400, 400, 'image/jpeg', MAIN_QUALITY)).resolves.toHaveProperty('size', 300)
    expect(el.draws).toEqual([[400, 400]])
  })

  it('FALLS THROUGH WHEN THE OFFSCREEN ENCODER KEEPS RETURNING EMPTY, instead of storing nothing', async () => {
    // The offscreen path used to get exactly one attempt and no size check, so an empty result from
    // it went straight to R2. Now it exhausts its own retry, fails, and the DOM canvas -- a
    // genuinely different encoder -- gets its turn.
    const off = surface([EMPTY, EMPTY])
    const el = surface([bytes(900)])
    const { bitmapToBlob } = encoder({ offscreen: () => off.s, element: () => el.s })
    await expect(bitmapToBlob(SRC, 100, 100, 'image/jpeg', MAIN_QUALITY)).resolves.toHaveProperty('size', 900)
  })

  it('uses the DOM canvas directly where OffscreenCanvas does not exist (Safari < 16.4)', async () => {
    const el = surface([bytes(42)])
    const { bitmapToBlob } = encoder({ offscreen: null, element: () => el.s })
    await expect(bitmapToBlob(SRC, 10, 10, 'image/jpeg', MAIN_QUALITY)).resolves.toHaveProperty('size', 42)
  })

  it('gives up honestly when BOTH encoders produce nothing', async () => {
    const off = surface([EMPTY, EMPTY])
    const el = surface([EMPTY, EMPTY], null)
    const { bitmapToBlob } = encoder({ offscreen: () => off.s, element: () => el.s })
    await expect(bitmapToBlob(SRC, 10, 10, 'image/jpeg', MAIN_QUALITY)).rejects.toThrow(ENCODE_FAILED)
  })
})

describe('the quality constants a customer can see', () => {
  it('are the measured values, not round numbers someone nudged', () => {
    // 0.86 softened skin and flattened gradients on every photo the site stored; 0.92 is where JPEG
    // artefacts stop being visible on a photograph. The thumbnail can afford less.
    expect(MAIN_QUALITY).toBe(0.92)
    expect(THUMB_QUALITY).toBe(0.85)
    expect(THUMB_MAX_DIM).toBe(600)
    expect(THUMB_QUALITY, 'a thumbnail must never be encoded harder than the photo').toBeLessThan(MAIN_QUALITY)
  })
})
