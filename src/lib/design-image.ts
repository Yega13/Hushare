import { readFileRobust } from '@/lib/file-read'

// DESIGN IMAGES ARE STORED AT THE SIZE THEY ARE SHOWN, NOT THE SIZE THE CAMERA TOOK.
//
// A Lighthouse run on 2026-09-14 found a race album's header served as a 10,481,869-byte JPEG at
// 7840x5229 -- the element every guest's first paint waited on, 10-15 s on a fast phone connection --
// over a 22,111x11,906 PNG background, with a 6000x6000 logo drawn at 40 px. The upload kept any
// storable file under the byte cap exactly as it came, and the edge cap only ran when a file was too
// many BYTES or could not be read. A camera JPEG is under 10 MB, so the cap never ran for the very
// files it was written for. The pixel size now decides as well.
//
// WHICH WAY IT ERRS: when the browser cannot redraw an image (a decoder or canvas limit on a phone), a
// storable original under the byte cap is uploaded as it is, exactly as before. A slow page can be
// fixed by uploading again; an owner who cannot set a header at all has nothing to do.
//
// The decisions and the canvas that enforces them live together here (rule 15). The browser parts sit
// behind DesignImageDeps so a test can drive every branch without a canvas.

export const STORABLE_DESIGN_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])

// Formats that can carry transparency. A canvas encodes transparent pixels as BLACK in a JPEG, so a
// logo with a transparent background must never fall back to one.
const ALPHA_CAPABLE: ReadonlySet<string> = new Set(['image/png', 'image/webp', 'image/avif'])

/** The formats to try, in order, when redrawing an image of this type. */
export function encodeOrderFor(sourceType: string): ReadonlyArray<readonly [type: string, quality: number]> {
  return ALPHA_CAPABLE.has(sourceType)
    ? [['image/webp', 0.9], ['image/png', 1]]
    : [['image/webp', 0.9], ['image/jpeg', 0.92], ['image/png', 1]]
}

/** The size to draw at: the long edge capped, the aspect kept, never enlarged, never zero. */
export function scaledSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export type DecodedImage = {
  width: number
  height: number
  /** Draw at `size` and encode. The blob's own type is what the bytes really are. Null if the browser cannot. */
  encode(size: { width: number; height: number }, type: string, quality: number): Promise<Blob | null>
  release(): void
}

export type DesignImageDeps = {
  readBytes(file: File): Promise<BlobPart>
  decode(file: File): Promise<DecodedImage | null>
}

export type PreparedDesignImage = { ok: true; blob: Blob; type: string } | { ok: false; error: string }

const browserDeps: DesignImageDeps = {
  readBytes: (file) => readFileRobust(file),
  async decode(file) {
    const url = URL.createObjectURL(file)
    const el = await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = url
    })
    if (!el || !el.naturalWidth || !el.naturalHeight) {
      URL.revokeObjectURL(url)
      return null
    }
    let canvas: HTMLCanvasElement | null = null
    return {
      width: el.naturalWidth,
      height: el.naturalHeight,
      async encode(size, type, quality) {
        if (!canvas) {
          canvas = document.createElement('canvas')
          canvas.width = size.width
          canvas.height = size.height
          const ctx = canvas.getContext('2d')
          if (!ctx) return null
          ctx.drawImage(el, 0, 0, size.width, size.height)
        }
        const drawn = canvas
        return new Promise<Blob | null>((resolve) => drawn.toBlob(resolve, type, quality))
      },
      release: () => URL.revokeObjectURL(url),
    }
  },
}

/**
 * Turn whatever the device's picker handed us into bytes we can sign for, store, and serve at a sane size.
 *
 * Kept as it came: a storable type, readable, under the byte cap AND no larger than `maxEdge` on its
 * long side. Everything else is redrawn at most `maxEdge` wide or tall -- which also recovers a phone's
 * HEIC or type-less pick, and the "displayable but not byte-readable" Android file. The returned `type`
 * is what the bytes really are, and it is the only type used from here on (presign, PUT header, Blob).
 */
export async function prepareDesignImage(
  file: File,
  maxEdge: number,
  maxBytes: number,
  deps: DesignImageDeps = browserDeps,
): Promise<PreparedDesignImage> {
  let original: Blob | null = null
  if (STORABLE_DESIGN_TYPES.has(file.type)) {
    try {
      const bytes = await deps.readBytes(file)
      const blob = new Blob([bytes], { type: file.type })
      if (blob.size <= maxBytes) original = blob
    } catch {
      // Unreadable bytes: the redraw below is the only way forward.
    }
  }

  const img = await deps.decode(file).catch(() => null)
  let redrawn: Blob | null = null
  try {
    if (original && img && Math.max(img.width, img.height) <= maxEdge) {
      return { ok: true, blob: original, type: file.type }
    }
    if (img) {
      const size = scaledSize(img.width, img.height, maxEdge)
      for (const [type, quality] of encodeOrderFor(file.type)) {
        const blob = await img.encode(size, type, quality).catch(() => null)
        // A canvas that cannot produce the requested type silently hands back PNG, so the blob's own
        // type is trusted rather than the one asked for -- that mismatch is what a presigned
        // signature would reject.
        if (blob && blob.size > 0 && STORABLE_DESIGN_TYPES.has(blob.type)) {
          redrawn = blob
          break
        }
      }
    }
  } finally {
    img?.release()
  }

  if (redrawn && redrawn.size <= maxBytes) return { ok: true, blob: redrawn, type: redrawn.type }
  // The browser could not make it smaller. An original the endpoint accepts still uploads (see the top).
  if (original) return { ok: true, blob: original, type: file.type }
  if (redrawn) {
    return { ok: false, error: `That image is too detailed to use here (over ${Math.round(maxBytes / 1024 / 1024)} MB even after resizing).` }
  }
  return { ok: false, error: 'Could not read this image from your device. Please pick a different one.' }
}
