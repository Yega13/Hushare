'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as tus from 'tus-js-client'
import type { Album, Tier } from '@/types'
import { stripExifFromJpeg } from '@/lib/exif'
import { showAppToast } from '@/components/AppToast'
import { detectKind, uploadCapsForTier, generateVideoPoster } from '@/lib/media'
import {
  UPLOAD_CONCURRENCY_MOBILE,
  UPLOAD_CONCURRENCY_DESKTOP,
  STREAM_CHUNK_SIZE_BYTES,
} from '@/lib/constants'

// ─── XHR timeout ──────────────────────────────────────────────────────────────
const XHR_TIMEOUT_MS = 60_000
// If a PUT opens the socket but sends no bytes for this long (a flaky-mobile stall), abort
// and let the retry loop try again — instead of waiting out the full XHR_TIMEOUT_MS.
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
  const buffer = await file.arrayBuffer()
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

async function resizeAndEncode(source: File | Blob, targetMime: string): Promise<Blob> {
  // Try createImageBitmap with resize options — throws on Safari < 17.4
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(source, { resizeWidth: MAX_IMG_DIM, resizeQuality: 'high' })
  } catch {
    try { bitmap = await createImageBitmap(source) } catch { /* bitmap stays null */ }
  }

  if (!bitmap) {
    // createImageBitmap unavailable — return source unchanged
    return source
  }

  const { width: bw, height: bh } = bitmap
  const scale = Math.min(1, MAX_IMG_DIM / Math.max(bw, bh))
  const w = Math.max(1, Math.round(bw * scale))
  const h = Math.max(1, Math.round(bh * scale))

  // Try OffscreenCanvas (convertToBlob missing on Safari < 16.4)
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const oc = new OffscreenCanvas(w, h)
      const octx = oc.getContext('2d')
      if (!octx) throw new Error('OffscreenCanvas 2D context unavailable')
      octx.drawImage(bitmap, 0, 0, w, h)
      const blob = await encodeCanvas(oc, targetMime, 0.86)
      bitmap.close()
      return blob
    } catch { /* fall through */ }
  }

  // HTMLCanvasElement fallback (always available in a browser page context)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get 2D canvas context')
  ctx.drawImage(bitmap, 0, 0, w, h)
  const blob = await encodeCanvas(canvas, targetMime, 0.86)
  bitmap.close()
  return blob
}

async function processImageFile(file: File): Promise<{ blob: Blob; mimeType: string; name: string }> {
  const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)

  if (isHeic) {
    let jpegBlob: Blob
    try {
      jpegBlob = await convertHeicViaWorker(file)
    } catch {
      // Worker failed (crash or per-file decode error) — always fall back to main thread
      try {
        jpegBlob = await convertHeicMainThread(file)
      } catch (mainErr) {
        throw new Error(`HEIC conversion failed: ${mainErr instanceof Error ? mainErr.message : String(mainErr)}`)
      }
    }
    const buf = await jpegBlob.arrayBuffer()
    const stripped = stripExifFromJpeg(new Uint8Array(buf))
    let finalBlob: Blob = new Blob([stripped.buffer as unknown as ArrayBuffer], { type: 'image/jpeg' })
    // HEIC→JPEG can inflate dramatically (50 MP ProRAW → 30+ MB JPEG) — resize if needed
    if (finalBlob.size > 2 * 1024 * 1024) {
      finalBlob = await resizeAndEncode(finalBlob, 'image/jpeg')
    }
    return {
      blob: finalBlob,
      mimeType: 'image/jpeg',
      name: file.name.replace(/\.(heic|heif)$/i, '.jpg'),
    }
  }

  const mimeType = (file.type || 'image/jpeg').toLowerCase()

  // Resize/re-encode large images so uploads stay fast, at a quality (4096px, q0.9) that is
  // visually indistinguishable. Crucially, PNG/WebP are re-encoded IN THEIR OWN FORMAT — never
  // to JPEG — so transparency is preserved (a JPEG re-encode turned transparent areas solid
  // black, the "black additions"). Animated GIFs are never touched (a canvas flattens them to
  // one frame). Small files skip the canvas round-trip entirely.
  if (file.size > 1.2 * 1024 * 1024 && mimeType !== 'image/gif') {
    const outMime = mimeType === 'image/png' ? 'image/png'
      : mimeType === 'image/webp' ? 'image/webp'
      : 'image/jpeg'
    const blob = await resizeAndEncode(file, outMime)
    // resizeAndEncode returns the exact `file` reference if createImageBitmap is unavailable —
    // upload it untouched in that fallback rather than mislabelling its format.
    if ((blob as unknown) === (file as unknown)) return { blob: file, mimeType, name: file.name }
    if (outMime === 'image/jpeg') {
      const buf = await blob.arrayBuffer()
      const stripped = stripExifFromJpeg(new Uint8Array(buf))
      return { blob: new Blob([stripped.buffer as unknown as ArrayBuffer], { type: 'image/jpeg' }), mimeType: 'image/jpeg', name: file.name.replace(/\.[^.]+$/, '.jpg') }
    }
    return { blob, mimeType: outMime, name: file.name }
  }

  // Small JPEG: lossless EXIF strip only (no re-encode).
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    const buf = await file.arrayBuffer()
    const stripped = stripExifFromJpeg(new Uint8Array(buf))
    return { blob: new Blob([stripped.buffer as unknown as ArrayBuffer], { type: 'image/jpeg' }), mimeType: 'image/jpeg', name: file.name }
  }

  // PNG / WebP / GIF: pass through (no EXIF)
  return { blob: file, mimeType, name: file.name }
}

// 600px longest edge: sharp on the grid even at 2–3× DPR (a 3-col mobile tile is
// ~120 CSS px = ~360 physical px on a 3× screen). Small enough to stay a fast-loading
// thumbnail. The lightbox still swaps in the full-resolution original.
const THUMB_MAX_DIM = 600

async function generateThumbnail(blob: Blob): Promise<Blob | null> {
  try {
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(blob, { resizeWidth: THUMB_MAX_DIM, resizeQuality: 'high' })
    } catch {
      bitmap = await createImageBitmap(blob)
    }
    const { width: bw, height: bh } = bitmap
    const scale = Math.min(1, THUMB_MAX_DIM / Math.max(bw, bh))
    const w = Math.max(1, Math.round(bw * scale))
    const h = Math.max(1, Math.round(bh * scale))

    if (typeof OffscreenCanvas !== 'undefined') {
      try {
        const oc = new OffscreenCanvas(w, h)
        const octx = oc.getContext('2d')
        if (!octx) throw new Error('OffscreenCanvas 2D context unavailable')
        octx.drawImage(bitmap, 0, 0, w, h)
        const thumb = await oc.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
        bitmap.close()
        return thumb
      } catch { /* fall through */ }
    }
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const thumbCtx = canvas.getContext('2d')
    if (!thumbCtx) { bitmap.close(); return null }
    thumbCtx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    return new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.85))
  } catch {
    return null
  }
}

// ─── XHR PUT ──────────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}

async function xhrPut(
  url: string,
  body: Blob,
  contentType: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Upload aborted', 'AbortError')); return }
    const xhr = new XMLHttpRequest()
    let settled = false
    let lastActivity = Date.now()

    // Stall watchdog: mobile connections sometimes open the socket then stop sending bytes.
    // Rather than hang for the full XHR_TIMEOUT_MS, abort after STALL_TIMEOUT_MS of zero
    // progress so the retry loop can try again quickly. Reset on every progress event.
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
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.timeout = XHR_TIMEOUT_MS
    xhr.upload.onprogress = (e) => {
      lastActivity = Date.now()
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => finish(() => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new HttpError(xhr.status, `R2 PUT ${xhr.status}`))
    })
    xhr.onerror = () => finish(() => reject(new Error('Network error during upload')))
    xhr.ontimeout = () => finish(() => reject(new Error('Upload timed out')))
    xhr.send(body)
  })
}

// ─── Types ────────────────────────────────────────────────────────────────────

type FileEntry = {
  id: string
  file: File
  status: 'pending' | 'uploading' | 'done' | 'error'
  progress: number
  error?: string
  preview?: string  // object URL for the image thumbnail (revoked on clear/unmount)
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

// Read the intrinsic pixel dimensions of an image blob. Best-effort — resolves null on any
// failure so a missing size never blocks an upload. Used to store aspect ratio at upload time.
async function readImageDimensions(blob: Blob): Promise<{ width: number; height: number } | null> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('image decode failed'))
      img.src = url
    })
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      return { width: img.naturalWidth, height: img.naturalHeight }
    }
    return null
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
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
async function snapshotFiles(files: File[]): Promise<File[]> {
  return Promise.all(files.map(async (f) => {
    if (f.size > SNAPSHOT_MAX_BYTES) return f
    try {
      const buf = await f.arrayBuffer()
      return new File([buf], f.name, { type: f.type, lastModified: f.lastModified })
    } catch {
      return f
    }
  }))
}

// ─── Upload image to R2 ───────────────────────────────────────────────────────

async function uploadImageToR2(
  file: File,
  albumId: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<PhotoRow> {
  // Process BEFORE presigning — fileSize in presign must match the actual blob we PUT
  onProgress(2)
  const { blob: processedBlob, mimeType, name: processedName } = await processImageFile(file)
  onProgress(10)

  // Read dimensions off the critical path: decode runs concurrently with presign + upload so it
  // never adds latency. Awaited only at the very end.
  const dimsPromise = readImageDimensions(processedBlob)

  const presignRes = await fetch('/api/upload/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      albumId,
      fileName: processedName,
      contentType: mimeType,
      fileSize: processedBlob.size,  // actual size of the blob we're about to PUT
    }),
  })
  if (!presignRes.ok) {
    const err = await presignRes.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? `Presign failed (${presignRes.status})`)
  }
  const { presignedUrl, key, publicUrl } = await presignRes.json() as {
    presignedUrl: string; key: string; publicUrl: string
  }
  onProgress(15)

  // PUT with max 2 retries on network errors; never retry 4xx/5xx (server-decided)
  let lastErr: Error | null = null
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      await xhrPut(presignedUrl, processedBlob, mimeType, pct => onProgress(15 + Math.round(pct * 0.7)), signal)
      lastErr = null
      break
    } catch (e) {
      if (e instanceof HttpError) throw e  // 4xx / 5xx — no retry
      lastErr = e instanceof Error ? e : new Error(String(e))
    }
  }
  if (lastErr) throw lastErr
  onProgress(85)

  // Thumbnail — failure is non-fatal
  let thumbUrl: string | null = null
  try {
    const thumbBlob = await generateThumbnail(processedBlob)
    if (thumbBlob) {
      const tPresign = await fetch('/api/upload/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          albumId,
          fileName: 'thumb.jpg',
          contentType: 'image/jpeg',
          fileSize: thumbBlob.size,
          isThumb: true,
        }),
      })
      if (tPresign.ok) {
        const { presignedUrl: tUrl, publicUrl: tPublicUrl } = await tPresign.json() as {
          presignedUrl: string; key: string; publicUrl: string
        }
        await xhrPut(tUrl, thumbBlob, 'image/jpeg', () => {})
        thumbUrl = tPublicUrl
      }
    }
  } catch { /* non-fatal */ }
  onProgress(96)

  const dims = await dimsPromise

  return {
    storage_backend: 'r2',
    media_type: 'image',
    storage_path: key,
    url: publicUrl,
    thumb_url: thumbUrl,
    poster_url: null,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
  }
}

// ─── Upload video to Cloudflare Stream ────────────────────────────────────────

async function uploadVideoToStream(
  file: File,
  albumId: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<PhotoRow> {
  onProgress(2)

  // Generate a poster frame and upload it to R2 thumbs so it's immediately visible in the grid.
  // isThumb:true places the key under thumbs/{albumId}/{uuid}.jpg which passes photos/create
  // poster_url validation. Also captures duration — avoids a second video element decode.
  let posterUrl: string | null = null
  let durationSeconds = 0
  let videoWidth: number | null = null
  let videoHeight: number | null = null
  try {
    const posterResult = await generateVideoPoster(file)
    if (posterResult) {
      durationSeconds = posterResult.durationSeconds
      if (posterResult.videoWidth > 0 && posterResult.videoHeight > 0) {
        videoWidth = posterResult.videoWidth
        videoHeight = posterResult.videoHeight
      }
      const pPresign = await fetch('/api/upload/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          albumId,
          fileName: 'poster.jpg',
          contentType: 'image/jpeg',
          fileSize: posterResult.blob.size,
          isThumb: true,
        }),
      })
      if (pPresign.ok) {
        const { presignedUrl: pUrl, publicUrl: pPublicUrl } = await pPresign.json() as {
          presignedUrl: string; key: string; publicUrl: string
        }
        await xhrPut(pUrl, posterResult.blob, 'image/jpeg', () => {})
        posterUrl = pPublicUrl  // R2 thumbs URL — passes photos/create poster_url validation
      }
    }
  } catch { /* non-fatal */ }
  onProgress(8)

  // Init Cloudflare Stream TUS upload — 15s timeout (3s is too tight on slow mobile)
  const initRes = await fetch('/api/upload/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      albumId,
      fileName: file.name,
      contentType: file.type,
      fileSize: file.size,  // raw file size — no processing for videos
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? `Stream init failed (${initRes.status})`)
  }
  // Route returns camelCase: { uploadUrl, streamUid, iframeUrl, thumbnailUrl }
  const { uploadUrl, streamUid, iframeUrl, thumbnailUrl } = await initRes.json() as {
    uploadUrl: string; streamUid: string; iframeUrl: string; thumbnailUrl: string
  }
  if (!uploadUrl || !streamUid || !iframeUrl) throw new Error('Stream init returned incomplete response')
  onProgress(12)

  // TUS chunked upload — uploadUrl is a pre-created Cloudflare Stream upload URL
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Upload aborted', 'AbortError')); return }
    let settled = false
    const settle = (fn: () => void) => { if (!settled) { settled = true; fn() } }
    const upload = new tus.Upload(file, {
      uploadUrl,
      chunkSize: STREAM_CHUNK_SIZE_BYTES,
      retryDelays: [0, 0],
      // Only retry on transport/network failures — never on HTTP error responses (4xx/5xx).
      // Matches the XHR image upload policy: HttpError is never retried.
      onShouldRetry: (err: unknown) => {
        if (err && typeof (err as { originalResponse?: unknown }).originalResponse !== 'undefined') return false
        return true
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        const pct = bytesTotal > 0 ? Math.round((bytesUploaded / bytesTotal) * 85) : 0
        onProgress(12 + pct)
      },
      onSuccess: () => settle(resolve),
      onError: (err) => settle(() => reject(err instanceof Error ? err : new Error(String(err)))),
    })
    signal?.addEventListener('abort', () => {
      upload.abort()
      settle(() => reject(new DOMException('Upload aborted', 'AbortError')))
    }, { once: true })
    upload.start()
  })
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

// ─── Batch DB save ────────────────────────────────────────────────────────────

async function saveUploadedRows(albumId: string, rows: PhotoRow[]): Promise<{ inserted: number; skipped: number }> {
  const res = await fetch('/api/album/photos/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // albumId (camelCase) — route destructures { albumId, photos }
    body: JSON.stringify({ albumId, photos: rows }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? `Save failed (${res.status})`)
  }
  // Route returns { inserted: N, skipped: N } — NOT inserted_count / rejected_count
  const body = await res.json() as { inserted?: number; skipped?: number }
  return {
    inserted: typeof body.inserted === 'number' ? body.inserted : rows.length,
    skipped:  typeof body.skipped  === 'number' ? body.skipped  : 0,
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
    const rows: (PhotoRow | null)[] = new Array(toUpload.length).fill(null)

    const run = async () => {
      await Promise.all(toUpload.map(async (entry, i) => {
        await sem.acquire()
        try {
          patchEntry(entry.id, { status: 'uploading', progress: 0 })

          const kind = detectKind(entry.file)
          if (!kind) throw new Error('Unsupported file type')

          const cap = kind === 'image' ? caps.image : caps.video
          if (entry.file.size > cap) {
            throw new Error(`File too large (max ${Math.round(cap / 1024 / 1024)} MB for your tier)`)
          }

          rows[i] = kind === 'image'
            ? await uploadImageToR2(entry.file, album.id, pct => patchEntry(entry.id, { progress: pct }), signal)
            : await uploadVideoToStream(entry.file, album.id, pct => patchEntry(entry.id, { progress: pct }), signal)

          patchEntry(entry.id, { status: 'done', progress: 100 })
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Upload failed'
          patchEntry(entry.id, { status: 'error', error: msg })
          // Surface the real error (it was previously hidden in a title tooltip, invisible on
          // mobile). AbortError is a deliberate cancel, not worth toasting.
          if (!(e instanceof DOMException && e.name === 'AbortError')) {
            showAppToast(`Upload failed: ${msg}`, 'error')
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

    flushProgress()

    const successRows = rows.filter((r): r is PhotoRow => r !== null)
    const successEntries = toUpload.filter((_, i) => rows[i] !== null)

    if (successRows.length > 0) {
      try {
        await saveUploadedRows(album.id, successRows)
      } catch (e) {
        // Files are in cloud storage but the DB record creation failed.
        // Mark them as error so the user knows not to navigate away.
        const msg = e instanceof Error ? e.message : 'Failed to save'
        for (const entry of successEntries) {
          patchEntry(entry.id, { status: 'error', error: `Cloud upload done but DB save failed: ${msg}` })
        }
        flushProgress()
        activeBatchCountRef.current--
        setIsUploading(activeBatchCountRef.current > 0)
        abortCtrlsRef.current.delete(abortCtrl)
        return
      }
    }

    // Decrement before onPhotosUploaded so if the parent unmounts UploadZone
    // the queued setState call is already the final one
    activeBatchCountRef.current--
    setIsUploading(activeBatchCountRef.current > 0)
    // Only notify parent when at least one photo actually landed in the DB,
    // and only if still mounted (prevents leaking a timer in AlbumPageClient)
    if (mountedRef.current && successRows.length > 0) onPhotosUploaded?.()
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
            {isDragging ? 'Drop to upload' : 'Add photos & videos'}
          </p>
          <p className="text-xs sm:text-[0.8rem]" style={{ color: '#8A7A66', marginTop: 2 }}>
            Drag &amp; drop or <span style={{ color: '#630826', fontWeight: 600 }}>click to browse</span>
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
                      <span className="mt-1 text-[10px] font-bold tabular-nums" style={{ color: '#FDFAF5' }}>{entry.progress}%</span>
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
                      <span className="mt-0.5 text-[10px] font-bold" style={{ color: '#FDFAF5' }}>Retry</span>
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
                {doneCount > 0 && `${doneCount} uploaded`}
                {doneCount > 0 && errorCount > 0 && ' · '}
                {errorCount > 0 && `${errorCount} failed`}
              </span>
              {doneCount > 0 && (
                <button type="button" onClick={dismissDone} className="text-xs font-semibold" style={{ color: '#630826' }}>
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
