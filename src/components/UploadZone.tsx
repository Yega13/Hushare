'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as tus from 'tus-js-client'
import type { Album, Tier } from '@/types'
import { stripExifFromJpeg, jpegOrientation } from '@/lib/exif'
import { snapshotFileRobust, readFileRobust } from '@/lib/file-read'
import { showAppToast } from '@/components/AppToast'
import { useT } from '@/i18n/LocaleProvider'
import { detectKind, uploadCapsForTier, generateVideoPoster } from '@/lib/media'
import {
  UPLOAD_CONCURRENCY_MOBILE,
  UPLOAD_CONCURRENCY_DESKTOP,
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

class Semaphore {
  private slots: number
  private queue: (() => void)[] = []
  constructor(capacity: number) { this.slots = capacity }
  acquire(): Promise<void> {
    if (this.slots > 0) { this.slots--; return Promise.resolve() }
    return new Promise<void>(res => this.queue.push(res))
  }
  release(): void {
    const next = this.queue.shift()
    if (next) { next() } else { this.slots++ }
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
  await decodeSem.acquire()
  try {
    return await processImageInner(file)
  } finally {
    decodeSem.release()
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

    // Small PNG/WebP: original bytes untouched (no EXIF concern).
    return { blob: file, thumbBlob, mimeType, name: file.name, width: bitmap.width, height: bitmap.height }
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

async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, backoffDelay(attempt)))
    try {
      // Per-attempt timeout: a hung request should burn 20s, not hang the file forever.
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) })
      if (res.status >= 500 && attempt < attempts - 1) {
        lastErr = new Error(`HTTP ${res.status}`)
        continue
      }
      return res
    } catch (e) {
      // TimeoutError (per-attempt cap above) and network TypeErrors are both retryable.
      lastErr = e instanceof Error ? e : new Error(String(e))
    }
  }
  throw lastErr ?? new Error('Network request failed')
}

// The old policy threw on ANY HTTP error — including R2's transient 500/502/503s, which are
// exactly the errors a retry fixes. Only 4xx (bad/expired signature, too large) is deterministic.
async function putWithRetry(
  url: string,
  body: Blob,
  contentType: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
  attempts = 5,
): Promise<void> {
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError')
    if (attempt > 0) await new Promise(r => setTimeout(r, backoffDelay(attempt)))
    try {
      await xhrPut('PUT', url, body, contentType, onProgress, signal)
      return
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      if (e instanceof HttpError && e.status < 500) throw e
      lastErr = e instanceof Error ? e : new Error(String(e))
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
let imageNetworkNeedsRelay = false

// Every relay attempt re-runs the FULL server-side authorization chain (both rate-limit checks +
// album/tier lookups) — unlike a direct PUT retry, which just re-sends bytes to an already-signed
// URL. Capped lower than putWithRetry's 5 attempts to avoid multiplying DB load across retries.
const IMAGE_RELAY_ATTEMPTS = 2

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
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < IMAGE_RELAY_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError')
    if (attempt > 0) await new Promise(r => setTimeout(r, backoffDelay(attempt)))
    try {
      const text = await xhrPut('POST', url, body, contentType, onProgress, signal)
      return JSON.parse(text) as { key: string; publicUrl: string }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      // A 4xx from the relay (rate limited, oversized, disabled) is a final verdict — never retried,
      // mirroring putWithRetry's policy for the direct path.
      if (e instanceof HttpError && e.status < 500) throw e
      lastErr = e instanceof Error ? e : new Error(String(e))
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
  if (!imageNetworkNeedsRelay) {
    try {
      await putWithRetry(presignedUrl, body, relay.contentType, onProgress, signal)
      return { key: originalKey, publicUrl: originalPublicUrl }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      if (e instanceof HttpError) throw e
      imageNetworkNeedsRelay = true
      reportClientEvent('warn', 'upload:image-relay', 'Switched to relay after direct upload was network-blocked', relay.albumId, { fileName: relay.fileName })
    }
  }
  try {
    return await relayUploadImage(relay.albumId, relay.fileName, relay.contentType, relay.isThumb, body, onProgress, signal)
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
  status: 'pending' | 'uploading' | 'done' | 'error'
  progress: number
  error?: string
  preview?: string  // object URL for the image thumbnail (revoked on clear/unmount)
  videoResume?: VideoResume  // set when a video fails mid-TUS; Retry resumes from the offset
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
    throw new Error(`File too large (max ${Math.round(imageCapBytes / 1024 / 1024)} MB for your tier)`)
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
  })
  if (!presignRes.ok) {
    const err = await presignRes.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? `Presign failed (${presignRes.status})`)
  }
  const { presignedUrl, key, publicUrl, thumb } = await presignRes.json() as {
    presignedUrl: string
    key: string
    publicUrl: string
    thumb?: { presignedUrl: string; key: string; publicUrl: string }
  }
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
  })
  if (!presign.ok) throw new Error(`Poster presign failed (${presign.status})`)
  const { presignedUrl, key, publicUrl } = await presign.json() as { presignedUrl: string; key: string; publicUrl: string }
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
      await runTusOnce(file, effectiveUrl, onFraction, signal)
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
    })
    if (!initRes.ok) {
      const err = await initRes.json().catch(() => ({})) as { error?: string }
      throw new Error(err.error ?? `Stream init failed (${initRes.status})`)
    }
    // Route returns camelCase: { uploadUrl, streamUid, iframeUrl, thumbnailUrl }
    const init = await initRes.json() as {
      uploadUrl: string; streamUid: string; iframeUrl: string; thumbnailUrl: string
    }
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
    // Await the poster (never rejects) so the resume record carries it and Retry skips redoing it.
    const posterUrl = await posterPromise
    throw new VideoUploadError(
      e instanceof Error ? e.message : 'Video upload failed',
      { uploadUrl, streamUid, iframeUrl, thumbnailUrl, posterUrl, durationSeconds, videoWidth, videoHeight, viaRelay: relayState.active },
      tusHttpStatus(e),
    )
  }

  const posterUrl = await posterPromise
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

async function saveUploadedRows(albumId: string, rows: PhotoRow[]): Promise<void> {
  const res = await fetchWithRetry('/api/album/photos/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // albumId (camelCase) — route destructures { albumId, photos }
    body: JSON.stringify({ albumId, photos: rows }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? `Save failed (${res.status})`)
  }
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
      body: JSON.stringify({ level, source, message: String(message).slice(0, 500), albumId, context }),
      keepalive: true,
    }).catch(() => {})
  } catch { /* never let telemetry break an upload */ }
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
  onFailed: (entryIds: string[], message: string) => void,
) {
  let queue: { row: PhotoRow; entryId: string }[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  // Flushes chain serially — a slow save never interleaves with the next one.
  let chain: Promise<void> = Promise.resolve()
  let savedCount = 0

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null }
    if (queue.length === 0) return
    const batch = queue
    queue = []
    chain = chain.then(async () => {
      try {
        await saveUploadedRows(albumId, batch.map(b => b.row))
        savedCount += batch.length
        onSaved(batch.map(b => b.entryId))
      } catch (e) {
        onFailed(batch.map(b => b.entryId), e instanceof Error ? e.message : 'Failed to save')
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
  userTier: Tier
  onPhotosUploaded?: () => void
}

// Explicit video MIME types instead of video/* — avoids silently accepting
// .avi/.mkv/etc. that would pass the file picker but be rejected at upload
// Extensions .heic,.heif added alongside MIME types: Windows file pickers may not
// recognize HEIC by MIME type alone and need the extension to filter correctly.
const FILE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/quicktime,video/webm'

export default function UploadZone({ album, userTier, onPhotosUploaded }: Props) {
  const { t } = useT()
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Computed once at mount — userAgent never changes during a session
  const isMobileRef = useRef(typeof navigator !== 'undefined' && /Mobi|Android/i.test(navigator.userAgent))
  const concurrency = isMobileRef.current ? UPLOAD_CONCURRENCY_MOBILE : UPLOAD_CONCURRENCY_DESKTOP

  // Memoized so startUploads/addFiles/retryEntry are not rebuilt on every progress flush
  const caps = useMemo(() => uploadCapsForTier(userTier), [userTier])

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

    // Incremental saver: each file's row is written within ~1.2s of its upload finishing.
    // A tile flips to 'done' only once its row is actually IN the database — before that a
    // "done" tile could still be lost by closing the tab.
    const saver = createRowSaver(
      album.id,
      (ids) => { for (const id of ids) patchEntry(id, { status: 'done', progress: 100 }) },
      (ids, msg) => {
        for (const id of ids) patchEntry(id, { status: 'error', error: `Uploaded, but saving to the album failed: ${msg}` })
        // Report — this is the worst kind of failure (bytes in storage, no album row = orphaned).
        reportClientEvent('error', 'save', msg, album.id, { count: ids.length })
      },
    )

    const run = async () => {
      await Promise.all(toUpload.map(async (entry) => {
        await sem.acquire()
        try {
          patchEntry(entry.id, { status: 'uploading', progress: 0 })

          const kind = detectKind(entry.file)
          if (!kind) throw new Error('Unsupported file type')

          // Videos upload their raw bytes — cap the original size. Images are compressed
          // client-side first, so their cap is enforced on the processed size inside
          // uploadImageToR2 (a 30MB photo that compresses to 1MB should upload fine).
          if (kind === 'video' && entry.file.size > caps.video) {
            throw new Error(`File too large (max ${Math.round(caps.video / 1024 / 1024)} MB for your tier)`)
          }

          const row = kind === 'image'
            ? await uploadImageToR2(entry.file, album.id, caps.image, pct => patchEntry(entry.id, { progress: pct }), signal)
            : await uploadVideoToStream(entry.file, album.id, pct => patchEntry(entry.id, { progress: pct }), signal, entry.videoResume)

          // Bytes are in storage; the saver flips this tile to 'done' when the row commits.
          patchEntry(entry.id, { progress: 100, videoResume: undefined })
          saver.add(row, entry.id)
        } catch (e) {
          const msg = friendlyUploadError(e)
          patchEntry(entry.id, {
            status: 'error',
            error: msg,
            // Keep the resume state so Retry continues this video from its confirmed offset
            // instead of restarting from zero.
            ...(e instanceof VideoUploadError && e.resume ? { videoResume: e.resume } : {}),
          })
          // Surface the real error (it was previously hidden in a title tooltip, invisible on
          // mobile). AbortError is a deliberate cancel, not worth toasting.
          if (!(e instanceof DOMException && e.name === 'AbortError')) {
            showAppToast(`Upload failed: ${msg}`, 'error')
            // Report to /admin so real guest failures are visible, not invisible. Raw message
            // (not the friendly one) is the diagnostic value; include device + file context.
            const kind = detectKind(entry.file)
            reportClientEvent('error', kind === 'video' ? 'upload:video' : 'upload:image',
              e instanceof Error ? e.message : String(e), album.id,
              { fileType: entry.file.type, sizeMB: Math.round(entry.file.size / 1024 / 1024), status: e instanceof HttpError ? e.status : undefined })
          }
        } finally {
          sem.release()
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
  }, [album.id, caps, concurrency, patchEntry, flushProgress, onPhotosUploaded])

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
    // Functional updater: status check and state update are atomic — prevents a rapid
    // double-click from using a stale closure to spawn two concurrent uploads of the same file
    let fresh: FileEntry | null = null
    setEntries(prev => {
      const entry = prev.find(e => e.id === id)
      if (!entry || entry.status !== 'error') return prev  // already retried or in progress
      fresh = { ...entry, status: 'pending', progress: 0, error: undefined }
      return prev.map(e => e.id === id ? fresh! : e)
    })
    if (fresh) void startUploads([fresh])
  }, [startUploads])

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

  return (
    <div className="hush-upload-zone px-3 sm:px-4 pt-2 pb-4">
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
                  title={entry.status === 'error' ? entry.error : entry.file.name}
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

          {/* Summary row */}
          {!isUploading && activeCount === 0 && (doneCount > 0 || errorCount > 0) && (
            <div className="flex items-center justify-between mt-3 px-1">
              <span className="text-xs" style={{ color: '#7C6752' }}>
                {doneCount > 0 && t('upload.uploaded', { n: doneCount })}
                {doneCount > 0 && errorCount > 0 && ' · '}
                {errorCount > 0 && t('upload.failed', { n: errorCount })}
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
