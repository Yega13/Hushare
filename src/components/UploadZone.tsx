'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as tus from 'tus-js-client'
import type { Album } from '@/types'
import { stripExifFromJpeg, jpegOrientation, stripMetadataFromPng, stripMetadataFromWebp } from '@/lib/exif'
import { snapshotFileRobust, readFileRobust } from '@/lib/file-read'
import { showAppToast } from '@/components/AppToast'
import { useT } from '@/i18n/LocaleProvider'
import { detectKind, uploadCapsForTier, tooLargeMessage, generateVideoPoster } from '@/lib/media'
import {
  UPLOAD_CONCURRENCY_MOBILE,
  UPLOAD_CONCURRENCY_DESKTOP,
  VIDEO_CONCURRENCY_START,
  VIDEO_CONCURRENCY_MAX_MOBILE,
  VIDEO_CONCURRENCY_MAX_DESKTOP,
  VIDEO_WIDEN_AFTER_CLEAN,
  VIDEO_SOLO_LANE_BYTES,
  STREAM_CHUNK_SIZE_BYTES,
} from '@/lib/constants'

// ─── Upload stall watchdog ────────────────────────────────────────────────────
// Deliberately NO hard total-time cap on a PUT. On congested event Wi-Fi / cellular a large
// image can legitimately take minutes, and the old fixed 60s ceiling killed slow-but-healthy
// uploads with "Upload timed out" (then every retry hit the same wall → permanent failure).
// Instead we watch for *stalls*: if the socket sends no bytes for this long, abort and let the
// retry loop reconnect. Any real progress resets the clock, so a slow upload is never cut off.
const STALL_TIMEOUT_MS = 20_000
// ─── Max image dimension — images larger than this get downscaled before upload ─
// 2560px (≈QHD) keeps images crisp on any phone/laptop screen while cutting a 12-48MP phone
// photo from several MB down to well under 1MB — uploads are bandwidth-bound, so this is the
// single biggest lever on upload speed. The lightbox never needs more than this to look sharp.
const MAX_IMG_DIM = 2560

// ─── Semaphore ────────────────────────────────────────────────────────────────

// Weighted counting semaphore with a RUNTIME-adjustable capacity (for adaptive video concurrency).
//   • Default weight 1 = a plain N-slot semaphore. A caller can take a larger weight to hold several
//     slots at once (a big video takes the whole video lane and uploads alone; short clips overlap).
//   • acquire() resolves to a RELEASE FUNCTION that returns EXACTLY the weight it took — so capacity
//     can grow/shrink mid-flight with zero accounting drift, and a double-release is a no-op.
//   • FIFO: a heavy waiter can't be starved by a stream of light ones jumping the queue.
//   • setCapacity() grows (frees slots + wakes waiters) or shrinks (never revokes an in-flight
//     holder — it just caps future grants, so the lane settles to the new size as holders finish).
class Semaphore {
  private available: number
  private cap: number
  private queue: { w: number; resolve: (release: () => void) => void }[] = []
  constructor(capacity: number) { this.cap = Math.max(1, Math.floor(capacity)); this.available = this.cap }
  get capacity(): number { return this.cap }

  acquire(weight = 1): Promise<() => void> {
    const w = Math.min(Math.max(1, Math.floor(weight)), this.cap)
    if (this.queue.length === 0 && this.available >= w) {
      this.available -= w
      return Promise.resolve(this.makeRelease(w))
    }
    return new Promise<() => void>(resolve => this.queue.push({ w, resolve }))
  }

  setCapacity(next: number): void {
    const target = Math.max(1, Math.floor(next))
    const delta = target - this.cap
    this.cap = target
    if (delta < 0) {
      if (this.available > this.cap) this.available = this.cap
      // A shrink must never leave a queued waiter needing more slots than the lane now has — it
      // would wait forever. Re-clamp to the new capacity (still correct: that weight already means
      // "the whole lane" at this size).
      for (const item of this.queue) if (item.w > this.cap) item.w = this.cap
    } else if (delta > 0) {
      this.available += delta
    }
    this.drain()
  }

  private makeRelease(w: number): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      this.available += w
      if (this.available > this.cap) this.available = this.cap // absorb slots retired by a shrink
      this.drain()
    }
  }

  private drain(): void {
    while (this.queue.length > 0 && this.available >= this.queue[0].w) {
      const next = this.queue.shift()!
      this.available -= next.w
      next.resolve(this.makeRelease(next.w))
    }
  }
}

// Parse a JSON response body defensively. A flaky mobile network can deliver a 200 with a
// truncated/empty body — res.json() then throws the cryptic "Unexpected end of JSON input".
// Reading text first turns that into a clean, retryable error the user actually understands.
async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text()
  if (!text) throw new Error('Empty response from the server — please retry')
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('Incomplete response from the server — please retry')
  }
}

// ─── HEIC Worker singleton ────────────────────────────────────────────────────
// Module-level state: safe in 'use client' — each browser tab gets its own JS heap.

let _heicWorker: Worker | null = null
let _heicJobId = 0
const _heicCallbacks = new Map<number, {
  resolve: (b: Blob) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}>()

function getHeicWorker(): Worker {
  if (_heicWorker) return _heicWorker
  // Path MUST be a string literal — Turbopack/Webpack detect workers by static analysis of new URL(...)
  _heicWorker = new Worker(new URL('../lib/heic-worker.ts', import.meta.url), { type: 'module' })
  _heicWorker.onmessage = (e: MessageEvent<{ id: number; jpeg?: Blob; error?: string }>) => {
    const { id, jpeg, error } = e.data
    const cb = _heicCallbacks.get(id)
    if (!cb) return
    _heicCallbacks.delete(id)
    clearTimeout(cb.timer)
    if (jpeg) cb.resolve(jpeg)
    else cb.reject(new Error(error ?? 'HEIC conversion failed'))
  }
  _heicWorker.onerror = () => {
    // Null out the worker — getHeicWorker() will create a fresh one for the next file.
    // No permanent broken flag: a transient crash (e.g. OOM on one large file) should
    // not permanently disable the worker for subsequent (smaller) files.
    for (const [, cb] of _heicCallbacks) { clearTimeout(cb.timer); cb.reject(new Error('HEIC worker crashed')) }
    _heicCallbacks.clear()
    _heicWorker = null
  }
  return _heicWorker
}

async function convertHeicViaWorker(file: File): Promise<Blob> {
  const worker = getHeicWorker()
  const id = ++_heicJobId
  // Robust read: an iOS/Android picked-file reference can be momentarily unreadable — retry
  // through readFileRobust rather than throwing on the first arrayBuffer() attempt.
  const buffer = await readFileRobust(file)
  return new Promise<Blob>((resolve, reject) => {
    const timer = setTimeout(() => {
      _heicCallbacks.delete(id)
      reject(new Error('HEIC conversion timed out'))
    }, 120_000)
    _heicCallbacks.set(id, { resolve, reject, timer })
    worker.postMessage({ id, buffer }, [buffer])
  })
}

async function convertHeicMainThread(file: File): Promise<Blob> {
  const heic2any = (await import('heic2any')).default as unknown as (
    opts: { blob: Blob; toType: string; quality: number }
  ) => Promise<Blob | Blob[]>
  if (typeof heic2any !== 'function') throw new Error('heic2any failed to load')
  const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
  return Array.isArray(result) ? result[0] : result
}

// ─── Image processing helpers ─────────────────────────────────────────────────

async function encodeCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  mimeType: string,
  quality: number,
): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: mimeType, quality })
  }
  return new Promise<Blob>((resolve, reject) =>
    (canvas as HTMLCanvasElement).toBlob(
      b => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
      mimeType,
      quality,
    ),
  )
}

// ─── Single-decode pipeline constants ────────────────────────────────────────

const MAIN_QUALITY = 0.86
const THUMB_QUALITY = 0.85
// 600px longest edge: sharp on the grid even at 2–3× DPR (a 3-col mobile tile is
// ~120 CSS px = ~360 physical px on a 3× screen). Small enough to stay a fast-loading
// thumbnail. The lightbox still swaps in the full-resolution original.
const THUMB_MAX_DIM = 600
// Files at or under this size skip re-encoding (original bytes upload; JPEG gets a lossless
// EXIF strip) — the canvas round-trip would cost quality for no meaningful size win.
const RESIZE_THRESHOLD_BYTES = 1.2 * 1024 * 1024

// Decoding a 48MP photo briefly holds a full-resolution bitmap (~190MB RGBA). Bound how many
// decodes run at once — independently of upload concurrency — so network slots stay saturated
// while at most N files' worth of bitmaps exist. Mobile gets 2; desktop can afford more.
const decodeSem = new Semaphore(
  typeof navigator !== 'undefined' && /Mobi|Android/i.test(navigator.userAgent) ? 2 : 4,
)

async function decodeBitmapSafe(source: Blob): Promise<ImageBitmap | null> {
  try {
    // EXPLICIT imageOrientation: 'from-image' bakes EXIF rotation into the pixels. Modern
    // browsers default to this, but older Android WebViews defaulted to 'none' — which would
    // decode a rotated photo un-rotated, so the re-encoded upload would be sideways. Being
    // explicit guarantees correct orientation everywhere.
    return await createImageBitmap(source, { imageOrientation: 'from-image' })
  } catch {
    // Retry without options in case a very old engine rejects the options bag outright.
    try {
      return await createImageBitmap(source)
    } catch {
      return null
    }
  }
}

async function bitmapToBlob(bitmap: CanvasImageSource, w: number, h: number, mime: string, quality: number): Promise<Blob> {
  // OffscreenCanvas first (convertToBlob missing on Safari < 16.4) — HTMLCanvas fallback.
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const oc = new OffscreenCanvas(w, h)
      const octx = oc.getContext('2d')
      if (!octx) throw new Error('OffscreenCanvas 2D context unavailable')
      octx.imageSmoothingQuality = 'high'
      octx.drawImage(bitmap, 0, 0, w, h)
      return await encodeCanvas(oc, mime, quality)
    } catch { /* fall through */ }
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get 2D canvas context')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  return encodeCanvas(canvas, mime, quality)
}

// Downscale to fit maxDim (never upscales) and encode. Prefers the fused high-quality
// resample (createImageBitmap resize options — throws on Safari < 17.4), falling back to a
// plain smoothed canvas draw. The caller owns `bitmap` and closes it.
async function scaleAndEncode(
  bitmap: ImageBitmap,
  maxDim: number,
  mime: string,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  if (scale < 1) {
    try {
      const resized = await createImageBitmap(bitmap, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
      try {
        return { blob: await bitmapToBlob(resized, w, h, mime, quality), width: w, height: h }
      } finally {
        resized.close()
      }
    } catch { /* Safari < 17.4 — plain smoothed draw below */ }
  }
  return { blob: await bitmapToBlob(bitmap, w, h, mime, quality), width: w, height: h }
}

// Thumbnail is best-effort — on any failure the grid falls back to the full image.
async function deriveThumb(bitmap: ImageBitmap): Promise<Blob | null> {
  try {
    return (await scaleAndEncode(bitmap, THUMB_MAX_DIM, 'image/jpeg', THUMB_QUALITY)).blob
  } catch {
    return null
  }
}

async function strippedJpegBlob(source: Blob): Promise<Blob> {
  // readFileRobust (retries + FileReader/blob-URL fallbacks) instead of a bare arrayBuffer():
  // on iOS a stale picked-file reference throws NotFoundError ("The object can not be found
  // here.") on the first read but often succeeds on a retry a moment later.
  const buf = await readFileRobust(source)
  const stripped = stripExifFromJpeg(new Uint8Array(buf))
  return new Blob([stripped.buffer as unknown as ArrayBuffer], { type: 'image/jpeg' })
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('img element load failed'))
    img.src = url
  })
}

// Draw a plain (non-ImageBitmap) source through a canvas, downscaled to fit maxDim.
async function drawSourceToBlob(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxDim: number,
  mime: string,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  return { blob: await bitmapToBlob(source, w, h, mime, quality), width: w, height: h }
}

// LAST-RESORT decode for Android files that DISPLAY but whose raw bytes are unreadable — every
// byte read (Blob.arrayBuffer, FileReader, blob-URL fetch) throws NotReadableError, yet an <img>
// renders them (the same path that makes the picked photo's PREVIEW appear). We load the file
// into an <img> element and re-encode it through a canvas, producing FRESH in-memory bytes we
// can actually upload. The <img> element auto-applies EXIF orientation, so the pixels are upright.
async function processViaImgElement(file: File): Promise<ProcessedImage | null> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImageElement(url)
    if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) return null
    const mimeType = (file.type || 'image/jpeg').toLowerCase()
    // Preserve PNG transparency; everything else (incl. a camera JPEG) encodes to JPEG.
    const outMime = mimeType === 'image/png' ? 'image/png' : 'image/jpeg'
    let thumbBlob: Blob | null = null
    try {
      thumbBlob = (await drawSourceToBlob(img, img.naturalWidth, img.naturalHeight, THUMB_MAX_DIM, 'image/jpeg', THUMB_QUALITY)).blob
    } catch { /* thumb best-effort */ }
    const main = await drawSourceToBlob(img, img.naturalWidth, img.naturalHeight, MAX_IMG_DIM, outMime, MAIN_QUALITY)
    const name = outMime === 'image/jpeg' ? file.name.replace(/\.[^.]+$/, '.jpg') : file.name
    return { blob: main.blob, thumbBlob, mimeType: outMime, name, width: main.width, height: main.height }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ─── processImage — ONE decode produces everything ───────────────────────────
// The upload blob, the 600px grid thumbnail AND the intrinsic dimensions all come from a
// single createImageBitmap decode. The previous pipeline decoded every image up to three
// times (resize, then thumbnail, then dimensions) — pure wasted CPU on the critical path.

type ProcessedImage = {
  blob: Blob
  thumbBlob: Blob | null
  mimeType: string
  name: string
  width: number | null
  height: number | null
}

async function processImage(file: File): Promise<ProcessedImage> {
  const release = await decodeSem.acquire()
  try {
    return await processImageInner(file)
  } finally {
    release()
  }
}

async function processImageInner(file: File): Promise<ProcessedImage> {
  const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)

  if (isHeic) {
    const jpgName = file.name.replace(/\.(heic|heif)$/i, '.jpg')

    // Fast path: Safari decodes HEIC natively — skip the slow WASM converter entirely and
    // encode straight from the native bitmap (also a single lossy generation, so better
    // quality than converter-then-re-encode).
    const native = await decodeBitmapSafe(file)
    if (native) {
      try {
        const thumbBlob = await deriveThumb(native)
        const main = await scaleAndEncode(native, MAX_IMG_DIM, 'image/jpeg', MAIN_QUALITY)
        return { blob: main.blob, thumbBlob, mimeType: 'image/jpeg', name: jpgName, width: main.width, height: main.height }
      } finally {
        native.close()
      }
    }

    // WASM converter: worker first (keeps the page responsive), main thread if it crashes.
    let jpegBlob: Blob
    try {
      jpegBlob = await convertHeicViaWorker(file)
    } catch {
      try {
        jpegBlob = await convertHeicMainThread(file)
      } catch (mainErr) {
        throw new Error(`HEIC conversion failed: ${mainErr instanceof Error ? mainErr.message : String(mainErr)}`)
      }
    }

    const bitmap = await decodeBitmapSafe(jpegBlob)
    if (!bitmap) {
      // Converted but locally undecodable (rare) — upload the converted JPEG as-is, stripped.
      return { blob: await strippedJpegBlob(jpegBlob), thumbBlob: null, mimeType: 'image/jpeg', name: jpgName, width: null, height: null }
    }
    try {
      const thumbBlob = await deriveThumb(bitmap)
      // HEIC→JPEG can inflate dramatically (48MP ProRAW → 30+MB JPEG) — re-encode when large.
      if (jpegBlob.size > 2 * 1024 * 1024 || Math.max(bitmap.width, bitmap.height) > MAX_IMG_DIM) {
        const main = await scaleAndEncode(bitmap, MAX_IMG_DIM, 'image/jpeg', MAIN_QUALITY)
        return { blob: main.blob, thumbBlob, mimeType: 'image/jpeg', name: jpgName, width: main.width, height: main.height }
      }
      // Small conversion output: keep it losslessly (single lossy generation), EXIF-stripped.
      // heic2any renders through a canvas, so its output carries no orientation tag to lose.
      return { blob: await strippedJpegBlob(jpegBlob), thumbBlob, mimeType: 'image/jpeg', name: jpgName, width: bitmap.width, height: bitmap.height }
    } finally {
      bitmap.close()
    }
  }

  const mimeType = (file.type || 'image/jpeg').toLowerCase()

  // Animated GIF: NEVER re-encoded (a canvas flattens it to one frame). Decode only for the
  // static first-frame thumbnail + dimensions; the grid plays the original.
  if (mimeType === 'image/gif') {
    const bitmap = await decodeBitmapSafe(file)
    try {
      return {
        blob: file,
        thumbBlob: bitmap ? await deriveThumb(bitmap) : null,
        mimeType,
        name: file.name,
        width: bitmap?.width ?? null,
        height: bitmap?.height ?? null,
      }
    } finally {
      bitmap?.close()
    }
  }

  const bitmap = await decodeBitmapSafe(file)
  if (!bitmap) {
    // createImageBitmap failed. This is the Android "displayable but not byte-readable" case:
    // an <img> element can still render the file, so re-encode it through a canvas to get fresh,
    // uploadable bytes. This is what finally fixes the camera/gallery "Could not read this file"
    // error — every raw-byte path (arrayBuffer/FileReader/blob-URL fetch) has already failed by
    // the time we reach here (snapshotFiles tried them), but the <img> pipeline succeeds.
    const viaImg = await processViaImgElement(file)
    if (viaImg) return viaImg
    // Truly undecodable AND unreadable — upload untouched (the server validates the type); a JPEG
    // still gets its lossless metadata strip. May still fail at PUT if bytes are unreadable, but
    // there's nothing more we can do here.
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
      return { blob: await strippedJpegBlob(file), thumbBlob: null, mimeType: 'image/jpeg', name: file.name, width: null, height: null }
    }
    return { blob: file, thumbBlob: null, mimeType, name: file.name, width: null, height: null }
  }

  try {
    const thumbBlob = await deriveThumb(bitmap)

    if (file.size > RESIZE_THRESHOLD_BYTES) {
      // PNG/WebP are re-encoded IN THEIR OWN FORMAT — never to JPEG — so transparency is
      // preserved (a JPEG re-encode turned transparent areas solid black). Canvas re-encode
      // needs no EXIF strip (metadata never survives it) and bakes orientation into pixels.
      const outMime = mimeType === 'image/png' ? 'image/png'
        : mimeType === 'image/webp' ? 'image/webp'
        : 'image/jpeg'
      const main = await scaleAndEncode(bitmap, MAX_IMG_DIM, outMime, MAIN_QUALITY)
      const name = outMime === 'image/jpeg' ? file.name.replace(/\.[^.]+$/, '.jpg') : file.name
      return { blob: main.blob, thumbBlob, mimeType: outMime, name, width: main.width, height: main.height }
    }

    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
      const raw = new Uint8Array(await readFileRobust(file))
      if (jpegOrientation(raw) !== 1) {
        // The lossless strip drops APP1 — including the EXIF orientation tag — so a rotated
        // photo would upload sideways. Re-encode instead: createImageBitmap already baked the
        // rotation into the pixels. Higher quality (0.92) since these files are small anyway.
        const main = await scaleAndEncode(bitmap, MAX_IMG_DIM, 'image/jpeg', 0.92)
        return { blob: main.blob, thumbBlob, mimeType: 'image/jpeg', name: file.name, width: main.width, height: main.height }
      }
      const stripped = stripExifFromJpeg(raw)
      return {
        blob: new Blob([stripped.buffer as unknown as ArrayBuffer], { type: 'image/jpeg' }),
        thumbBlob,
        mimeType: 'image/jpeg',
        name: file.name,
        width: bitmap.width,
        height: bitmap.height,
      }
    }

    // Small PNG/WebP: pixels are kept exactly as-is, but the metadata chunks come out. Both formats
    // can carry GPS (PNG via eXIf, WebP via its EXIF chunk) and the privacy policy promises location
    // never reaches us, so "no EXIF concern" was wrong for anything that was not a screenshot.
    const raw = new Uint8Array(await file.arrayBuffer())
    const cleaned = mimeType === 'image/png' ? stripMetadataFromPng(raw) : stripMetadataFromWebp(raw)
    const blob = cleaned.length === raw.length
      ? file
      : new Blob([cleaned.buffer as unknown as ArrayBuffer], { type: mimeType })
    return { blob, thumbBlob, mimeType, name: file.name, width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}

// ─── XHR PUT ──────────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}

// Must match IMMUTABLE_CACHE_CONTROL in src/lib/cloudflare/r2.ts exactly — the presigned PUT's
// signature binds this header's value, so any mismatch is rejected by R2 as SignatureDoesNotMatch.
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

// method: 'PUT' for the direct-to-R2 presigned PUT; 'POST' for the same-origin image-relay
// fallback (src/app/api/upload/image-relay/route.ts). Returns the response body text — R2's PUT
// response is empty (callers ignore it), the relay's POST response is JSON ({key, publicUrl}).
async function xhrPut(
  method: 'PUT' | 'POST',
  url: string,
  body: Blob,
  contentType: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Upload aborted', 'AbortError')); return }
    const xhr = new XMLHttpRequest()
    let settled = false
    let lastActivity = Date.now()

    // Stall watchdog: mobile connections sometimes open the socket then stop sending bytes.
    // Abort after STALL_TIMEOUT_MS of zero progress so the retry loop can reconnect quickly.
    // Reset on every upload-progress event and once the body is fully sent (see below).
    const stallTimer = setInterval(() => {
      if (Date.now() - lastActivity > STALL_TIMEOUT_MS) {
        finish(() => { try { xhr.abort() } catch { /* ignore */ }; reject(new Error('Upload stalled — retrying')) })
      }
    }, 4000)

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearInterval(stallTimer)
      signal?.removeEventListener('abort', onAbort)
      fn()
    }

    const onAbort = () => finish(() => { try { xhr.abort() } catch { /* ignore */ }; reject(new DOMException('Upload aborted', 'AbortError')) })
    signal?.addEventListener('abort', onAbort, { once: true })
    xhr.open(method, url)
    xhr.setRequestHeader('Content-Type', contentType)
    // Cache-Control is bound into R2's presigned-PUT signature (must match IMMUTABLE_CACHE_CONTROL
    // in src/lib/cloudflare/r2.ts exactly); the relay route doesn't read/require this header at all.
    if (method === 'PUT') xhr.setRequestHeader('Cache-Control', IMMUTABLE_CACHE_CONTROL)
    xhr.upload.onprogress = (e) => {
      lastActivity = Date.now()
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    // Body fully sent — restart the stall clock so a slow server response during the
    // request→response gap (when upload progress no longer fires) isn't mistaken for a stall.
    xhr.upload.onload = () => { lastActivity = Date.now() }
    xhr.onload = () => finish(() => {
      if (xhr.status >= 200 && xhr.status < 300) { resolve(xhr.responseText); return }
      // The relay returns a JSON {error} body with the real reason (rate limited, too large, etc).
      // R2's own PUT error body is XML, which fails to parse here and falls back to the generic
      // message below — no change to the existing direct-PUT error text.
      let message = method === 'PUT' ? `R2 PUT ${xhr.status}` : `Relay upload failed (${xhr.status})`
      try {
        const parsed = JSON.parse(xhr.responseText) as { error?: string }
        if (parsed?.error) message = parsed.error
      } catch { /* non-JSON error body — keep the generic message */ }
      reject(new HttpError(xhr.status, message))
    })
    xhr.onerror = () => finish(() => reject(new Error('Network error during upload')))
    xhr.send(body)
  })
}

// ─── Transient-failure retry helpers ─────────────────────────────────────────
// 4xx responses are deterministic server verdicts (validation, caps, auth) — never retried.
// Network failures, timeouts, stalls and 5xx are transient — retried with jittered
// exponential backoff. A deliberate cancel (AbortError) always propagates immediately.

// Exponential backoff capped at 8s. Mobile networks at a crowded venue drop for *seconds* at a
// time, so the early sub-second delays alone weren't enough to ride out a drop — the curve now
// climbs to multi-second waits (0.5→1→2→4→8s) before giving up, mirroring the video path's
// persistence. Every retry re-PUTs the same immutable R2 key, so extra attempts are idempotent.
function backoffDelay(attempt: number): number {
  return Math.min(8000, 500 * 2 ** (attempt - 1)) + Math.random() * 300
}

// A network-class failure means NO HTTP RESPONSE ARRIVED AT ALL: a TypeError from fetch (DNS, TCP,
// TLS, connection reset) or a TimeoutError from the per-attempt signal. An HTTP response — even a
// 500 — is not network-class, because the server was reached and answered. The distinction decides
// whether waiting can possibly help.
function isNetworkClass(e: unknown): boolean {
  if (e instanceof DOMException && e.name === 'TimeoutError') return true
  return e instanceof TypeError
}

// Is our origin actually reachable right now?
//
// navigator.onLine cannot answer this, and relying on it is the trap. It reports whether the device
// is ASSOCIATED with a network, not whether anything gets through — so a phone sitting on a
// saturated venue access point reports onLine === true while every request dies. That is precisely
// the situation at a race, so a gate keyed on onLine would never engage when it matters, and the
// 'online' event it waits for would never fire either. A cheap HEAD to our own origin answers the
// only question worth asking. onLine === false is still honoured as a fast "definitely down".
// HEAD, not GET: /api/health answers HEAD from the edge without touching the database (see the
// note on its route). Treating ANY response as "reachable" was wrong — a 503 from a failing
// Supabase, or a Cloudflare 52x when the edge is up but the origin is dead, would both have read
// as healthy and sent us back to hammer a service that cannot serve us. Only a sub-500 answer
// means there is any point trying again.
async function originReachable(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  try {
    const res = await fetch('/api/health', { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(5000) })
    return res.status < 500
  } catch {
    return false
  }
}

// Settle to `fallback` if `p` hasn't resolved within `ms`. Generic enough that two very different
// callers want it: bounding a best-effort side task (the poster upload, which must never hold a
// video's concurrency slot hostage) and racing the shared reachability probe below against one
// caller's own deadline. Always clears its timer, so neither use leaks a pending timeout.
function settleWithin<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), ms) })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

// ONE reachability probe for the whole page, not one per file.
//
// Every in-flight file used to run its own probe loop: six concurrent images plus a video meant
// ~70 HEADs from a single device for a single outage, each independently rediscovering a fact the
// page already knew. They also recovered independently, so files trickled back one deadline at a
// time instead of resuming together. Now the first caller starts the loop and every other caller
// awaits the same promise — identical detection latency, a fraction of the traffic, and one shared
// moment of recovery. At an event, where hundreds of devices sit behind one venue NAT, that
// difference is the gap between probing an origin and hammering it.
//
// Deliberately has NO deadline of its own: callers have different budgets (a presign waits 30s, a
// save 180s), so a shared loop bounded by the shortest one would cut the others short. Each caller
// races it against its own deadline instead, via settleWithin.
let reachabilityProbe: Promise<boolean> | null = null

// Hard cap so the loop can never outlive the uploads that wanted it — a tab left open on a dead
// network would otherwise poll forever. Comfortably longer than the longest caller deadline
// (the 180s save), so this bound never cuts a caller short; it only stops an orphaned loop.
const REACHABILITY_PROBE_MAX_MS = 4 * 60_000

function originRecovered(): Promise<boolean> {
  if (!reachabilityProbe) {
    const until = Date.now() + REACHABILITY_PROBE_MAX_MS
    const probeLoop = (async () => {
      let probe = 0
      while (Date.now() < until) {
        if (await originReachable()) return true
        // Ramps 1s → 5s. Full jitter for the same reason the fetch backoff carries it: devices that
        // lost the network together come back together, and lockstep recovery is a second outage.
        probe++
        const wait = Math.min(5000, 1000 * probe) * (0.5 + Math.random() * 0.5)
        if (Date.now() + wait >= until) break
        await new Promise(r => setTimeout(r, wait))
      }
      return false
    })()
    reachabilityProbe = probeLoop
    // Cleared on settle so a LATER outage starts a fresh loop rather than reusing a resolved one.
    void probeLoop.finally(() => { if (reachabilityProbe === probeLoop) reachabilityProbe = null })
  }
  return reachabilityProbe
}

// Presign, stream-init and save are the control plane: small JSON calls that decide whether a
// photo's bytes are allowed up and whether they are recorded once they are. They used to get 3
// attempts with 0.5s + 1s of backoff — about 1.5 SECONDS of total tolerance, against byte
// transfers that tolerate 7.5s (image PUT) to minutes (tus video). A WiFi drop of a few seconds
// therefore killed the control plane while the transfers would have ridden it out, and that
// asymmetry is what turned one connectivity blip into four dead photos and two uploaded-but-lost
// ones. Retrying is now bounded by a WALL-CLOCK DEADLINE instead of an attempt count, so the
// budget is expressed in the unit that actually matters: how long a drop we can survive.
// 30s, not 60s: the requirement is to ride out a WiFi drop of a few seconds, and every second of
// patience is a second holding one of only 6 upload slots (1 for video) with an unexplained
// spinner on screen. A presign costs nothing to redo — no bytes have moved — so failing sooner and
// offering a tappable Retry beats a long silent hold.
const FETCH_DEADLINE_DEFAULT_MS = 30_000
// Save is the exception, and gets six times the patience: by this point the bytes are already in
// R2, so giving up doesn't cost an attempt, it strands an uploaded photo with no database row.
const FETCH_DEADLINE_SAVE_MS = 180_000
// A 5xx proves the server is reachable and struggling. Wall-clock patience is the right answer to
// lost connectivity and the wrong answer to an overloaded origin — without this cap the deadline
// alone would send ~11 requests per call (26 on save), and with a whole venue behind one NAT that
// is how a slow database becomes a tripped rate limit and a hard failure for every guest.
const MAX_SERVER_ERROR_ATTEMPTS = 4

// Extra time granted when connectivity is CONFIRMED back inside the window.
//
// The probe loop returning true is fresh positive evidence: the origin answered a HEAD moments ago.
// Without this, that evidence was thrown away — the loop exited reachable, fell into the ordinary
// backoff at the top of the for, hit `Date.now() + wait >= deadline` and threw "Failed to fetch"
// having just proved the server was up, WITHOUT ever re-issuing the request. The whole budget went
// on detecting the outage and the one attempt it was saving up for was never made. That is the
// exact shape of the 2026-08-18 19:47 report: 5 images and 3 videos, every one of them dead at the
// control plane with no bytes moved.
const POST_RECOVERY_GRACE_MS = 8_000
// Capped so a network that flaps up and down can extend the deadline twice, not indefinitely.
const MAX_RECOVERY_GRACES = 2

// Per-attempt timeout that ALSO honours the caller's own cancellation.
//
// AbortSignal.any() would be one line, but it lands in Chrome 116 / Safari 17.4 and a good share of
// the phones at an event are older than that — the Android 10 devices in our own error log among
// them. Wiring the two together by hand keeps cancellation working on the devices most likely to
// need it. Returns a cleanup that must run in a finally: without it every attempt leaves a live
// timer and an abort listener on a signal that outlives the request.
function withTimeoutSignal(caller: AbortSignal | undefined, timeoutMs: number) {
  const ctrl = new AbortController()
  const onCallerAbort = () => ctrl.abort(caller?.reason)
  // TimeoutError, not a bare abort: isNetworkClass treats it as network-class, which is what makes
  // a hung request wait for the origin rather than burn an attempt.
  const timer = setTimeout(() => ctrl.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs)
  if (caller) {
    if (caller.aborted) ctrl.abort(caller.reason)
    else caller.addEventListener('abort', onCallerAbort, { once: true })
  }
  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(timer)
      caller?.removeEventListener('abort', onCallerAbort)
    },
  }
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  // signal: the CALLER's cancellation. `{ ...init, signal }` used to overwrite whatever was passed
  // in init, silently — so the control-plane calls were simply not cancellable, and any future
  // caller adding one would have had it discarded without a word. Taken as an explicit option now
  // so it cannot be shadowed by a spread again.
  opts: { deadlineMs?: number; signal?: AbortSignal } = {},
): Promise<Response> {
  const startedAt = Date.now()
  let deadline = startedAt + (opts.deadlineMs ?? FETCH_DEADLINE_DEFAULT_MS)
  let graces = 0
  // Set when the probe confirms the origin is back: the next attempt skips the backoff, because
  // waiting out a delay we already spent probing is exactly the wasted patience described above.
  let skipBackoff = false
  let lastErr: Error | null = null
  // The most recent 5xx, held so that running out of time still returns the server's own response
  // rather than throwing a generic error. Callers read the real message — and the `code` that
  // tells an expected refusal from a genuine failure — out of that body, so throwing instead would
  // replace an accurate explanation with a useless one. At most one is ever retained.
  let lastServerRes: Response | null = null
  let attempt = 0
  let serverErrors = 0
  for (;;) {
    if (attempt > 0 && !skipBackoff) {
      // FULL jitter, not the ±300ms the raw curve carries. Devices that lost the network together
      // come back together, and at an event that means thousands of clients firing inside the same
      // narrow window — recovery turning straight back into an outage. Spreading each wait across
      // half its nominal value is what breaks the lockstep.
      const wait = backoffDelay(attempt) * (0.5 + Math.random() * 0.5)
      // Never sleep past the deadline just to fail on the far side of it.
      if (Date.now() + wait >= deadline) break
      await new Promise(r => setTimeout(r, wait))
    }
    skipBackoff = false
    attempt++
    // Per-attempt timeout: a hung request should burn 20s, not hang the file forever. Combined with
    // the caller's signal, so cancelling an upload also stops the request it is waiting on.
    const attemptSignal = withTimeoutSignal(opts.signal, 20_000)
    try {
      const res = await fetch(url, { ...init, signal: attemptSignal.signal })
      if (res.status >= 500) {
        serverErrors++
        if (serverErrors < MAX_SERVER_ERROR_ATTEMPTS && Date.now() < deadline) {
          lastErr = new Error(`HTTP ${res.status}`)
          // Keep only the newest; draining the one it replaces frees its connection instead of
          // leaving it pinned until garbage collection.
          void lastServerRes?.body?.cancel()
          lastServerRes = res
          continue
        }
      }
      void lastServerRes?.body?.cancel()
      return res
    } catch (e) {
      // A deliberate cancel is a final answer, not a transient failure. Without this the abort
      // surfaces as a plain DOMException, isNetworkClass says "not network", and the loop politely
      // backs off and tries again — retrying the exact request the caller just cancelled.
      if (opts.signal?.aborted) {
        // Drain a retained 5xx on the way out, same as every other exit from this loop — otherwise
        // cancelling mid-retry is the one path that leaves a body pinning its connection.
        void lastServerRes?.body?.cancel()
        throw new DOMException('Upload aborted', 'AbortError')
      }
      lastErr = e instanceof Error ? e : new Error(String(e))
      if (Date.now() >= deadline) break
      // Nothing came back. Before spending another attempt (and another 20s timeout) on a
      // connection that may simply be gone, ask whether we can reach ourselves at all. While we
      // can't, poll cheaply rather than hammering the real endpoint — this is the part that turns
      // "the batch died" into "the batch paused". The probe is shared page-wide (see
      // originRecovered) and raced against THIS call's deadline, so every file waiting on the same
      // outage waits on one loop and they all resume together the instant it clears.
      if (isNetworkClass(e)) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) break
        const recovered = await settleWithin(originRecovered(), remaining, false)
        // Confirmed up. Give the request a real chance to run now rather than expiring on the
        // doorstep — and go straight there, without a backoff we effectively already served.
        //
        // Both effects are deliberately tied to the SAME budget. An origin that answers HEAD while
        // this particular request keeps failing (a proxy blocking one path, a body that won't
        // stream) would otherwise loop probe→retry→probe with no backoff for as long as the window
        // lasted, turning a bounded wait into a tight spin against our own health endpoint. Once
        // the graces are spent, further recoveries fall back to ordinary jittered backoff, which
        // the deadline already bounds.
        if (recovered && graces < MAX_RECOVERY_GRACES) {
          graces++
          deadline = Math.max(deadline, Date.now() + POST_RECOVERY_GRACE_MS)
          skipBackoff = true
        }
      }
    } finally {
      // Must be finally: the try block exits by `continue` on a retried 5xx and by `return` on
      // success, so anything after it would be skipped on exactly the paths that run most. Each
      // attempt otherwise leaves a live 20s timer and an abort listener on a signal that outlives
      // the whole upload — one per attempt, per file.
      attemptSignal.cleanup()
    }
  }
  // Out of time. A server that answered badly still told us something useful — hand that back
  // rather than a generic network error, exactly as the pre-deadline version did.
  if (lastServerRes) return lastServerRes
  // Name the endpoint. "Failed to fetch" on its own cannot distinguish a presign from a
  // stream-init from a save — all three are the same TypeError from this one helper — so an /admin
  // report of it was unactionable: it said the network broke, never where. The message stays
  // PREFIXED by the original text, so friendlyUploadError's substring matching (and the network
  // classifier) behave exactly as before.
  //
  // How long we waited is deliberately NOT in the message. /admin tallies incidents by exact
  // message string, so a value that varies per file (30s here, 31s there) would shatter one
  // outage into a column of one-count chips — destroying the grouping this same file works hard
  // to produce. It rides along in the report context instead, where it is recorded without
  // affecting how rows are grouped.
  const path = (() => { try { return new URL(url, window.location.origin).pathname } catch { return url } })()
  const err = new Error(`${lastErr?.message ?? 'Network request failed'} (${path})`)
  throw Object.assign(err, { waitedMs: Date.now() - startedAt })
}

// The old policy threw on ANY HTTP error — including R2's transient 500/502/503s, which are
// exactly the errors a retry fixes. Only 4xx (bad/expired signature, too large) is deterministic.
// The byte transfer gets MORE patience than the control plane, not less.
//
// Measured on 2026-08-17: a guest on Android lost 25 photos in 61 seconds. The presign calls had
// already been given a wall-clock deadline, but this function had not — it was still a fixed 5
// attempts, about 7.5 seconds of tolerance, so a minute-long drop killed every transfer in flight
// while the deadline logic sat one layer above doing nothing for them.
//
// Being generous here is close to free: the bytes are already in memory and the R2 key is fixed
// and immutable, so re-PUTting is idempotent — the only cost of waiting is time, while the cost of
// giving up is a photo the guest believed they had handed over.
const PUT_DEADLINE_MS = 120_000

async function putWithRetry(
  url: string,
  body: Blob,
  contentType: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
  deadlineMs = PUT_DEADLINE_MS,
): Promise<void> {
  const deadline = Date.now() + deadlineMs
  let lastErr: Error | null = null
  let attempt = 0
  for (;;) {
    if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError')
    if (attempt > 0) {
      const wait = backoffDelay(attempt) * (0.5 + Math.random() * 0.5)
      if (Date.now() + wait >= deadline) break
      await new Promise(r => setTimeout(r, wait))
    }
    attempt++
    try {
      await xhrPut('PUT', url, body, contentType, onProgress, signal)
      return
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      // R2 answered and refused — a signature or size problem no amount of waiting fixes.
      if (e instanceof HttpError && e.status < 500) throw e
      lastErr = e instanceof Error ? e : new Error(String(e))
      if (Date.now() >= deadline) break
      // No response at all: wait for the connection rather than spending attempts on a dead one.
      if (!(e instanceof HttpError)) {
        let probe = 0
        while (Date.now() < deadline && !signal?.aborted && !(await originReachable())) {
          probe++
          const wait = Math.min(5000, 1000 * probe) * (0.5 + Math.random() * 0.5)
          if (Date.now() + wait >= deadline) break
          await new Promise(r => setTimeout(r, wait))
        }
      }
    }
  }
  throw lastErr ?? new Error('Upload failed')
}

// ─── Image relay fallback (same-origin, via R2 native binding) ──────────────
// Image analogue of runTusWithRecovery's video relay: when a network blocks R2's upload domain
// outright (confirmed in production: the same blocked device also failed image uploads), fall back
// to routing the bytes through hushare.space's own server (src/app/api/upload/image-relay/route.ts,
// which writes to R2 via the native Workers binding — no outbound fetch, no SSRF surface).
//
// Session-scoped flag, SEPARATE from video's networkNeedsRelay: the two direct-upload domains
// (Stream's upload.cloudflarestream.com vs R2's private <account>.r2.cloudflarestorage.com) are
// genuinely distinct, so one confirmed block shouldn't be assumed to cover the other.
// Has this network proven that it BLOCKS R2's upload domain? Only a relay that actually succeeded
// after a direct failure proves that; a direct failure on its own proves nothing, because plain
// loss of connectivity looks identical.
//
// Getting this wrong is expensive, not cosmetic. The flag routes every remaining photo in the
// session through our own Worker, which streams each body through it — and on 2026-08-17 that is
// what Cloudflare killed 328 requests for exceeding resources, 100% of the day's worker errors,
// clustered in exactly the two hours that had relay switches. A single connectivity blip used to
// set this permanently, so one bad moment turned the whole rest of the upload into the expensive,
// failure-prone path. It also tripled the server authorization work per photo.
let imageNetworkNeedsRelay = false
let imageRelayProvenAt = 0
// Re-probe the direct path periodically. Networks change (a phone moves between wifi and cellular
// mid-event), and being wrong in this direction costs the Worker budget rather than the upload.
const RELAY_REPROBE_MS = 60_000

function shouldUseRelayFirst(): boolean {
  if (!imageNetworkNeedsRelay) return false
  if (Date.now() - imageRelayProvenAt > RELAY_REPROBE_MS) {
    imageNetworkNeedsRelay = false
    return false
  }
  return true
}

// Every relay attempt re-runs the FULL server-side authorization chain (both rate-limit checks +
// album/tier lookups) — unlike a direct PUT retry, which just re-sends bytes to an already-signed
// URL. Capped lower than putWithRetry's 5 attempts to avoid multiplying DB load across retries.

async function relayUploadImage(
  albumId: string,
  fileName: string,
  contentType: string,
  isThumb: boolean,
  body: Blob,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<{ key: string; publicUrl: string }> {
  const url = `/api/upload/image-relay?albumId=${encodeURIComponent(albumId)}&fileName=${encodeURIComponent(fileName)}&contentType=${encodeURIComponent(contentType)}&isThumb=${isThumb ? '1' : '0'}`
  // Deadline-driven for the same reason as the direct path: this is the LAST route the bytes have,
  // so two quick attempts meant a connection blip discarded a photo that was already in memory and
  // already authorized. Same key derivation server-side on every attempt, so retrying is safe.
  const deadline = Date.now() + PUT_DEADLINE_MS
  let lastErr: Error | null = null
  let attempt = 0
  for (;;) {
    if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError')
    if (attempt > 0) {
      const wait = backoffDelay(attempt) * (0.5 + Math.random() * 0.5)
      if (Date.now() + wait >= deadline) break
      await new Promise(r => setTimeout(r, wait))
    }
    attempt++
    try {
      const text = await xhrPut('POST', url, body, contentType, onProgress, signal)
      return JSON.parse(text) as { key: string; publicUrl: string }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      // A 4xx from the relay (rate limited, oversized, disabled) is a final verdict — never retried,
      // mirroring putWithRetry's policy for the direct path.
      if (e instanceof HttpError && e.status < 500) throw e
      lastErr = e instanceof Error ? e : new Error(String(e))
      if (Date.now() >= deadline) break
      if (!(e instanceof HttpError)) {
        let probe = 0
        while (Date.now() < deadline && !signal?.aborted && !(await originReachable())) {
          probe++
          const wait = Math.min(5000, 1000 * probe) * (0.5 + Math.random() * 0.5)
          if (Date.now() + wait >= deadline) break
          await new Promise(r => setTimeout(r, wait))
        }
      }
    }
  }
  throw lastErr ?? new Error('Relay upload failed')
}

// Wraps a presigned direct-to-R2 PUT with the relay fallback. A network-class failure (plain
// Error — no HTTP response ever arrived, mirroring runTusWithRecovery's tusHttpStatus(e) === null
// check) switches to the relay for a fresh attempt of the SAME bytes; an HttpError (R2 itself
// responded, even with a 5xx) is not network-class and is never relayed — putWithRetry already
// exhausted its own retries against that same signed URL.
//
// CRITICAL: the relay always re-derives its OWN server-side key (never the original presign-time
// key), so this always returns the key/publicUrl that ACTUALLY got written — callers must use the
// returned values, never the original presign-time ones, or the DB row would point at bytes that
// were never written while the relay's real object sits orphaned under a different key.
async function putImageWithRelay(
  originalKey: string,
  originalPublicUrl: string,
  presignedUrl: string,
  relay: { albumId: string; fileName: string; contentType: string; isThumb: boolean },
  body: Blob,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<{ key: string; publicUrl: string }> {
  let directFailed = false
  if (!shouldUseRelayFirst()) {
    try {
      await putWithRetry(presignedUrl, body, relay.contentType, onProgress, signal)
      return { key: originalKey, publicUrl: originalPublicUrl }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      if (e instanceof HttpError) throw e
      directFailed = true
    }
  }
  try {
    const result = await relayUploadImage(relay.albumId, relay.fileName, relay.contentType, relay.isThumb, body, onProgress, signal)
    // The relay working where the direct path did not is the ONLY evidence that this network
    // blocks R2 specifically. Recorded here, after the fact, rather than guessed at above.
    if (directFailed && !imageNetworkNeedsRelay) {
      imageNetworkNeedsRelay = true
      imageRelayProvenAt = Date.now()
      reportClientEvent('warn', 'upload:image-relay', 'Switched to relay after direct upload was network-blocked', relay.albumId, { fileName: relay.fileName })
    }
    return result
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    if (e instanceof HttpError) throw e
    // Both the direct path AND the relay failed on a pure network-level basis — a rarer, more
    // serious case than a single blocked domain. Thrown pre-formatted (rather than pattern-matched
    // in friendlyUploadError) since this message is already the final, user-facing text.
    throw new Error("Couldn't upload after trying multiple connection methods. Check that you're connected to the internet, then tap Retry.")
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

// Everything needed to RESUME a failed video upload instead of restarting it: the tus
// uploadUrl lets tus-js-client HEAD the server for the last confirmed offset and continue
// from there (a 100MB video that died at 80% resumes at 80%). Poster/duration/dimensions are
// carried along so none of that work is redone either.
type VideoResume = {
  uploadUrl: string
  streamUid: string
  iframeUrl: string
  thumbnailUrl: string | null
  posterUrl: string | null
  durationSeconds: number
  videoWidth: number | null
  videoHeight: number | null
  // Set once this file has proven the direct-to-Cloudflare path is network-blocked, so a manual
  // Retry click resumes via the relay directly instead of re-attempting the doomed direct path first.
  viaRelay?: boolean
}

// Thrown when a video's TUS phase fails after the Stream session was already created —
// carries the resume state so the Retry button continues instead of starting over, plus the
// real HTTP status (or null for a pure network drop) so the message can name the actual cause.
class VideoUploadError extends Error {
  constructor(
    message: string,
    public readonly resume: VideoResume | null,
    public readonly httpStatus: number | null,
  ) {
    super(message)
  }
}

// tus-js-client's DetailedError hides the real cause inside a stringified blob. Pull out the
// HTTP status of the failing request: a number means the server rejected it (4xx = the video
// is bad/too long/too large; 5xx = transient server error); null means no response arrived at
// all (a genuine network drop — the "response code: n/a" case).
function tusHttpStatus(e: unknown): number | null {
  const resp = (e as { originalResponse?: { getStatus?: () => number } | null })?.originalResponse
  const status = resp?.getStatus?.() ?? 0
  return status > 0 ? status : null
}

type FileEntry = {
  id: string
  file: File
  // 'waiting' is a failure the NETWORK caused, parked rather than surfaced: the uploader resumes it
  // by itself once the origin is reachable again (see isRecoverableNetworkFailure). It is a distinct
  // state and not a flavour of 'error' on purpose — a tile that says "failed" while it is quietly
  // about to upload is a lie, and the failed-files chip must not collect files nobody needs to act
  // on. Anything still unrecovered after that becomes a real 'error' with a manual Retry.
  status: 'pending' | 'uploading' | 'done' | 'error' | 'waiting'
  progress: number
  error?: string
  preview?: string  // object URL for the image thumbnail (revoked on clear/unmount)
  videoResume?: VideoResume  // set when a video fails mid-TUS; Retry resumes from the offset
  // One automatic resume per file. A second network failure means auto-recovery is not working for
  // this file, so it stops being clever and hands the guest the Retry button.
  autoResumed?: boolean
}

type PhotoRow = {
  storage_backend: 'r2' | 'stream'
  media_type: 'image' | 'video'
  storage_path?: string
  url?: string
  thumb_url?: string | null
  stream_uid?: string
  stream_thumbnail_url?: string | null
  poster_url: string | null
  duration_seconds?: number | null
  width?: number | null
  height?: number | null
}

// Snapshot each picked file into a stable in-memory copy the instant it is selected. On
// Android the original File reference (especially from Google Photos / the gallery) goes
// stale before the upload queue reads its bytes, throwing NotReadableError ("the requested
// file could not be read... permission problems after a reference was acquired"). Reading the
// bytes now — while the picker permission is still fresh — sidesteps that entirely. Falls back
// to the original reference if the immediate read fails.
// Buffering the bytes into memory is what makes the copy stable, so cap it: huge files
// (large videos) would risk OOM on mobile if several were read at once. Those keep their
// original reference — the stale-reference bug overwhelmingly hits image picks, not big videos.
const SNAPSHOT_MAX_BYTES = 80 * 1024 * 1024
// Bounded workers, NOT Promise.all over everything: a 200-photo drop would otherwise buffer
// every file's bytes into memory simultaneously — an OOM on mobile before uploading starts.
const SNAPSHOT_CONCURRENCY = 4
async function snapshotFiles(files: File[]): Promise<File[]> {
  const out = new Array<File>(files.length)
  let next = 0
  const worker = async () => {
    while (next < files.length) {
      const i = next++
      const f = files[i]
      // Big videos keep their original reference (buffering several into memory risks OOM);
      // the stale-reference bug overwhelmingly hits image picks, not large videos.
      if (f.size > SNAPSHOT_MAX_BYTES) { out[i] = f; continue }
      // Robust snapshot (retries + FileReader fallback) into an in-memory File — this is what
      // makes every downstream read (decode, EXIF, upload) immune to the reference going stale.
      // Falls back to the original reference only if the bytes are truly unreadable.
      out[i] = (await snapshotFileRobust(f)) ?? f
    }
  }
  await Promise.all(Array.from({ length: Math.min(SNAPSHOT_CONCURRENCY, files.length) }, worker))
  return out
}

// ─── Upload image to R2 ───────────────────────────────────────────────────────

async function uploadImageToR2(
  file: File,
  albumId: string,
  imageCapBytes: number,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<PhotoRow> {
  // Process BEFORE presigning — fileSize in presign must match the actual blob we PUT.
  // One decode yields the upload blob, the thumbnail AND the dimensions (see processImage).
  onProgress(2)
  const processed = await processImage(file)
  onProgress(12)

  // Cap enforced on the PROCESSED size — what actually uploads. A 30MB phone photo that
  // compresses to <1MB should not bounce off a 25MB tier cap. The server enforces the same
  // cap on the presigned size, so this is UX, not security.
  if (processed.blob.size > imageCapBytes) {
    throw new Error(tooLargeMessage('image', imageCapBytes))
  }

  // ONE presign round trip covers both the image and its thumbnail (the old flow made two,
  // each paying the server's full rate-limit + album + tier lookup cost).
  const presignRes = await fetchWithRetry('/api/upload/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      albumId,
      fileName: processed.name,
      contentType: processed.mimeType,
      fileSize: processed.blob.size,  // actual size of the blob we're about to PUT
      ...(processed.thumbBlob ? { thumbSize: processed.thumbBlob.size } : {}),
    }),
  }, { signal })
  if (!presignRes.ok) {
    const err = await presignRes.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? `Presign failed (${presignRes.status})`)
  }
  const { presignedUrl, key, publicUrl, thumb } = await readJson<{
    presignedUrl: string
    key: string
    publicUrl: string
    thumb?: { presignedUrl: string; key: string; publicUrl: string }
  }>(presignRes)
  onProgress(16)

  // Main and thumbnail PUT in PARALLEL — the ~30KB thumb rides along for free instead of
  // adding its own serial round trip. This promise NEVER rejects: thumb failure is non-fatal
  // (the grid falls back to the full image), and if the main PUT throws first this promise may
  // go un-awaited — a rejection here would surface as an unhandled rejection. An abort during
  // the thumb phase also resolves null: the main image is already in R2 at that point, so
  // saving its row (thumb-less) beats orphaning the uploaded bytes.
  const thumbPut: Promise<string | null> = (processed.thumbBlob && thumb)
    ? putImageWithRelay(
        thumb.key, thumb.publicUrl, thumb.presignedUrl,
        { albumId, fileName: processed.name, contentType: 'image/jpeg', isThumb: true },
        processed.thumbBlob, () => {}, signal,
      ).then(r => r.publicUrl).catch(() => null)
    : Promise.resolve(null)

  const main = await putImageWithRelay(
    key, publicUrl, presignedUrl,
    { albumId, fileName: processed.name, contentType: processed.mimeType, isThumb: false },
    processed.blob, pct => onProgress(16 + Math.round(pct * 0.8)), signal,
  )
  const thumbUrl = await thumbPut
  onProgress(98)

  return {
    storage_backend: 'r2',
    media_type: 'image',
    storage_path: main.key,
    url: main.publicUrl,
    thumb_url: thumbUrl,
    poster_url: null,
    width: processed.width,
    height: processed.height,
  }
}

// ─── Upload video to Cloudflare Stream ────────────────────────────────────────

// Presign + PUT one poster JPEG into R2 thumbs (isThumb:true → thumbs/{albumId}/{uuid}.jpg,
// which passes photos/create poster_url validation). Throws on failure — callers decide fatality.
async function uploadPosterToR2(albumId: string, blob: Blob, signal?: AbortSignal): Promise<string> {
  const presign = await fetchWithRetry('/api/upload/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ albumId, fileName: 'poster.jpg', contentType: 'image/jpeg', fileSize: blob.size, isThumb: true }),
  }, { signal })
  if (!presign.ok) throw new Error(`Poster presign failed (${presign.status})`)
  const { presignedUrl, key, publicUrl } = await readJson<{ presignedUrl: string; key: string; publicUrl: string }>(presign)
  const result = await putImageWithRelay(
    key, publicUrl, presignedUrl,
    { albumId, fileName: 'poster.jpg', contentType: 'image/jpeg', isThumb: true },
    blob, () => {}, signal,
  )
  return result.publicUrl
}

// A TUS error with a 4xx response is a final server verdict (expired/invalid upload URL,
// bad request) — retrying the same URL cannot succeed. Everything else (network drop, stall,
// 5xx) is transient. Used for tus-js-client's OWN internal onShouldRetry, and for deciding whether
// a RESUMED upload's session itself is stale/expired (needs a fresh Stream init).
function isDeterministicTusError(e: unknown): boolean {
  const status = tusHttpStatus(e)
  return status !== null && status >= 400 && status < 500
}

// The OUTER recovery loop's view is more permissive: it always constructs a FRESH tus.Upload per
// attempt, which re-HEADs for the true confirmed offset before resuming — so a 409 Conflict (offset
// mismatch, e.g. from an aborted attempt's already-in-flight PATCH landing on the wire after the
// next attempt already started — abort() can't un-send bytes already flushed to the socket, an
// inherent property of retrying over HTTP) self-corrects on the next attempt rather than being a
// real final verdict. tus-js-client's own internal retry (isDeterministicTusError, above) still
// gives up on a 409 quickly — that's fine, it just hands control back to this loop sooner.
function isFatalTusError(e: unknown): boolean {
  const status = tusHttpStatus(e)
  if (status === 409) return false
  return status !== null && status >= 400 && status < 500
}

// Session-scoped (browser JS, not server state — see the Workers "no global request state" rule,
// which is about per-request isolation on the SERVER and doesn't apply to a single browser tab's
// own lifetime): once ANY video in this page session has proven the direct-to-Cloudflare path is
// network-blocked, remember it so the NEXT NEW video (not just a retry of the same file) starts
// with the relay immediately instead of wasting an attempt rediscovering the same block.
let networkNeedsRelay = false

// One TUS attempt with a stall watchdog. tus-js-client has no progress timeout of its own:
// a socket that opens and then silently stops sending bytes (classic weak-signal mobile
// behaviour) would hang the upload forever. If no progress arrives for TUS_STALL_MS, abort
// and reject so the recovery loop can resume from the server's confirmed offset.
const TUS_STALL_MS = 45_000

function runTusOnce(
  file: File,
  uploadUrl: string,
  viaRelay: boolean,
  onFraction: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Upload aborted', 'AbortError')); return }
    let settled = false
    let lastActivity = Date.now()
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearInterval(watchdog)
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const upload = new tus.Upload(file, {
      // uploadUrl (not endpoint): tus HEADs it for the current offset and RESUMES — both
      // across our recovery-loop attempts and across user-initiated retries.
      uploadUrl,
      chunkSize: STREAM_CHUNK_SIZE_BYTES,
      // When relaying (same-origin), send PATCH as POST + X-HTTP-Method-Override so networks that
      // block the PATCH method still upload video. No effect on the direct Cloudflare path.
      overridePatchMethod: viaRelay,
      // tus's OWN internal retries per failed chunk (the old [0, 0] fired two instant retries
      // into the same congestion). Longer, more numerous delays ride out a mobile network that
      // drops for several seconds at a time.
      retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
      // Retry transport/network failures AND transient server states (5xx). Deterministic
      // 4xx verdicts are final — mirrors putWithRetry's policy for images.
      onShouldRetry: (err: unknown) => !isDeterministicTusError(err),
      onProgress: (bytesUploaded, bytesTotal) => {
        lastActivity = Date.now()
        onFraction(bytesTotal > 0 ? bytesUploaded / bytesTotal : 0)
      },
      onSuccess: () => settle(resolve),
      onError: (err) => settle(() => reject(err instanceof Error ? err : new Error(String(err)))),
    })
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity > TUS_STALL_MS) {
        settle(() => {
          try { upload.abort() } catch { /* ignore */ }
          reject(new Error('Video upload stalled'))
        })
      }
    }, 5000)
    const onAbort = () => settle(() => {
      try { upload.abort() } catch { /* ignore */ }
      reject(new DOMException('Upload aborted', 'AbortError'))
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    upload.start()
  })
}

// Outer recovery loop around runTusOnce: each attempt resumes from the server's confirmed
// offset, so a stall/drop at 80% costs only the unconfirmed chunk, never the whole file.
//
// Also owns the direct→relay fallback: a pure network-level failure (tusHttpStatus === null — no
// HTTP response ever arrived, whether from an immediate connection failure or the TUS_STALL_MS
// watchdog firing on a silently blackholed connection, e.g. a content filter that drops packets
// rather than actively refusing them) is a strong, specific signal that THIS network cannot reach
// upload.cloudflarestream.com at all — unlike a real 4xx/5xx, where Cloudflare DID respond, so the
// network path is fine and switching wouldn't help. After just ONE such failure, switch subsequent
// attempts to the same-origin relay (src/app/api/upload/stream-relay/[uid]/route.ts) — TUS resume
// works via HEAD-for-confirmed-offset regardless of which URL path reaches the same underlying
// Cloudflare session, so this is a seamless mid-upload switch, never a restart.
async function runTusWithRecovery(
  file: File,
  directUploadUrl: string,
  streamUid: string,
  albumId: string,
  onFraction: (fraction: number) => void,
  signal: AbortSignal | undefined,
  relayState: { active: boolean },
  attempts = 6,
): Promise<void> {
  const relayUploadUrl = `/api/upload/stream-relay/${streamUid}`
  let effectiveUrl = relayState.active ? relayUploadUrl : directUploadUrl
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError')
    // Outer backoff on top of tus's internal retries — capped at 15s. Because every attempt
    // RESUMES from the server's confirmed offset, being this persistent is nearly free: we
    // never re-send bytes Cloudflare already has, we just keep reconnecting until it's done.
    if (attempt > 0) await new Promise(r => setTimeout(r, Math.min(15000, 2000 * attempt) + Math.random() * 500))
    try {
      await runTusOnce(file, effectiveUrl, relayState.active, onFraction, signal)
      return
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      if (isFatalTusError(e)) throw e
      lastErr = e instanceof Error ? e : new Error(String(e))
      if (!relayState.active && tusHttpStatus(e) === null) {
        relayState.active = true
        effectiveUrl = relayUploadUrl
        networkNeedsRelay = true
        // One-time telemetry per file when the fallback actually engages — lets the admin panel
        // show how often blocked-network recovery is actually needed in practice. Fire-and-forget,
        // never blocks the upload (reportClientEvent already guarantees this).
        reportClientEvent('warn', 'upload:video-relay', 'Switched to relay after direct upload was network-blocked', albumId, { streamUid })
      }
    }
  }
  throw lastErr ?? new Error('Video upload failed')
}

async function uploadVideoToStream(
  file: File,
  albumId: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
  resume?: VideoResume,
): Promise<PhotoRow> {
  onProgress(2)

  let uploadUrl: string
  let streamUid: string
  let iframeUrl: string
  let thumbnailUrl: string | null
  let durationSeconds: number
  let videoWidth: number | null
  let videoHeight: number | null
  let posterPromise: Promise<string | null>

  if (resume) {
    // Resuming a previously-failed upload: the Stream session, poster, duration and
    // dimensions all still exist — go straight to TUS, which continues from the offset.
    ;({ uploadUrl, streamUid, iframeUrl, thumbnailUrl, durationSeconds, videoWidth, videoHeight } = resume)
    posterPromise = Promise.resolve(resume.posterUrl)
    onProgress(10)
  } else {
    // Poster frame: gives the grid an immediate thumbnail and captures the duration + true
    // dimensions in the same decode.
    let posterBlob: Blob | null = null
    durationSeconds = 0
    videoWidth = null
    videoHeight = null
    try {
      const posterResult = await generateVideoPoster(file)
      if (posterResult) {
        posterBlob = posterResult.blob
        durationSeconds = posterResult.durationSeconds
        if (posterResult.videoWidth > 0 && posterResult.videoHeight > 0) {
          videoWidth = posterResult.videoWidth
          videoHeight = posterResult.videoHeight
        }
      }
    } catch { /* non-fatal — the Stream thumbnail covers a missing poster */ }
    onProgress(6)

    // Poster presign+PUT runs CONCURRENTLY with the Stream init + TUS upload below — it used
    // to run serially before them, adding its full round-trip time to every video. This
    // promise NEVER rejects (poster is best-effort, and if TUS throws first it goes
    // un-awaited — a rejection here would surface as an unhandled rejection).
    posterPromise = posterBlob
      ? uploadPosterToR2(albumId, posterBlob, signal).catch(() => null)
      : Promise.resolve(null)

    // Init Cloudflare Stream TUS upload (fetchWithRetry gives 20s-per-attempt timeout + retries)
    const initRes = await fetchWithRetry('/api/upload/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        albumId,
        fileName: file.name,
        contentType: file.type,
        fileSize: file.size,  // raw file size — no processing for videos
        // Client-measured duration (from the poster decode) lets the server set a TIGHT
        // maxDurationSeconds. Cloudflare reserves maxDurationSeconds of storage quota for every
        // PENDING upload, so a fixed 6h ceiling made each incomplete/abandoned upload reserve
        // 360 min — a handful exhausted the whole account quota and blocked all video uploads.
        durationSeconds: durationSeconds > 0 ? Math.round(durationSeconds) : undefined,
      }),
    }, { signal })
    if (!initRes.ok) {
      const err = await initRes.json().catch(() => ({})) as { error?: string }
      throw new Error(err.error ?? `Stream init failed (${initRes.status})`)
    }
    // Route returns camelCase: { uploadUrl, streamUid, iframeUrl, thumbnailUrl }
    const init = await readJson<{
      uploadUrl: string; streamUid: string; iframeUrl: string; thumbnailUrl: string
    }>(initRes)
    if (!init.uploadUrl || !init.streamUid || !init.iframeUrl) throw new Error('Stream init returned incomplete response')
    ;({ uploadUrl, streamUid, iframeUrl } = init)
    thumbnailUrl = init.thumbnailUrl ?? null
    onProgress(10)
  }

  // Seed relay state from prior knowledge: this file's own resume record (a previous attempt
  // already proved direct is blocked), or this browser session's flag (a DIFFERENT video already
  // proved it) — either way, skip straight to the relay instead of re-discovering the same block.
  const relayState = { active: (resume?.viaRelay ?? false) || networkNeedsRelay }

  try {
    await runTusWithRecovery(
      file,
      uploadUrl,
      streamUid,
      albumId,
      (fraction) => onProgress(10 + Math.round(fraction * 86)),
      signal,
      relayState,
    )
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    if (resume && isDeterministicTusError(e)) {
      // The resumed upload URL is stale/expired — start over with a fresh Stream session
      // (recursion is bounded: the recursive call passes no `resume`, so it can't loop).
      return uploadVideoToStream(file, albumId, onProgress, signal)
    }
    // Await the poster (never rejects) so the resume record carries it and Retry skips redoing it —
    // but bounded, so a hung poster can't stop this error from surfacing and freeing the lane.
    const posterUrl = await settleWithin(posterPromise, 12_000, null)
    throw new VideoUploadError(
      e instanceof Error ? e.message : 'Video upload failed',
      { uploadUrl, streamUid, iframeUrl, thumbnailUrl, posterUrl, durationSeconds, videoWidth, videoHeight, viaRelay: relayState.active },
      tusHttpStatus(e),
    )
  }

  const posterUrl = await settleWithin(posterPromise, 12_000, null)
  onProgress(98)

  return {
    storage_backend: 'stream',
    media_type: 'video',
    stream_uid: streamUid,
    url: iframeUrl,
    stream_thumbnail_url: thumbnailUrl ?? null,
    poster_url: posterUrl,  // null if poster upload failed; otherwise valid R2 thumbs URL
    duration_seconds: Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Math.round(durationSeconds)
      : null,
    width: videoWidth,
    height: videoHeight,
  }
}

// ─── Incremental DB save ──────────────────────────────────────────────────────

async function saveUploadedRows(albumId: string, rows: PhotoRow[]): Promise<{ warning?: string; rejected?: string[] }> {
  const res = await fetchWithRetry('/api/album/photos/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // albumId (camelCase) — route destructures { albumId, photos }
    body: JSON.stringify({ albumId, photos: rows }),
    // The bytes are already in R2 by the time we get here, so giving up costs a photo rather than
    // an attempt — this call gets the longest patience in the pipeline.
    //
    // Deliberately NO signal, unlike presign and stream-init. Cancelling this does not save work,
    // it strands an uploaded photo: bytes sitting in R2 with no database row, which nothing
    // reconciles server-side. Closing the tab mid-save should still finish the save. Do not "finish
    // the job" by threading the abort signal in here.
  }, { deadlineMs: FETCH_DEADLINE_SAVE_MS })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string; code?: string }
    // Carry the server's code so callers can tell an expected refusal (album full) from a genuine
    // failure, without string-matching an English message.
    throw Object.assign(new Error(err.error ?? `Save failed (${res.status})`), { code: err.code })
  }
  const data = await res.json().catch(() => ({})) as { warning?: string; rejected?: string[] }
  return { warning: data.warning, rejected: data.rejected }
}

// Fire-and-forget telemetry so real guest failures/near-misses surface in /admin. Never throws,
// never blocks the upload, never awaited. keepalive lets it survive a tab close mid-report.
function reportClientEvent(
  level: 'error' | 'warn',
  source: string,
  message: string,
  albumId: string,
  context?: Record<string, unknown>,
): void {
  try {
    void fetch('/api/log/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // build: which bundle produced this. Inlined at compile time, so it identifies the code the
      // BROWSER is running -- not the code the server is serving -- which is the whole point when a
      // long-open tab is still on a version from days ago.
      body: JSON.stringify({
        level, source, message: String(message).slice(0, 500), albumId,
        context: { ...(context ?? {}), build: process.env.NEXT_PUBLIC_BUILD_ID ?? 'unknown' },
      }),
      keepalive: true,
    }).catch(() => {})
  } catch { /* never let telemetry break an upload */ }
}

// Did this file fail because the NETWORK went away, rather than because anything about the file or
// the server was wrong? Only those are worth parking and resuming on our own: the connection coming
// back is a real, observable event that changes the answer, whereas a 413 or an unsupported codec
// will fail identically forever and must stay a plain error with a manual Retry.
//
// Deliberately allow-list, not deny-list: an unrecognised failure stays an error. Parking something
// that can never succeed would leave a tile claiming it is waiting for a network that was never the
// problem — strictly worse than showing the real error straight away.
function isRecoverableNetworkFailure(e: unknown): boolean {
  // A deliberate cancel, and a server that answered (even badly), are both out of scope.
  if (e instanceof DOMException && e.name === 'AbortError') return false
  if (e instanceof HttpError) return false
  // Videos: httpStatus null means no HTTP response ever arrived on ANY attempt, direct or relayed
  // — the same signal runTusWithRecovery uses to decide the network itself is the problem.
  if (e instanceof VideoUploadError) return e.httpStatus === null
  const raw = e instanceof Error ? e.message : String(e)
  // Refusals the product made on purpose are never network failures, whatever else they contain.
  if (/^(File too large|Unsupported)/i.test(raw)) return false
  return /failed to fetch|load failed|network request failed|networkerror|network error during upload|couldn't upload after trying multiple connection methods|couldn't reach the server|upload stalled/i.test(raw)
}

// tus failures stringify their entire request/response internals — a wall of text that
// overflows a phone screen and tells the user nothing. Map known failure shapes to short,
// actionable messages that still NAME the real cause (HTTP status), so a failure screenshot is
// actually diagnostic instead of a generic "connection dropped".
function friendlyUploadError(e: unknown): string {
  const raw = e instanceof Error ? e.message : 'Upload failed'

  // Stale/unreadable picked-file reference: the OS invalidated the file before we could read it.
  // Android reports NotReadableError ("could not be read… permission problems"); iOS/WebKit reports
  // the same underlying failure as NotFoundError ("The object can not be found here.") or a decode
  // SyntaxError ("The string did not match the expected pattern."). All map to the same user action.
  if (/could not be read|NotReadableError|NotFoundError|permission problems|object can not be found|did not match the expected pattern|InvalidStateError/i.test(raw)) {
    return 'Could not read this file from your device. Please remove it and add it again.'
  }

  // Network fetch failed — the presign/save request never reached the server. This message only
  // shows AFTER the retry loop is exhausted, so a persistent failure here usually means the network
  // itself is blocking us (restrictive venue Wi-Fi, a VPN, or an ad-blocker) rather than a one-off
  // blip. Point the user at the actions that actually recover it. "Failed to fetch" (Chrome),
  // "Load failed" (Safari), "NetworkError" — all the same class.
  if (/failed to fetch|load failed|network request failed|networkerror/i.test(raw)) {
    return "Couldn't reach the server after several tries. Switch networks (e.g. mobile data), or turn off any VPN or ad-blocker, then tap Retry."
  }

  // Video (tus) failures: distinguish a real server rejection from a pure network failure.
  const status = e instanceof VideoUploadError ? e.httpStatus : tusHttpStatus(e)
  if (status !== null) {
    if (status === 413) return 'This video is too large to upload.'
    if (status >= 400 && status < 500) return `This video was rejected by the server (HTTP ${status}) — it may be too long or an unsupported format.`
    return `Video server error (HTTP ${status}). Tap Retry — it continues where it left off.`
  }
  // status === null → no HTTP response ever arrived on ANY attempt. Since runTusWithRecovery already
  // falls back to the same-origin relay after the first such failure, a user-visible failure here
  // means BOTH the direct path AND the relay failed — a much rarer, more serious case (true
  // connectivity loss) than a single blocked domain, so the message no longer suggests "your
  // network may be blocking it" specifically.
  if (e instanceof VideoUploadError || /^tus:|stalled/i.test(raw)) {
    return "Couldn't upload after trying multiple connection methods. Check that you're connected to the internet, then tap Retry."
  }

  return raw.length > 160 ? `${raw.slice(0, 157)}…` : raw
}

// Rows are written to the DB in small batches moments after each file finishes uploading —
// NOT in one save after the whole batch. Two wins:
//   - photos appear in the album (via realtime) while the rest of the batch is still uploading
//   - closing the tab mid-batch loses only in-flight files, not every already-uploaded one
//     (bytes in storage with no DB row are permanently orphaned)
// photos/create dedupes on storage_path/stream_uid, so a retried flush is idempotent.
// Larger debounce = fewer photos/create round trips per guest, which matters at event scale
// (hundreds of guests each saving). Rows still batch together, and finish() flushes the
// remainder immediately, so photos appear within a couple seconds of finishing.
const SAVE_DEBOUNCE_MS = 2500

function createRowSaver(
  albumId: string,
  onSaved: (entryIds: string[]) => void,
  onFailed: (entryIds: string[], message: string, code?: string, rows?: PhotoRow[]) => void,
  onWarning?: (message: string) => void,
) {
  let queue: { row: PhotoRow; entryId: string }[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  // Flushes chain serially — a slow save never interleaves with the next one.
  let chain: Promise<void> = Promise.resolve()
  let savedCount = 0
  let warned = false // over-limit nag: show once per upload session, not per saved batch

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null }
    if (queue.length === 0) return
    const batch = queue
    queue = []
    chain = chain.then(async () => {
      try {
        const { warning, rejected } = await saveUploadedRows(albumId, batch.map(b => b.row))
        // The server saves what it can and names what it could not. Ticking the whole batch green
        // on a 200 would mark a video "done" that was never written — the guest sees a finished
        // tile for a video that is not in the album, which is a worse failure than an honest error
        // because nothing prompts them to fix it.
        const refused = new Set(rejected ?? [])
        const lost = refused.size > 0
          ? batch.filter(b => b.row.stream_uid && refused.has(b.row.stream_uid))
          : []
        const saved = lost.length > 0 ? batch.filter(b => !lost.includes(b)) : batch
        savedCount += saved.length
        onSaved(saved.map(b => b.entryId))
        if (lost.length > 0) {
          // Deliberately NO rows passed: the pending-save queue retries the SAVE, and a refused uid
          // will be refused again forever — its upload token is already spent. Re-uploading is what
          // actually works (Retry starts a fresh Stream session), so this has to reach the tile's
          // Retry button rather than the "finish the job" banner.
          onFailed(lost.map(b => b.entryId), 'its upload session had already been used. Tap Retry to send it again.')
        }
        if (warning && !warned) { warned = true; onWarning?.(warning) }
      } catch (e) {
        onFailed(batch.map(b => b.entryId), e instanceof Error ? e.message : 'Failed to save', (e as { code?: string })?.code, batch.map(b => b.row))
      }
    })
  }

  return {
    add(row: PhotoRow, entryId: string) {
      queue.push({ row, entryId })
      if (!timer) timer = setTimeout(flush, SAVE_DEBOUNCE_MS)
    },
    // Flush the remainder and resolve once every pending save settles.
    async finish(): Promise<number> {
      flush()
      await chain
      return savedCount
    },
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  album: Album
  onPhotosUploaded?: () => void
}

// Explicit video MIME types instead of video/* — avoids silently accepting
// .avi/.mkv/etc. that would pass the file picker but be rejected at upload
// Extensions .heic,.heif added alongside MIME types: Windows file pickers may not
// recognize HEIC by MIME type alone and need the extension to filter correctly.
const FILE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/quicktime,video/webm'

export default function UploadZone({ album, onPhotosUploaded }: Props) {
  const { t } = useT()
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  // Rows the server refused because the album is full. Their bytes are already in R2, so finishing
  // them after the owner registers costs a single request rather than a re-upload.
  // Photos whose BYTES ARE ALREADY IN R2 but whose database row was refused. Kept as
  // entry↔row pairs, not a bare row list: retrying must be able to mark exactly the entries it
  // re-saved and no others.
  const pendingSaveRef = useRef<{ entryId: string; row: PhotoRow }[]>([])
  // Why they are pending. 'full' is a refusal the guest can clear by registering; 'failed' is a
  // genuine save failure they can simply retry. Null means nothing is waiting.
  const [pendingSaveReason, setPendingSaveReason] = useState<'full' | 'failed' | null>(null)
  // Mirrored into state purely so the banner re-renders when it changes. Reading the ref during
  // render would show whatever count happened to be there at the last unrelated render.
  const [pendingSaveCount, setPendingSaveCount] = useState(0)
  const [retrying, setRetrying] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Separate input for the in-app camera: `capture` opens the phone's native camera directly.
  const cameraInputRef = useRef<HTMLInputElement>(null)

  // Computed once at mount — userAgent never changes during a session
  const isMobileRef = useRef(typeof navigator !== 'undefined' && /Mobi|Android/i.test(navigator.userAgent))
  const concurrency = isMobileRef.current ? UPLOAD_CONCURRENCY_MOBILE : UPLOAD_CONCURRENCY_DESKTOP
  // Adaptive video lane widens toward this ceiling only as a network proves it can take it.
  const videoMax = isMobileRef.current ? VIDEO_CONCURRENCY_MAX_MOBILE : VIDEO_CONCURRENCY_MAX_DESKTOP

  // The ALBUM's caps, sized server-side by its owner's tier — not the visitor's own tier.
  //
  // The visitor's own tier is the wrong question and was silently costing uploads: a guest at an
  // event has no account, so their tier reads as free, and a Studio album's 4 GB video allowance
  // became a 50 MB wall enforced on the phone before a single byte was sent. The server had always
  // sized it correctly from album.user_id — the two ends simply never compared notes. Now the
  // server's own answer travels with the album, so there is one number and no way to disagree.
  //
  // Falls back to free caps only if an older cached album payload arrives without the field; the
  // server still enforces the real limit either way, so the worst case is a needless local reject
  // rather than a bad upload.
  const caps = useMemo(() => album.media_caps ?? uploadCapsForTier('free'), [album.media_caps])

  // Tracks whether the component is still mounted — prevents onPhotosUploaded firing
  // after unmount which would leak a setTimeout in AlbumPageClient
  const mountedRef = useRef(true)
  // Set (not single ref) so concurrent batches each get their own controller aborted on unmount.
  const abortCtrlsRef = useRef<Set<AbortController>>(new Set())
  useEffect(() => () => {
    mountedRef.current = false
    for (const ctrl of abortCtrlsRef.current) ctrl.abort()
  }, [])

  // Shared semaphore — persists across concurrent addFiles calls so multiple simultaneous
  // drops never each spawn their own Semaphore and multiply the concurrency limit
  const semRef = useRef<Semaphore | null>(null)
  // Separate, tighter semaphore for VIDEOS — keeps large sustained TUS streams from saturating a
  // weak uplink. Photos and videos run in independent lanes. Its capacity is ADAPTIVE (see below).
  const videoSemRef = useRef<Semaphore | null>(null)
  // Adaptive-concurrency state for the video lane (persists across batches for the whole session):
  //   videoCeilingRef — the highest capacity we'll try; drops to 1 permanently once the network fails.
  //   videoStreakRef  — clean video uploads in a row since the last widen/reset.
  const videoCeilingRef = useRef(videoMax)
  const videoStreakRef = useRef(0)

  // Called after every video upload settles. Fail-safe: only widens on a proven clean streak, and
  // snaps back to strictly-serial (and stops probing) the moment the network drops one. The worst
  // this can ever do is behave exactly like a fixed capacity of 1.
  const noteVideoOutcome = useCallback((ok: boolean) => {
    const vs = videoSemRef.current
    if (!vs) return
    if (ok) {
      videoStreakRef.current += 1
      if (videoStreakRef.current >= VIDEO_WIDEN_AFTER_CLEAN && vs.capacity < videoCeilingRef.current) {
        vs.setCapacity(vs.capacity + 1)
        videoStreakRef.current = 0
      }
    } else {
      videoStreakRef.current = 0
      if (vs.capacity > 1) {
        vs.setCapacity(1)
        videoCeilingRef.current = 1 // network showed it can't sustain >1 — don't probe again this session
      }
    }
  }, [])

  // Counter instead of boolean: multiple concurrent batches each increment on start and
  // decrement on finish — isUploading stays true until the last batch completes
  const activeBatchCountRef = useRef(0)

  // Progress updates throttled to 4 Hz to avoid excessive re-renders
  const pendingPatchRef = useRef<Map<string, Partial<FileEntry>>>(new Map())
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushProgress = useCallback(() => {
    if (!mountedRef.current) return
    const pending = pendingPatchRef.current
    if (pending.size === 0) return
    pendingPatchRef.current = new Map()
    setEntries(prev => prev.map(e => {
      const patch = pending.get(e.id)
      return patch ? { ...e, ...patch } : e
    }))
  }, [])

  const patchEntry = useCallback((id: string, patch: Partial<FileEntry>) => {
    if (!mountedRef.current) return
    pendingPatchRef.current.set(id, { ...(pendingPatchRef.current.get(id) ?? {}), ...patch })
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null
        flushProgress()
      }, 250)
    }
  }, [flushProgress])

  useEffect(() => () => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
  }, [])

  const startUploads = useCallback(async (toUpload: FileEntry[]) => {
    if (toUpload.length === 0) return
    activeBatchCountRef.current++
    setIsUploading(true)

    const abortCtrl = new AbortController()
    abortCtrlsRef.current.add(abortCtrl)
    const { signal } = abortCtrl

    // Reuse shared semaphore — prevents concurrent addFiles calls from each spawning
    // a fresh Semaphore instance that would multiply the concurrency limit
    if (!semRef.current) semRef.current = new Semaphore(concurrency)
    const sem = semRef.current
    if (!videoSemRef.current) videoSemRef.current = new Semaphore(VIDEO_CONCURRENCY_START)
    const videoSem = videoSemRef.current

    // Incremental saver: each file's row is written within ~1.2s of its upload finishing.
    // A tile flips to 'done' only once its row is actually IN the database — before that a
    // "done" tile could still be lost by closing the tab.
    const saver = createRowSaver(
      album.id,
      (ids) => { for (const id of ids) patchEntry(id, { status: 'done', progress: 100 }) },
      (ids, msg, code, rows) => {
        // A full album is a REFUSAL, not a fault. It was reported at 'error' with the scary
        // "saving failed" prefix, which (a) told the guest their photos broke when the album was
        // simply full, and (b) flooded /admin -- 39 of ~60 events in one day were this, burying
        // the genuine failures. Real save errors still report as errors.
        const full = code === 'album_full'
        for (const id of ids) {
          patchEntry(id, { status: 'error', error: full ? msg : `Uploaded, but saving to the album failed: ${msg}` })
        }
        // Hold the rows so the job can be finished. Their bytes are already in R2; only the insert
        // was turned away, so "retry" is one request, not a re-upload.
        //
        // This used to be kept ONLY for a full album. On any other save failure the rows were
        // dropped on the floor, which meant the photo was gone: the bytes sat in R2 with no
        // database row, nothing reconciles orphans server-side, and the guest's only option was a
        // full re-upload under a fresh key. A network blip during the save silently cost people
        // photos they had already successfully uploaded.
        if (rows?.length) {
          const pairs = ids.map((entryId, i) => ({ entryId, row: rows[i] })).filter(p => p.row)
          pendingSaveRef.current = [...pendingSaveRef.current, ...pairs]
          setPendingSaveCount(pendingSaveRef.current.length)
          // A cap refusal outranks a transient failure: registering clears both, so if either is
          // outstanding the banner should offer the account.
          setPendingSaveReason(prev => (prev === 'full' || full ? 'full' : 'failed'))
        }
        reportClientEvent(full ? 'warn' : 'error', full ? 'album-full' : 'save', msg, album.id, { count: ids.length })
      },
      // Over-limit nag (once per upload session): the server flags albums past the free allowance.
      (msg) => showAppToast(msg, 'success'),
    )

    // One dropped connection fails every file in flight for the SAME reason. Reporting and
    // toasting each one separately turned a single incident into 98 toasts churning through the
    // viewport, 98 rows in the admin dashboard, and 98 counts against the error-alert threshold —
    // three different surfaces all saying one thing 98 times. Failures are collected here and
    // summarised once the batch settles.
    const batchFailures: { msg: string; kind: string; sizeMB: number; status?: number; parked: boolean; waitedMs?: number }[] = []
    // Which reasons have already been shown to the user in THIS batch. A toast per file turned one
    // dropped connection into a wall of identical messages; a single toast at the end of the batch
    // said nothing until everything had finished failing, which on a long queue is a minute of
    // silence. One toast the first time each DISTINCT reason appears is the useful middle: the
    // person hears immediately that something is wrong, hears once per kind of problem, and two
    // genuinely different problems still both get said.
    const announced = new Set<string>()

    const run = async () => {
      await Promise.all(toUpload.map(async (entry) => {
        // Detect kind BEFORE acquiring so videos take the dedicated (tighter) lane and photos the
        // wider one — otherwise several videos could grab the shared pool and saturate the uplink.
        const kind = detectKind(entry.file)
        const gate = kind === 'video' ? videoSem : sem
        // Size-aware lane: a big video takes the WHOLE video lane (uploads solo, no bandwidth
        // competition); short clips and all images weigh 1 and overlap.
        const weight = kind === 'video' && entry.file.size >= VIDEO_SOLO_LANE_BYTES ? videoSem.capacity : 1
        const release = await gate.acquire(weight)
        try {
          patchEntry(entry.id, { status: 'uploading', progress: 0 })

          if (!kind) throw new Error('Unsupported file type')

          // Videos upload their raw bytes — cap the original size. Images are compressed
          // client-side first, so their cap is enforced on the processed size inside
          // uploadImageToR2 (a 30MB photo that compresses to 1MB should upload fine).
          if (kind === 'video' && entry.file.size > caps.video) {
            throw new Error(tooLargeMessage('video', caps.video))
          }

          const row = kind === 'image'
            ? await uploadImageToR2(entry.file, album.id, caps.image, pct => patchEntry(entry.id, { progress: pct }), signal)
            : await uploadVideoToStream(entry.file, album.id, pct => patchEntry(entry.id, { progress: pct }), signal, entry.videoResume)

          // Bytes are in storage; the saver flips this tile to 'done' when the row commits.
          patchEntry(entry.id, { progress: 100, videoResume: undefined })
          saver.add(row, entry.id)
          if (kind === 'video') noteVideoOutcome(true) // clean video → adaptive lane may widen
        } catch (e) {
          const msg = friendlyUploadError(e)
          // Park a network failure instead of killing it — but only once per file. On 2026-08-18 at
          // 19:47 one Android phone lost its connection and 8 files (5 images, 3 videos) died at the
          // control plane with no bytes moved; nothing watched for the network coming back, so they
          // sat as red tiles until the guest happened to look. A phone that goes back in a pocket
          // took those photos with it. The File objects are still in memory, so the uploader can
          // simply wait and try again.
          const parked = isRecoverableNetworkFailure(e) && !entry.autoResumed
          patchEntry(entry.id, {
            status: parked ? 'waiting' : 'error',
            error: msg,
            // Keep the resume state so Retry continues this video from its confirmed offset
            // instead of restarting from zero.
            ...(e instanceof VideoUploadError && e.resume ? { videoResume: e.resume } : {}),
          })
          // A refusal is not a failure. Too-large and unsupported-type mean the product looked at
          // the file and correctly declined it — the same class of event as hitting the album cap,
          // which is already logged at warn. Logged as errors they sat in the admin Errors tab
          // implying something was broken: a 103 MB video refused twice on 2026-08-18 was two of
          // the four "errors" outstanding, and nothing was wrong.
          const expectedRejection = e instanceof Error
            && (e.message.startsWith('File too large') || e.message.startsWith('Unsupported'))
          // Adaptive lane: a genuine upload failure (not a user cancel, not a pre-upload reject)
          // means the network can't take the current concurrency — snap back to serial and stop
          // probing. Same distinction as above, so it is now made once.
          if (kind === 'video' && !(e instanceof DOMException && e.name === 'AbortError') && !expectedRejection) {
            noteVideoOutcome(false)
          }
          // Surface the real error (it was previously hidden in a title tooltip, invisible on
          // mobile). AbortError is a deliberate cancel, not worth toasting.
          if (!(e instanceof DOMException && e.name === 'AbortError')) {
            // Recorded for the grouped admin report sent once the batch settles; the toast below
            // is deduplicated by reason so the same failure is never said twice.
            batchFailures.push({
              msg: e instanceof Error ? e.message : String(e),
              kind: kind === 'video' ? 'upload:video' : 'upload:image',
              sizeMB: Math.round(entry.file.size / 1024 / 1024),
              status: e instanceof HttpError ? e.status : undefined,
              parked,
              // How long the control plane fought before giving up (see fetchWithRetry). Reported
              // as context rather than message text so it cannot fragment the grouping.
              waitedMs: typeof (e as { waitedMs?: unknown })?.waitedMs === 'number'
                ? (e as { waitedMs: number }).waitedMs
                : undefined,
            })
            // `msg` here is the friendly text, so two files that failed the same way produce the
            // same key and the second one stays quiet. A parked file says nothing at all: it is
            // about to retry itself, its tile already says so, and an error toast for something the
            // uploader is still working on trains people to ignore the toasts that do matter.
            if (!parked && !announced.has(msg)) {
              announced.add(msg)
              showAppToast(msg, 'error')
            }
          }
        } finally {
          release()
        }
      }))
    }

    // navigator.locks prevents Android from suspending the tab mid-upload.
    // shared mode: multiple tabs can each hold the lock simultaneously —
    // a second album tab never blocks waiting for the first to finish.
    if (typeof navigator !== 'undefined' && 'locks' in navigator) {
      await navigator.locks.request('hushare-upload', { mode: 'shared' }, run)
    } else {
      await run()
    }

    // One report per distinct reason, carrying how many files it hit — so the admin dashboard and
    // the alert threshold both see one incident rather than a hundred, without losing the count.
    if (batchFailures.length > 0) {
      const groups = new Map<string, { n: number; sample: typeof batchFailures[number] }>()
      for (const f of batchFailures) {
        const key = `${f.kind}|${f.msg}`
        const g = groups.get(key)
        if (g) g.n++
        else groups.set(key, { n: 1, sample: f })
      }
      for (const { n, sample } of groups.values()) {
        const expected = sample.msg.startsWith('File too large') || sample.msg.startsWith('Unsupported')
        // A parked failure is not (yet) a lost photo — the uploader is going to retry it by itself.
        // Reporting it at error level would put a row in the Errors tab, and a count against the
        // error-alert threshold, for an incident the product is in the middle of handling
        // correctly; on ordinary venue Wi-Fi that is the dashboard crying wolf all evening. It is
        // still reported, at warn, because how often guests hit this is worth knowing. If auto-
        // resume then fails, that second failure is not parked and lands as a real error.
        const level = expected || sample.parked ? 'warn' : 'error'
        reportClientEvent(level, sample.kind, sample.msg, album.id, {
          failedFiles: n,
          sizeMB: sample.sizeMB,
          status: sample.status,
          ...(sample.parked ? { parked: true } : {}),
          ...(sample.waitedMs !== undefined ? { waitedSeconds: Math.round(sample.waitedMs / 1000) } : {}),
        })
      }
    }

    const savedCount = await saver.finish()
    flushProgress()

    // Decrement before onPhotosUploaded so if the parent unmounts UploadZone
    // the queued setState call is already the final one
    activeBatchCountRef.current--
    setIsUploading(activeBatchCountRef.current > 0)
    // Only notify parent when at least one photo actually landed in the DB,
    // and only if still mounted (prevents leaking a timer in AlbumPageClient)
    if (mountedRef.current && savedCount > 0) onPhotosUploaded?.()
    abortCtrlsRef.current.delete(abortCtrl)
  }, [album.id, caps, concurrency, noteVideoOutcome, patchEntry, flushProgress, onPhotosUploaded])

  const addFiles = useCallback((files: File[]) => {
    const valid = files.filter(f => detectKind(f) !== null)
    if (valid.length === 0) return
    const newEntries: FileEntry[] = valid.map(f => ({
      id: crypto.randomUUID(),
      file: f,
      status: 'pending' as const,
      progress: 0,
      // Object URL for both images and videos — the tile renders a <video> for videos (which
      // shows its first frame). Cheaper and more reliable than decoding a poster here (which
      // would double-decode against the poster generated during the actual upload).
      preview: URL.createObjectURL(f),
    }))
    setEntries(prev => [...prev, ...newEntries])
    void startUploads(newEntries)
  }, [startUploads])

  const handleInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''  // allow re-selecting same file after error
    addFiles(await snapshotFiles(files))
  }, [addFiles])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    addFiles(await snapshotFiles(files))
  }, [addFiles])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false)
  }, [])

  const retryEntry = useCallback((id: string) => {
    // Same defect as the bulk path: `fresh` was assigned inside a setState updater and read on the
    // next line, before React had run it, so it was always null and startUploads was never called.
    // The tile flipped to "Preparing" and stayed there.
    const entry = entries.find(e => e.id === id)
    // 'waiting' is tappable too: the tile offers an immediate retry for anyone who would rather not
    // wait for the probe.
    if (!entry || (entry.status !== 'error' && entry.status !== 'waiting')) return
    const fresh: FileEntry = {
      ...entry, status: 'pending', progress: 0, error: undefined,
      // Tapping a PARKED tile only skips the wait — same recovery cycle, so it consumes the one
      // automatic resume and a second network failure becomes a real error. Tapping a genuinely
      // FAILED tile is a fresh decision by someone who may have just switched to mobile data, so it
      // earns a new one; without this reset the retry they were invited to make would be the one
      // attempt that is never allowed to park.
      autoResumed: entry.status === 'waiting',
    }
    setEntries(prev => prev.map(e => (e.id === id ? fresh : e)))
    void startUploads([fresh])
  }, [entries, startUploads])

  const dismissDone = useCallback(() => {
    setEntries(prev => {
      for (const e of prev) if (e.status === 'done' && e.preview) URL.revokeObjectURL(e.preview)
      return prev.filter(e => e.status !== 'done')
    })
  }, [])

  // Revoke any remaining preview object URLs when the component unmounts.
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  useEffect(() => () => {
    for (const e of entriesRef.current) if (e.preview) URL.revokeObjectURL(e.preview)
  }, [])

  const doneCount    = entries.filter(e => e.status === 'done').length
  const errorCount   = entries.filter(e => e.status === 'error').length
  const activeCount  = entries.filter(e => e.status === 'uploading' || e.status === 'pending').length
  const waitingCount = entries.filter(e => e.status === 'waiting').length

  async function retryBlockedRows() {
    const pending = pendingSaveRef.current
    if (retrying || pending.length === 0) return
    setRetrying(true)
    try {
      await saveUploadedRows(album.id, pending.map(p => p.row))
      pendingSaveRef.current = []
      setPendingSaveCount(0)
      setPendingSaveReason(null)
      // Mark ONLY the entries whose rows were actually in this request. This used to flip every
      // entry with status 'error' to 'done', so in a mixed batch a photo that genuinely failed to
      // upload was given a green tick alongside the ones that really were saved — telling the
      // guest their photos were safe when those photos did not exist.
      const saved = new Set(pending.map(p => p.entryId))
      setEntries(prev => prev.map(e => (
        saved.has(e.id) ? { ...e, status: 'done', error: undefined, progress: 100 } : e
      )))
      onPhotosUploaded?.()
      showAppToast(t('uploadWall.saved', { n: pending.length }), 'success')
    } catch (e) {
      showAppToast(e instanceof Error ? e.message : t('common.errorGeneric'), 'error')
    } finally {
      setRetrying(false)
    }
  }

  // On 2026-08-17 at 23:34 a single Android phone lost its connection mid-batch: 41 photos landed
  // and 52 failed together as their retry deadlines expired. The uploader had already fought for
  // two minutes per file — the connection was simply gone — but there was nothing to do afterwards
  // except find those 52 photos in the camera roll and pick them again by hand. The File objects
  // are still in memory, so one tap is enough. This matters most at exactly the moment it is
  // hardest: a venue full of people sharing one saturated access point.
  const failedCount = entries.reduce((n, e) => (e.status === 'error' ? n + 1 : n), 0)
  const [failedOpen, setFailedOpen] = useState(false)
  const retryingRef = useRef(false)
  // Grouped by message, because a dropped connection fails every file in flight with the SAME
  // reason: 98 identical rows is not 98 pieces of information, it is one, repeated until the
  // person stops reading. One line per distinct reason, with a count.
  const failedByReason = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entries) {
      if (e.status !== 'error') continue
      const key = e.error?.trim() || t('upload.retry.unknown')
      m.set(key, (m.get(key) ?? 0) + 1)
    }
    return [...m.entries()].sort((x, y) => y[1] - x[1])
  }, [entries, t])
  // ── Auto-resume parked uploads ────────────────────────────────────────────────────────────────
  //
  // Deliberately NOT driven by the 'online' event. navigator.onLine reports whether the device is
  // ASSOCIATED with a network, not whether anything gets through — a phone on a saturated venue
  // access point stays onLine === true for the entire outage, so 'online' never fires and a
  // listener would sleep through exactly the case this exists for (the same reasoning as
  // originReachable). Asking the origin directly is the only question worth asking, and
  // originRecovered is already polling on behalf of any upload still in flight, so joining it
  // costs nothing extra.
  const resumeWaitingRef = useRef(false)
  // Reads entriesRef rather than closing over `entries`, so the callback identity is stable and the
  // effect below is driven purely by files entering the parked state. Deriving the list here (not
  // inside a setState updater) is the same correctness point the two manual retry paths were fixed
  // for: React defers updaters, so a list read back on the next line is always empty and
  // startUploads gets called with nothing while the tiles sit marked "Preparing" forever.
  const resumeWaitingUploads = useCallback(() => {
    const fresh = entriesRef.current
      .filter(e => e.status === 'waiting')
      .map(e => ({ ...e, status: 'pending' as const, progress: 0, error: undefined, autoResumed: true }))
    if (fresh.length === 0) return
    const byId = new Map(fresh.map(e => [e.id, e]))
    setEntries(prev => prev.map(e => byId.get(e.id) ?? e))
    void startUploads(fresh)
  }, [startUploads])

  useEffect(() => {
    if (waitingCount === 0 || resumeWaitingRef.current) return
    resumeWaitingRef.current = true
    // No per-effect cancellation flag, deliberately. Files park in waves — the images give up on
    // their deadline before the serial videos reach theirs — so waitingCount changes WHILE the
    // probe is in flight. A flag cancelled by that re-render would abandon the only probe running
    // (the re-run returns early on the ref guard), and every parked file would wait forever for a
    // resume that had already been called off. The probe is page-wide and the callback resumes
    // whatever is parked at the moment it resolves, so simply letting it finish is both correct and
    // what makes the later arrivals recover in the same sweep. mountedRef is the only guard needed.
    void originRecovered().then((recovered) => {
      if (!mountedRef.current) return
      if (recovered) { resumeWaitingUploads(); return }
      // The shared probe hit its 4-minute cap and the origin is still unreachable. Stop promising a
      // resume that is not coming: hand these back as ordinary errors so the failed chip appears
      // and the guest gets the Retry button, which is where this used to start. They keep the
      // message they already carry, so nothing about the explanation changes.
      setEntries(prev => prev.map(e => (e.status === 'waiting' ? { ...e, status: 'error' as const } : e)))
      // Release in `finally`, never in the success path alone: a throw anywhere above would
      // otherwise leave this latched forever and silently disable auto-resume for the rest of the
      // session — the files would sit parked with nothing left watching for the network.
    }).catch(() => {}).finally(() => { resumeWaitingRef.current = false })
  }, [waitingCount, resumeWaitingUploads])

  const retryFailedUploads = useCallback(() => {
    // Derived from `entries` rather than from inside a setState updater. A functional updater does
    // NOT run synchronously — React defers it to the render phase — so the previous version read
    // its result on the very next line, always got an empty array, and called startUploads([]),
    // which returns immediately on an empty list. The files were left marked "Preparing" with
    // nothing scheduled to upload them: stuck forever, and silent about it.
    if (retryingRef.current) return
    const fresh = entries
      .filter(e => e.status === 'error')
      .map(e => ({
        ...e, status: 'pending' as const, progress: 0, error: undefined,
        // Same rule as the single-tile Retry: a deliberate retry of a failed file earns a fresh
        // automatic recovery, so a drop during THIS attempt parks and heals itself rather than
        // landing straight back in the failed chip.
        autoResumed: false,
      }))
    if (fresh.length === 0) return
    // Ref guard replaces the atomicity the updater was supposed to provide: a second tap before
    // the state has settled cannot start the same files twice.
    retryingRef.current = true
    const byId = new Map(fresh.map(e => [e.id, e]))
    setEntries(prev => prev.map(e => byId.get(e.id) ?? e))
    void startUploads(fresh).finally(() => { retryingRef.current = false })
  }, [entries, startUploads])

  return (
    <div className="hush-upload-zone px-3 sm:px-4 pt-2 pb-4">
      {/* Deliberately a small chip rather than the banner this used to be. Something failing is
          worth surfacing, not worth taking over the screen — most of the time the person just
          wants to carry on adding photos. It only exists while there is something in it, opens on
          tap, and stays put until the files are retried, so a guest who looks away mid-upload can
          still find out what did not make it. */}
      {failedCount > 0 && (
        <div style={{ marginBottom: 10 }}>
          <button
            type="button"
            onClick={() => setFailedOpen((v) => !v)}
            aria-expanded={failedOpen}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600,
              color: '#7A4A1F', background: '#FBF0E6', border: '1px solid #E8D3BC',
              borderRadius: 999, padding: '6px 12px', cursor: 'pointer',
            }}
          >
            <span style={{
              minWidth: 18, height: 18, borderRadius: 999, background: '#7A4A1F', color: '#FDFAF5',
              fontSize: 11, fontWeight: 700, lineHeight: '18px', textAlign: 'center', padding: '0 5px',
            }}>{failedCount}</span>
            {t('upload.retry.chip')}
            <span aria-hidden="true" style={{ fontSize: 10, opacity: 0.7 }}>{failedOpen ? '▲' : '▼'}</span>
          </button>

          {failedOpen && (
            <div style={{ marginTop: 8, padding: 12, borderRadius: 12, background: '#FBF0E6', border: '1px solid #E8D3BC' }}>
              <p style={{ margin: '0 0 8px', fontSize: 13, lineHeight: 1.5, color: '#5C4A3C' }}>
                {t('upload.retry.body')}
              </p>
              <ul style={{ margin: '0 0 10px', padding: 0, listStyle: 'none' }}>
                {failedByReason.map(([reason, n]) => (
                  <li key={reason} style={{ fontSize: 12.5, color: '#5C4A3C', margin: '0 0 4px' }}>
                    <strong>{n}×</strong> {reason}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => { setFailedOpen(false); retryFailedUploads() }}
                style={{ fontSize: 13.5, fontWeight: 700, color: '#FDFAF5', background: '#7A4A1F', border: 'none', borderRadius: 10, padding: '8px 16px', cursor: 'pointer' }}
              >
                {t('upload.retry.action', { n: failedCount })}
              </button>
            </div>
          )}
        </div>
      )}
      {/* The wall, as an offer rather than an error. Hitting the cap is the moment of highest
          intent — the visitor is actively trying to hand over their photos — and it used to be a
          red failure that lost their place. One guest retried 39 times and never registered.
          Sign-up opens in a NEW TAB so this page, its queue and the already-uploaded bytes all
          survive; coming back and pressing Finish saving costs one request. */}
      {pendingSaveReason && (
        <div style={{ marginBottom: 12, padding: 14, borderRadius: 14, background: '#F6E9EE', border: '1px solid #E3C9D3' }}>
          <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: '#630826' }}>
            {pendingSaveReason === 'full' ? t('uploadWall.title') : t('uploadWall.failedTitle', { n: pendingSaveCount })}
          </p>
          <p style={{ margin: '0 0 12px', fontSize: 13.5, lineHeight: 1.5, color: '#5C4A3C' }}>
            {pendingSaveReason === 'full'
              ? t('uploadWall.body', { n: pendingSaveCount })
              : t('uploadWall.failedBody', { n: pendingSaveCount })}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* Registering only helps when the album is FULL. Offering an account to someone whose
                save merely hit a network blip would be noise in front of the button they need. */}
            {pendingSaveReason === 'full' && (
            <a
              href="/login" target="_blank" rel="noopener noreferrer" className="hush-press"
              style={{ padding: '10px 18px', fontSize: 14, fontWeight: 700, color: '#FDFAF5', background: '#630826', borderRadius: 10, textDecoration: 'none' }}
            >
              {t('uploadWall.cta')}
            </a>
            )}
            <button
              type="button" onClick={() => void retryBlockedRows()} disabled={retrying} className="hush-press"
              style={{ padding: '10px 18px', fontSize: 14, fontWeight: 700, color: '#630826', background: '#FFFFFF', border: '1.5px solid #E3C9D3', borderRadius: 10, cursor: retrying ? 'wait' : 'pointer' }}
            >
              {retrying ? t('uploadWall.saving') : t('uploadWall.retry')}
            </button>
          </div>
        </div>
      )}
      {/* Drop zone — compact on mobile, roomier on desktop */}
      <div
        role="button"
        tabIndex={0}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
        className="group flex flex-col items-center justify-center gap-1.5 sm:gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-4 sm:py-9 px-4 select-none"
        style={{
          borderColor: isDragging ? '#630826' : '#D8CBB8',
          background: isDragging ? 'rgba(99,8,38,0.06)' : 'rgba(99,8,38,0.015)',
        }}
        aria-label="Click or drag files to upload photos and videos"
      >
        <div
          className="flex items-center justify-center rounded-full transition-transform group-hover:scale-105 w-9 h-9 sm:w-[52px] sm:h-[52px]"
          style={{ background: isDragging ? '#630826' : 'rgba(99,8,38,0.10)' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={isDragging ? '#FDFAF5' : '#630826'} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-sm sm:text-[0.95rem]" style={{ fontWeight: 600, color: '#630826' }}>
            {isDragging ? t('upload.drop') : t('upload.add')}
          </p>
          <p className="text-xs sm:text-[0.8rem]" style={{ color: '#8A7A66', marginTop: 2 }}>
            {t('upload.dragdrop')} <span style={{ color: '#630826', fontWeight: 600 }}>{t('upload.browse')}</span>
          </p>
        </div>
        {/* Format pills — hidden on mobile to keep the drop zone compact */}
        <div className="hidden sm:flex flex-wrap items-center justify-center gap-1" style={{ maxWidth: 320 }}>
          {['JPEG', 'PNG', 'GIF', 'WebP', 'HEIC', 'MP4', 'MOV', 'WebM'].map(f => (
            <span
              key={f}
              className="rounded-full px-2 py-0.5"
              style={{ fontSize: '0.62rem', fontWeight: 600, letterSpacing: '0.02em', color: '#8A7A66', background: 'rgba(60,43,31,0.05)' }}
            >
              {f}
            </span>
          ))}
        </div>
      </div>

      {/* In-app camera — mobile only (sm:hidden). `capture="environment"` opens the phone's rear
          camera directly; the captured photo flows into the exact same upload path as a picked
          file. Pure CSS gating (no JS/userAgent conditional) so there's no SSR hydration mismatch.
          On the rare narrow desktop it degrades to a normal file dialog (capture is ignored). */}
      <button
        type="button"
        onClick={() => cameraInputRef.current?.click()}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl py-3 font-semibold transition-transform active:scale-[0.99] sm:hidden"
        style={{ background: '#630826', color: '#FDFAF5' }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
        {t('upload.camera')}
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={FILE_ACCEPT}
        className="sr-only"
        onChange={handleInputChange}
        aria-hidden="true"
        tabIndex={-1}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={handleInputChange}
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* File grid — thumbnails upload in parallel with a progress overlay each */}
      {entries.length > 0 && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-2">
            {entries.map(entry => {
              const isVid = entry.file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(entry.file.name)
              const active = entry.status === 'uploading' || entry.status === 'pending'
              return (
                <div
                  key={entry.id}
                  className="relative rounded-xl overflow-hidden"
                  style={{ width: 84, height: 84, background: '#EFE7DA', border: '1px solid #E3D8C7' }}
                  title={entry.status === 'error' ? entry.error : entry.status === 'waiting' ? t('upload.waitingNetwork') : entry.file.name}
                >
                  {entry.preview && isVid ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video src={entry.preview} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                  ) : entry.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.preview} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center" style={{ color: '#A08B6E' }}>
                      {isVid ? (
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                      ) : (
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                      )}
                    </div>
                  )}

                  {/* uploading overlay */}
                  {active && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: 'rgba(27,46,26,0.48)' }}>
                      <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#FDFAF5', borderTopColor: 'transparent' }} aria-label="Uploading" />
                      {/* Below 16% is the decode + presign/stream-init phase (before bytes flow). On slow
                          Wi-Fi that can sit a while, so show "preparing…" — reads as active, not frozen at a
                          low number — and switch to a live % once the actual upload of bytes begins. */}
                      <span className="mt-1 text-[9px] font-bold tabular-nums" style={{ color: '#FDFAF5' }}>
                        {entry.progress < 16 ? 'preparing…' : `${entry.progress}%`}
                      </span>
                      <div className="absolute bottom-0 left-0 right-0" style={{ height: 3, background: 'rgba(255,255,255,0.25)' }}>
                        <div className="h-full transition-all duration-300" style={{ width: `${entry.progress}%`, background: '#FDFAF5' }} />
                      </div>
                    </div>
                  )}

                  {/* done check */}
                  {entry.status === 'done' && (
                    <div className="absolute top-1 right-1 rounded-full flex items-center justify-center" style={{ width: 18, height: 18, background: '#630826', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} aria-label="Done">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FDFAF5" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    </div>
                  )}

                  {/* Parked on a dead network — the uploader resumes this by itself. Deliberately
                      NOT the red error treatment: nothing has been lost and there is nothing for
                      the guest to do, so it reads as a pause (amber, a clock) rather than a
                      failure. Tapping still forces an immediate retry for anyone who would rather
                      not wait. */}
                  {entry.status === 'waiting' && (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); retryEntry(entry.id) }}
                      className="absolute inset-0 flex flex-col items-center justify-center"
                      style={{ background: 'rgba(122,74,14,0.62)' }}
                      aria-label={`${t('upload.waitingNetwork')} — ${entry.file.name}`}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FDFAF5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>
                      <span className="mt-0.5 text-center text-[9px] font-bold leading-tight" style={{ color: '#FDFAF5' }}>{t('upload.waitingNetwork')}</span>
                    </button>
                  )}

                  {/* error overlay → click to retry */}
                  {entry.status === 'error' && (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); retryEntry(entry.id) }}
                      className="absolute inset-0 flex flex-col items-center justify-center"
                      style={{ background: 'rgba(150,32,22,0.66)' }}
                      aria-label={`Retry ${entry.file.name}`}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FDFAF5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                      <span className="mt-0.5 text-[10px] font-bold" style={{ color: '#FDFAF5' }}>{t('upload.retry')}</span>
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Summary row. Parked files are counted separately from failed ones — folding them into
              "failed" would tell the guest photos were lost at the exact moment the uploader is
              still working on getting them up. */}
          {!isUploading && activeCount === 0 && (doneCount > 0 || errorCount > 0 || waitingCount > 0) && (
            <div className="flex items-center justify-between mt-3 px-1">
              <span className="text-xs" style={{ color: '#7C6752' }}>
                {doneCount > 0 && t('upload.uploaded', { n: doneCount })}
                {doneCount > 0 && errorCount > 0 && ' · '}
                {errorCount > 0 && t('upload.failed', { n: errorCount })}
                {(doneCount > 0 || errorCount > 0) && waitingCount > 0 && ' · '}
                {waitingCount > 0 && t('upload.waitingCount', { n: waitingCount })}
              </span>
              {doneCount > 0 && (
                <button type="button" onClick={dismissDone} className="text-xs font-semibold" style={{ color: '#630826' }}>
                  {t('upload.clear')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
