'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createStallWatch, settleWithin, monotonicNow, elapsedSince } from '@/lib/clock'
import { Semaphore } from '@/lib/upload/semaphore'
import { readJson, HttpError } from '@/lib/upload/http'
import {
  VideoUploadError, errText, friendlyUploadError, isDeterministicTusError, isRecoverableNetworkFailure, tusHttpStatus,
  type VideoResume,
  refusalFrom, refusalFields,
} from '@/lib/upload/failure'
import { freshEntryFor, mergeWall, queuePendingRows, retryMode, shouldPark, wallCopy, wallFor, wallOnNewAttempt } from '@/lib/upload/retry-plan'
import { createRowSaver } from '@/lib/upload/row-saver'
import { createVideoLane, videoOutcomeOf } from '@/lib/upload/video-lane'
import { batchThroughputKbps, lostCount } from '@/lib/upload/throughput'
import { reportClientEvent } from '@/lib/upload/report'
import { reachability } from '@/lib/upload/reachability'
import { fetchWithRetry, putImageWithRelay, FETCH_DEADLINE_SAVE_MS } from '@/lib/upload/retry'
import { unusableUpload } from '@/lib/upload/presign-fields'
import * as tus from 'tus-js-client'
import type { Album } from '@/types'
import { stripExifFromJpeg, jpegOrientation, stripMetadataFromPng, stripMetadataFromWebp } from '@/lib/exif'
// The judgements this component makes about someone else's photo — whether it is re-encoded,
// in what format, how far it is shrunk, and whether a failure is worth retrying. Pure, and
// tested in tests/upload-policy.test.ts, because none of it was reachable from inside here.
import {
  maxImageDimFor, shrinkLadderFor, needsReEncode, outputMimeFor, nextShrinkDim,
  isMissingContentLengthFailure, tusFailureAction, isEvalBlockedByCsp,
  isExpectedRefusal,
} from '@/lib/upload-policy'
import { decodeBitmapSafe, decodeImageSource, setFallbackDecodeReporter } from '@/lib/image-decode'
import { reportClientError } from '@/lib/report-error'

// A SIDEWAYS PHOTO IS THE ONE FAILURE HERE THAT NEVER ERRORS. decodeBitmapSafe falls back to a
// bare decode when the orientation-preserving one is rejected, and on the old Android WebViews
// where that option matters the fallback returns an UN-rotated bitmap — which the JPEG branch
// below then re-encodes believing the rotation was already applied. Stored sideways, permanently,
// with nothing on screen and nothing in the panel.
//
// Reported as a WARNING, not an error: the upload still succeeded and the guest is not affected in
// any way they can see. It is here so that if this never appears, there is nothing to fix — and if
// it does, it names the device and the reason, which is what fixing it properly would need.
setFallbackDecodeReporter((reason) => {
  reportClientError({
    source: 'decode:orientation-fallback',
    level: 'warn',
    message: `Decoded without EXIF orientation — a photo may be stored rotated (${reason})`,
  })
})
import { snapshotFileRobust, readFileRobust, readFailure } from '@/lib/file-read'
import { trackUploadStep } from '@/lib/engagement'
import { showAppToast } from '@/components/AppToast'
import { useT } from '@/i18n/LocaleProvider'
import { detectKind, uploadCapsForTier, tooLargeMessage, generateVideoPoster, isAllowedImage, ALLOWED_IMAGE_TYPES, ALLOWED_VIDEO_TYPES } from '@/lib/media'
import {
  UPLOAD_CONCURRENCY_MOBILE,
  UPLOAD_CONCURRENCY_DESKTOP,
  VIDEO_CONCURRENCY_START,
  VIDEO_CONCURRENCY_MAX_MOBILE,
  VIDEO_CONCURRENCY_MAX_DESKTOP,
  STREAM_CHUNK_SIZE_BYTES,
} from '@/lib/constants'

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

// A data: URL back into bytes. Needed because toDataURL is the only encoder left when toBlob
// refuses, and every caller downstream wants a Blob.
function dataUrlToBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  const header = dataUrl.slice(0, comma)
  if (!header.startsWith('data:') || !header.includes(';base64')) return null
  const mime = header.slice(5, header.indexOf(';')) || 'image/jpeg'
  const binary = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

async function encodeCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  mimeType: string,
  quality: number,
): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: mimeType, quality })
  }
  const el = canvas as HTMLCanvasElement
  const once = () => new Promise<Blob | null>(resolve => el.toBlob(resolve, mimeType, quality))

  // toBlob hands back NULL rather than throwing when WebKit cannot allocate the encode buffer,
  // which happens on iPhones part-way through a large batch. One null used to end the photo.
  let blob = await once()

  // Memory pressure is a moment, not a verdict: the previous file's buffers are released between
  // these two attempts, and the retry usually lands.
  if (!blob) {
    await new Promise(r => setTimeout(r, 150))
    blob = await once()
  }

  // A genuinely different encoder path in WebKit, not a repeat of the same one -- toDataURL
  // allocates a string rather than a Blob and regularly succeeds where toBlob has just returned
  // null. It costs a base64 round trip, which is why it is third and not first.
  if (!blob) {
    try {
      const fallback = dataUrlToBlob(el.toDataURL(mimeType, quality))
      if (fallback && fallback.size > 0) blob = fallback
    } catch { /* fall through to the throw below */ }
  }

  if (blob) return blob
  // Deliberately carries no dimensions or sizes: /admin groups by exact message text, so a number
  // that changes per photo would scatter one recurring problem across a column of single rows.
  throw new Error('Could not process this photo on this device — try again, or with fewer photos at once.')
}

// ─── Single-decode pipeline constants ────────────────────────────────────────

// 0.92, up from 0.86. Above ~0.90 JPEG artefacts stop being visible on a photograph; 0.86 was
// low enough to soften skin and flatten gradients on every photo the site stored.
//
// Not 1.0 and not "keep the original bytes": full originals were measured at roughly 4 MB a photo,
// which for the 5,000-photo event this was sized against is ~20 GB to push up a single connection —
// a couple of hours of uploading. Storage is not the constraint (20 GB is about $0.30/month); the
// photographer's time is.
const MAIN_QUALITY = 0.92
const THUMB_QUALITY = 0.85
// 600px longest edge: sharp on the grid even at 2–3× DPR (a 3-col mobile tile is
// ~120 CSS px = ~360 physical px on a 3× screen). Small enough to stay a fast-loading
// thumbnail. The lightbox still swaps in the full-resolution original.
const THUMB_MAX_DIM = 600

// Decoding a 48MP photo briefly holds a full-resolution bitmap (~190MB RGBA). Bound how many
// decodes run at once — independently of upload concurrency — so network slots stay saturated
// while at most N files' worth of bitmaps exist. Mobile gets 2; desktop can afford more.
const decodeSem = new Semaphore(
  typeof navigator !== 'undefined' && /Mobi|Android/i.test(navigator.userAgent) ? 2 : 4,
)

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
async function processViaImgElement(file: File, maxDim: number): Promise<ProcessedImage | null> {
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
    const main = await drawSourceToBlob(img, img.naturalWidth, img.naturalHeight, maxDim, outMime, MAIN_QUALITY)
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

async function processImage(file: File, capBytes: number, maxDim: number): Promise<ProcessedImage> {
  const release = await decodeSem.acquire()
  try {
    return await processImageInner(file, capBytes, maxDim)
  } finally {
    release()
  }
}

async function processImageInner(file: File, capBytes: number, maxDim: number): Promise<ProcessedImage> {
  const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)

  if (isHeic) {
    const jpgName = file.name.replace(/\.(heic|heif)$/i, '.jpg')

    // Fast path: Safari decodes HEIC natively — skip the slow WASM converter entirely and
    // encode straight from the native bitmap (also a single lossy generation, so better
    // quality than converter-then-re-encode).
    //
    // Then the PLATFORM decoder, for browsers where createImageBitmap cannot but WebCodecs can —
    // Chrome on Android, where the WASM converter is refused by our CSP and the guest was simply
    // told no. Same single-generation quality, and it costs nothing where it is unsupported.
    const native = await decodeImageSource(file)
    if (native) {
      try {
        const thumbBlob = await deriveThumb(native)
        const main = await scaleAndEncode(native, maxDim, 'image/jpeg', MAIN_QUALITY)
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
        const detail = mainErr instanceof Error ? mainErr.message : String(mainErr)
        // CLASSIFIED ON THE ERROR'S NAME, NOT ONLY ITS TEXT. `EvalError` is the browser-independent
        // fact that the CSP refused `new Function`; the sentence after it is Chrome's phrasing and
        // Firefox writes a different one. `.message` drops the name, so the classifier's own
        // 'evalerror' branch could never match anything and every browser depended on matching
        // prose. This is the one line that makes it reachable — `detail` stays message-only,
        // because a guest is never shown the name.
        const signature = mainErr instanceof Error ? `${mainErr.name}: ${mainErr.message}` : String(mainErr)
        // A GUEST MUST NOT BE HANDED A SECURITY-POLICY DUMP. When the converter cannot run in this
        // browser at all — Chrome on Android, where heic2any's `new Function` is refused by our CSP
        // — retrying changes nothing, so the message says what is true and what they can do about
        // it instead of quoting a script-src directive at somebody at a wedding.
        if (isEvalBlockedByCsp(signature)) {
          throw new Error(
            'This browser cannot convert iPhone photo files (HEIC). '
            + 'Ask for the photo as a JPEG, or add it from an iPhone.',
          )
        }
        throw new Error(`HEIC conversion failed: ${detail}`)
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
      // The same decision as the main path, so it uses the same function — the inline version had
      // its operands in the opposite order (size first, edge second), which is exactly the shape of
      // mistake that swaps two arguments and is invisible afterwards.
      //
      // A HARD 2 MB, not the album's cap, and that is deliberate: HEIC to JPEG can inflate wildly
      // (a 48MP ProRAW becomes a 30 MB JPEG), so this re-encodes on bloat rather than on whether
      // the album would accept it.
      if (needsReEncode(Math.max(bitmap.width, bitmap.height), jpegBlob.size, 2 * 1024 * 1024, maxDim)) {
        const main = await scaleAndEncode(bitmap, maxDim, 'image/jpeg', MAIN_QUALITY)
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
    const viaImg = await processViaImgElement(file, maxDim)
    if (viaImg) return viaImg
    // Undecodable AND a format the server will not accept. Every conversion route has already
    // failed, so there is nothing left to turn it into -- uploading would spend the bytes and then
    // be refused at presign with "File type not allowed", which is what happened to 113 MB TIFFs on
    // 2026-08-23. Say so now, before any of that work.
    //
    // "Unsupported" prefix deliberately: three classifiers read it to tell a decision the product
    // made on purpose from something that broke, so this lands as a refusal rather than an error.
    // No MIME type in the text -- /admin groups by exact message and a per-file value would scatter
    // one problem across a column of single rows.
    if (!isAllowedImage(mimeType)) {
      throw new Error('Unsupported image format. Please upload JPEG, PNG, HEIC, WebP or GIF.')
    }
    // Truly undecodable but a supported type — upload untouched (the server validates the type); a
    // JPEG still gets its lossless metadata strip. May still fail at PUT if bytes are unreadable,
    // but there's nothing more we can do here.
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
      try {
        return { blob: await strippedJpegBlob(file), thumbBlob: null, mimeType: 'image/jpeg', name: file.name, width: null, height: null }
      } catch {
        // The EXIF strip needs the raw bytes, and by definition we only reach here because every
        // path to those bytes has already failed -- so this threw and killed the upload at the
        // exact point the code above intends to "upload it untouched anyway". The last resort was
        // not a last resort at all; it was one more read. Fall through and hand over the original
        // File: the PUT reads it through XMLHttpRequest, which is another path again and may
        // succeed where these did not. If it does not, the failure is at least an honest one at
        // the point of upload rather than a refusal before we ever tried.
      }
    }
    return { blob: file, thumbBlob: null, mimeType, name: file.name, width: null, height: null }
  }

  try {
    const thumbBlob = await deriveThumb(bitmap)

    // RESIZE ONLY WHAT IS ACTUALLY BIGGER THAN 3500px, and judge that on PIXELS, not bytes.
    //
    // The old test was `file.size > 1.2 MB`, which is every phone photo — so everything was
    // re-encoded and the original thrown away, including images already smaller than the target.
    // Testing the long edge instead means a photo at or under 3500px takes the lossless path below:
    // original bytes, metadata stripped, nothing re-encoded. Only genuinely larger images pay.
    if (needsReEncode(Math.max(bitmap.width, bitmap.height), file.size, capBytes, maxDim)) {
      // PNG/WebP are re-encoded IN THEIR OWN FORMAT — never to JPEG — so transparency is
      // preserved (a JPEG re-encode turned transparent areas solid black). Canvas re-encode
      // needs no EXIF strip (metadata never survives it) and bakes orientation into pixels.
      const outMime = outputMimeFor(mimeType)
      // Walk the ladder and stop at the first size that fits, so a photo 10% over the cap loses
      // almost nothing while a genuinely enormous one still gets through. The last rung is used
      // regardless — a refused upload is worse than a smaller photo.
      const ladder = shrinkLadderFor(maxDim)
      let main = await scaleAndEncode(bitmap, ladder[0], outMime, MAIN_QUALITY)
      // Only if 3500px STILL does not fit the album's cap does it come down further, one rung at a
      // time. A refused upload is worse than a smaller photo.
      for (let rung = 0; ; rung++) {
        const dim = nextShrinkDim(rung, main.blob.size, capBytes, ladder)
        if (dim === null) break
        main = await scaleAndEncode(bitmap, dim, outMime, MAIN_QUALITY)
      }
      // Label the bytes we ACTUALLY produced, not the ones we asked for.
      //
      // Per the HTML spec both toBlob and toDataURL silently fall back to image/png when the engine
      // cannot encode the requested type. iOS 15 and 16 Safari have no canvas WebP encoder (that
      // arrived in 17), so a WebP from those phones came out as PNG bytes uploaded with
      // Content-Type: image/webp under a .webp key — several times larger than intended and
      // mislabelled in storage forever. <img> sniffs the real format so the grid hides it; a guest
      // who downloads the file gets something that is not what its name claims.
      const actualMime = main.blob.type && isAllowedImage(main.blob.type) ? main.blob.type : outMime
      const ext = actualMime === 'image/png' ? '.png' : actualMime === 'image/webp' ? '.webp' : '.jpg'
      const name = file.name.replace(/\.[^.]+$/, ext)
      return { blob: main.blob, thumbBlob, mimeType: actualMime, name, width: main.width, height: main.height }
    }

    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
      // Reaching here means createImageBitmap already read this file successfully, so the bytes
      // were available a moment ago -- but "a moment ago" is not a guarantee on a device that is
      // still writing the file. If the read fails now, re-encode from the bitmap we are already
      // holding rather than throwing: orientation is baked into those pixels, so the result is
      // correct, and a slightly larger upload is infinitely better than a lost photo.
      let raw: Uint8Array
      try {
        raw = new Uint8Array(await readFileRobust(file))
      } catch {
        const main = await scaleAndEncode(bitmap, maxDim, 'image/jpeg', 0.92)
        return { blob: main.blob, thumbBlob, mimeType: 'image/jpeg', name: file.name, width: main.width, height: main.height }
      }
      if (jpegOrientation(raw) !== 1) {
        // The lossless strip drops APP1 — including the EXIF orientation tag — so a rotated
        // photo would upload sideways. Re-encode instead: createImageBitmap already baked the
        // rotation into the pixels. Higher quality (0.92) since these files are small anyway.
        const main = await scaleAndEncode(bitmap, maxDim, 'image/jpeg', 0.92)
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

    // Decoded fine, but the format itself is one the server will not store (AVIF and BMP both
    // reach here, and a small one skips the resize branch above that would have re-encoded it).
    // The pixels are already in hand, so convert rather than refuse.
    if (!isAllowedImage(mimeType)) {
      const main = await scaleAndEncode(bitmap, maxDim, 'image/jpeg', MAIN_QUALITY)
      return { blob: main.blob, thumbBlob, mimeType: 'image/jpeg', name: file.name.replace(/\.[^.]+$/, '.jpg'), width: main.width, height: main.height }
    }

    // Small PNG/WebP: pixels are kept exactly as-is, but the metadata chunks come out. Both formats
    // can carry GPS (PNG via eXIf, WebP via its EXIF chunk) and the privacy policy promises location
    // never reaches us, so "no EXIF concern" was wrong for anything that was not a screenshot.
    // Same protection the JPEG branch above got, and for the same reason: reaching here means
    // createImageBitmap already read this file, so the bytes were available a moment ago -- which is
    // not a guarantee on a device still writing the file. A bare arrayBuffer() here threw
    // NotReadableError while a perfectly good bitmap sat open in hand, and because that raw error
    // is not wrapped by asReadFailure it was classified as neither a read failure nor a network
    // one: never parked, never auto-resumed, and the guest told to remove a photo we were holding.
    let raw: Uint8Array
    try {
      raw = new Uint8Array(await readFileRobust(file))
    } catch {
      const want = mimeType === 'image/png' ? 'image/png' : 'image/webp'
      const main = await scaleAndEncode(bitmap, maxDim, want, MAIN_QUALITY)
      // Label what came OUT, not what was asked for — the same canvas-falls-back-to-PNG problem
      // handled in the resize branch above, which this path was left out of. iOS 15/16 cannot encode
      // WebP, so a small WebP here would be stored as PNG bytes under a .webp name.
      const actual = main.blob.type && isAllowedImage(main.blob.type) ? main.blob.type : want
      const ext = actual === 'image/png' ? '.png' : actual === 'image/webp' ? '.webp' : '.jpg'
      return { blob: main.blob, thumbBlob, mimeType: actual, name: file.name.replace(/\.[^.]+$/, ext), width: main.width, height: main.height }
    }
    const cleaned = mimeType === 'image/png' ? stripMetadataFromPng(raw) : stripMetadataFromWebp(raw)
    const blob = cleaned.length === raw.length
      ? file
      : new Blob([cleaned.buffer as unknown as ArrayBuffer], { type: mimeType })
    return { blob, thumbBlob, mimeType, name: file.name, width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}
// ─── Types ────────────────────────────────────────────────────────────────────

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
// Bounded workers, so only this many files are being READ at any moment.
//
// Note what this does NOT do, because it was believed to and does not: it bounds concurrency, not
// retention. Every snapshot is kept in the array this function returns and lives for the whole
// session, so a 700-photo selection ends up holding all 700 copies at once no matter how few are
// read simultaneously. The budget below is what actually bounds memory.
const SNAPSHOT_CONCURRENCY = 4

// Total bytes of in-memory copies a single selection may hold.
//
// On 2026-08-22 a photographer added a wedding album in one go -- roughly 700 photos at 15-18 MB
// each. At ~12 GB of copies the tab ran out of memory, and the symptom was not a clean failure but
// NotReadableError on WINDOWS, where a file reference cannot go stale and the snapshot buys nothing
// at all. Throughput went from 50 photos a minute to 1, and uploads started failing on both the
// direct and relay paths, because allocation was failing everywhere at once. The protection was
// causing the exact failure it exists to prevent.
//
// 200 MB covers what the snapshot is actually FOR: a phone user picking ten or fifty photos from a
// gallery, where the reference really does go stale. Past that, files keep their original
// reference, which is free and -- on a desktop -- entirely safe.
//
// Scoped per SELECTION rather than per session on purpose. Making it a session-wide total would
// leave a mobile user who adds several batches unprotected on all but the first, which is the case
// the snapshot exists for. Adding many large batches can still accumulate; bounding one selection
// is what turns an OOM into a non-event, and is honest about the rest.
const SNAPSHOT_TOTAL_BUDGET = 200 * 1024 * 1024

// Snapshot in batches and hand each one over the moment it is ready.
//
// This used to snapshot the WHOLE selection before a single byte went out — `addFiles(await
// snapshotFiles(files))`. Picking sixty photos on a phone meant reading up to 200MB out of device
// storage, four at a time, while the progress bar sat at zero and the network did nothing at all.
// The upload was not slow; it had not started.
//
// Now reading and uploading overlap: the first batch is on the wire while the rest are still being
// read. Batched rather than one-at-a-time so the uploader always has a queue to work through — it
// runs 6 concurrent on mobile, and feeding it single files would leave five lanes idle.
const SNAPSHOT_BATCH = 8

async function snapshotFilesStreaming(files: File[], onBatch: (batch: File[]) => void): Promise<void> {
  // The budget spans the whole selection, not each batch, so the memory ceiling is unchanged.
  let budgetLeft = SNAPSHOT_TOTAL_BUDGET
  for (let start = 0; start < files.length; start += SNAPSHOT_BATCH) {
    const slice = files.slice(start, start + SNAPSHOT_BATCH)
    const out = await snapshotBatch(slice, () => budgetLeft, (n) => { budgetLeft = n })
    onBatch(out)
  }
}

async function snapshotBatch(
  files: File[],
  getBudget: () => number,
  setBudget: (n: number) => void,
): Promise<File[]> {
  const out = new Array<File>(files.length)
  let next = 0
  const worker = async () => {
    while (next < files.length) {
      const i = next++
      const f = files[i]
      // Big videos keep their original reference (buffering several into memory risks OOM);
      // the stale-reference bug overwhelmingly hits image picks, not large videos.
      if (f.size > SNAPSHOT_MAX_BYTES) { out[i] = f; continue }
      // Past the budget, keep the original reference. Claimed BEFORE the await so concurrent
      // workers cannot each see the same remaining budget and all decide they fit.
      if (f.size > getBudget()) { out[i] = f; continue }
      setBudget(getBudget() - f.size)
      // Robust snapshot (retries + FileReader fallback) into an in-memory File — this is what
      // makes every downstream read (decode, EXIF, upload) immune to the reference going stale.
      // Falls back to the original reference only if the bytes are truly unreadable.
      const snapshot = await snapshotFileRobust(f)
      // Hand the budget back when the copy was never made, so one unreadable file does not cost
      // the files behind it their protection.
      if (!snapshot) setBudget(getBudget() + f.size)
      out[i] = snapshot ?? f
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
  maxDim: number,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<PhotoRow> {
  // Process BEFORE presigning — fileSize in presign must match the actual blob we PUT.
  // One decode yields the upload blob, the thumbnail AND the dimensions (see processImage).
  onProgress(2)
  const processed = await processImage(file, imageCapBytes, maxDim)
  onProgress(12)

  // Cap enforced on the PROCESSED size — what actually uploads. A 30MB phone photo that
  // compresses to <1MB should not bounce off a 25MB tier cap. The server enforces the same
  // cap on the presigned size, so this is UX, not security.
  if (processed.blob.size > imageCapBytes) {
    throw new Error(tooLargeMessage('image', imageCapBytes))
  }

  // ...and the other end of the same measurement. processImage's last resort hands back the
  // ORIGINAL File when every decode and every re-encode has failed, which is right -- the PUT reads
  // it through XMLHttpRequest, a path that sometimes succeeds where the others did not. But a file
  // the device never materialised arrives with size 0, and presign refuses that as "Missing or
  // invalid fields": six words about a request, shown to somebody about their own photograph, and
  // filed in /admin as a fault. Asked here instead, in words the uploader understands -- the file
  // parks and is read again, which is what saves a cloud-backed photo (error_events 1226).
  const unusable = unusableUpload({ size: processed.blob.size, name: processed.name, mimeType: processed.mimeType })
  if (unusable) throw readFailure(unusable)

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
  // The refusal's code travels with it (refusalFrom): presign refuses a full album now, and without
  // its code that refusal would be filed as an upload fault.
  if (!presignRes.ok) throw await refusalFrom(presignRes, 'Presign failed')
  const { presignedUrl, key, publicUrl, thumb, contentType: signedContentType } = await readJson<{
    presignedUrl: string
    key: string
    publicUrl: string
    contentType?: string
    thumb?: { presignedUrl: string; key: string; publicUrl: string }
  }>(presignRes)
  // The PUT must carry exactly the type the server signed — content-type is inside the signature
  // now, so a mismatch is a rejected upload, not a mislabelled file. Falls back to our own value
  // for an older worker still in rotation mid-deploy, which is the pair that already matched.
  const putContentType = signedContentType ?? processed.mimeType
  onProgress(16)

  // Main and thumbnail PUT in PARALLEL — the ~30KB thumb rides along for free instead of
  // adding its own serial round trip. This promise NEVER rejects: thumb failure is non-fatal
  // (the grid falls back to the full image), and if the main PUT throws first this promise may
  // go un-awaited — a rejection here would surface as an unhandled rejection. An abort during
  // the thumb phase also resolves null: the main image is already in R2 at that point, so
  // saving its row (thumb-less) beats orphaning the uploaded bytes.
  const thumbPut: Promise<string | null> = (processed.thumbBlob && thumb)
    ? putImageWithRelay(
        { key: thumb.key, publicUrl: thumb.publicUrl }, thumb.presignedUrl,
        { albumId, fileName: processed.name, contentType: 'image/jpeg', isThumb: true },
        processed.thumbBlob, () => {}, signal,
      ).then(r => r.publicUrl).catch(() => null)
    : Promise.resolve(null)

  const main = await putImageWithRelay(
    { key, publicUrl }, presignedUrl,
    { albumId, fileName: processed.name, contentType: putContentType, isThumb: false },
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
    { key, publicUrl }, presignedUrl,
    { albumId, fileName: 'poster.jpg', contentType: 'image/jpeg', isThumb: true },
    blob, () => {}, signal,
  )
  return result.publicUrl
}

// The OUTER recovery loop's more permissive view — which attempts are final and which are worth
// another pass — now lives in tusFailureAction in src/lib/upload-policy.ts, together with the relay
// decision it has to outrank. It was a local isFatalTusError here, and separating the two halves is
// precisely what let a repairable 400 be thrown as fatal before the relay branch could see it.

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
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      stall.stop()
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    // The video half of the same wall-clock defect as putWithRetry's watchdog above: a backward
    // clock step made the difference negative and the watchdog stopped existing, leaving a video
    // upload spinning forever. Monotonic, and the timer lives with the decision (rule 15).
    const stall = createStallWatch({
      stallMs: TUS_STALL_MS,
      checkEveryMs: 5000,
      onStall: () => {
        settle(() => {
          try { upload.abort() } catch { /* ignore */ }
          reject(new Error('Video upload stalled'))
        })
      },
    })
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
      // A missing-Content-Length 400 is the one 4xx worth retrying: the retry may go through the
      // relay, which sets the header itself. See isMissingContentLengthFailure.
      onShouldRetry: (err: unknown) =>
        !isDeterministicTusError(err) || isMissingContentLengthFailure(errText(err)),
      onProgress: (bytesUploaded, bytesTotal) => {
        stall.poke()
        onFraction(bytesTotal > 0 ? bytesUploaded / bytesTotal : 0)
      },
      onSuccess: () => settle(resolve),
      onError: (err) => settle(() => reject(err instanceof Error ? err : new Error(String(err)))),
    })
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
      // ONE call, because the ORDER of these questions is the bug this replaced. Asking "is it
      // fatal?" first threw every missing-Content-Length 400 as final before the relay branch below
      // could run, so the recovery written for Chrome on iOS 26 never once executed. tusFailureAction
      // owns the precedence and tests/upload-policy.test.ts holds it.
      const action = tusFailureAction(tusHttpStatus(e), errText(e), relayState.active)
      if (action === 'fatal') throw e
      lastErr = e instanceof Error ? e : new Error(String(e))
      // The relay repairs a missing Content-Length because our Worker forwards the chunk as an
      // ArrayBuffer, so the runtime sets the header itself regardless of what the phone sent.
      if (action === 'relay') {
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

    // The same question, at the other door. A video is sent RAW -- no processing at all -- so
    // file.type is whatever the picker declared, and an Android content-provider pick can declare
    // nothing while detectKind still admits the file on its extension (lib/media). /api/upload/stream
    // enforces the identical rules and answers with the identical six words, so without this the
    // guest reads "Missing or invalid fields" about their video exactly as she did about her photo.
    const unusableVideo = unusableUpload({ size: file.size, name: file.name, mimeType: file.type })
    if (unusableVideo) throw readFailure(unusableVideo)

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
    if (resume && isDeterministicTusError(e) && !isMissingContentLengthFailure(errText(e))) {
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
  // The server's code and nudge ride on the error (refusalFrom), so callers tell an expected refusal
  // from a genuine failure without matching English, and the banner cannot offer an account to
  // someone who already has one.
  if (!res.ok) throw await refusalFrom(res, 'Save failed')
  const data = await res.json().catch(() => ({})) as { warning?: string; rejected?: string[] }
  return { warning: data.warning, rejected: data.rejected }
}

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  album: Album
  onPhotosUploaded?: () => void
  /** The OWNER's uploads keep full camera quality (lib/upload-policy: maxImageDimFor). A courtesy
   *  decided client-side, not a gate — the server's byte caps still bound whatever arrives. */
  isOwner?: boolean
}

// Explicit video MIME types instead of video/* — avoids silently accepting
// .avi/.mkv/etc. that would pass the file picker but be rejected at upload
// Extensions .heic,.heif added alongside MIME types: Windows file pickers may not
// recognize HEIC by MIME type alone and need the extension to filter correctly.
// Built from the lists the server enforces. This was a fourth hand-written copy and had fallen two
// formats behind — video/ogg and video/x-m4v uploaded fine but the picker greyed them out, while
// drag-and-drop still worked. The .heic/.heif extensions stay: some Windows pickers match on
// extension only and hide HEIC otherwise.
const FILE_ACCEPT = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES, '.heic', '.heif'].join(',')

export default function UploadZone({ album, onPhotosUploaded, isOwner }: Props) {
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
  const [pendingSaveReason, setPendingSaveReason] = useState<'full' | 'fullOther' | 'failed' | null>(null)
  // Mirrored into state purely so the banner re-renders when it changes. Reading the ref during
  // render would show whatever count happened to be there at the last unrelated render.
  const [pendingSaveCount, setPendingSaveCount] = useState(0)
  // Which sentences and which buttons: lib/upload/retry-plan, not a ternary in the JSX below.
  const wall = pendingSaveReason ? wallCopy(pendingSaveReason, pendingSaveCount) : null
  const [retrying, setRetrying] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Separate input for the in-app camera: `capture` opens the phone's native camera directly.
  const cameraInputRef = useRef<HTMLInputElement>(null)

  // Computed once at mount — userAgent never changes during a session
  const [isMobile] = useState(() => typeof navigator !== 'undefined' && /Mobi|Android/i.test(navigator.userAgent))
  const concurrency = isMobile ? UPLOAD_CONCURRENCY_MOBILE : UPLOAD_CONCURRENCY_DESKTOP
  // Adaptive video lane widens toward this ceiling only as a network proves it can take it.
  const videoMax = isMobile ? VIDEO_CONCURRENCY_MAX_MOBILE : VIDEO_CONCURRENCY_MAX_DESKTOP

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
  // The adaptive video lane, for the whole session: it widens only on a proven clean streak and
  // collapses to serial the moment the NETWORK drops one. lib/upload/video-lane owns both the rule
  // and the semaphore it acts on, and knows that a cancel or a deliberate refusal is neither.
  const videoLaneRef = useRef<ReturnType<typeof createVideoLane> | null>(null)

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
    trackUploadStep('started', toUpload.length, album.id)
    // The banner describes the last attempt. A wall with nothing held has no way to clear itself
    // otherwise, and would sit over the photos this attempt is about to upload (lib/upload/retry-plan).
    setPendingSaveReason(prev => wallOnNewAttempt(prev, pendingSaveRef.current.length))
    // Bytes and clock for this batch, so the throughput reported at the end is a measurement rather
    // than an impression. "Uploads feel slow" fits a slow connection, a slow phone and a slow server
    // equally well, and those are three completely different fixes.
    // MONOTONIC, not Date.now (rule 22): a phone that takes an NTP correction mid-batch would
    // otherwise report a throughput wrong by the size of the jump. Why, at length, in the module.
    const batchStartedAt = monotonicNow()
    let deliveredBytes = 0   // bytes that actually crossed the network, counted as each file lands
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
    if (!videoLaneRef.current) videoLaneRef.current = createVideoLane(videoSem, videoMax)
    const videoLane = videoLaneRef.current

    // Incremental saver: each file's row is written within ~1.2s of its upload finishing.
    // A tile flips to 'done' only once its row is actually IN the database — before that a
    // "done" tile could still be lost by closing the tab.
    // The batching, the serial chain, the refused-uid rule and the warn-once are
    // lib/upload/row-saver; this is what THIS screen does with each answer.
    const saver = createRowSaver<PhotoRow>({
      save: (rows) => saveUploadedRows(album.id, rows),
      onSaved: (ids) => { for (const id of ids) patchEntry(id, { status: 'done', progress: 100 }) },
      onFailed: (ids, msg, code, rows, nudge) => {
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
          // Each file waits ONCE: a second refusal for the same file used to append a second pair,
          // so the banner counted the same photo twice and finishing the job posted both rows.
          pendingSaveRef.current = queuePendingRows(pendingSaveRef.current, pairs)
          setPendingSaveCount(pendingSaveRef.current.length)
          // Which banner, and which refusal outranks which, is lib/upload/retry-plan.
          setPendingSaveReason(prev => mergeWall(prev, wallFor(code, nudge)))
        }
        // Same rule on the save path: a gate refusal arrives here as a plain message, and it is
        // not a failure of ours any more than a full album is.
        const expectedSave = full || isExpectedRefusal(msg)
        reportClientEvent(expectedSave ? 'warn' : 'error', full ? 'album-full' : 'save', msg, album.id, { count: ids.length })
      },
      // Over-limit nag (once per upload session): the server flags albums past the free allowance.
      onWarning: (msg) => showAppToast(msg, 'success'),
    })

    // One dropped connection fails every file in flight for the SAME reason. Reporting and
    // toasting each one separately turned a single incident into 98 toasts churning through the
    // viewport, 98 rows in the admin dashboard, and 98 counts against the error-alert threshold —
    // three different surfaces all saying one thing 98 times. Failures are collected here and
    // summarised once the batch settles.
    const batchFailures: { msg: string; kind: string; sizeMB: number; status?: number; parked: boolean; waitedMs?: number; directCause?: string; relayCause?: string; code?: string }[] = []
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
        const weight = kind === 'video' ? videoLane.weightFor(entry.file.size) : 1
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
            ? await uploadImageToR2(entry.file, album.id, caps.image, maxImageDimFor(isOwner === true), pct => patchEntry(entry.id, { progress: pct }), signal)
            : await uploadVideoToStream(entry.file, album.id, pct => patchEntry(entry.id, { progress: pct }), signal, entry.videoResume)

          // Bytes are in storage; the saver flips this tile to 'done' when the row commits.
          deliveredBytes += entry.file.size
          patchEntry(entry.id, { progress: 100, videoResume: undefined })
          saver.add(row, entry.id)
          if (kind === 'video') videoLane.note('clean')   // the lane may widen on a proven streak
        } catch (e) {
          const msg = friendlyUploadError(e)
          // Park a network failure instead of killing it — but only once per file. On 2026-08-18 at
          // 19:47 one Android phone lost its connection and 8 files (5 images, 3 videos) died at the
          // control plane with no bytes moved; nothing watched for the network coming back, so they
          // sat as red tiles until the guest happened to look. A phone that goes back in a pocket
          // took those photos with it. The File objects are still in memory, so the uploader can
          // simply wait and try again.
          const parked = shouldPark(isRecoverableNetworkFailure(e), entry)
          patchEntry(entry.id, {
            status: parked ? 'waiting' : 'error',
            error: msg,
            // Keep the resume state so Retry continues this video from its confirmed offset
            // instead of restarting from zero.
            ...(e instanceof VideoUploadError && e.resume ? { videoResume: e.resume } : {}),
          })
          // The lane decides what this failure says about the NETWORK: a cancel and a deliberate
          // refusal say nothing, and counting either used to collapse the lane to serial for the
          // whole session on a connection that was fine.
          if (kind === 'video') videoLane.note(videoOutcomeOf(e))
          // A full album refused HERE is the same refusal as one refused at save, and this is the
          // moment of highest intent. Nothing is queued yet, so wallCopy drops "Finish saving".
          const refusal = refusalFields(e)
          if (refusal.code === 'album_full') setPendingSaveReason(prev => mergeWall(prev, wallFor(refusal.code, refusal.nudge)))
          // Surface the real error (it was previously hidden in a title tooltip, invisible on
          // mobile). AbortError is a deliberate cancel, not worth toasting.
          if (!(e instanceof DOMException && e.name === 'AbortError')) {
            // Recorded for the grouped admin report sent once the batch settles; the toast below
            // is deduplicated by reason so the same failure is never said twice.
            batchFailures.push({
              msg: e instanceof Error ? e.message : String(e),
              // Set only by the both-routes-failed path, so the admin row can say which stage died
              // and how, without that detail changing the message it groups on.
              directCause: (e as { directCause?: string })?.directCause,
              relayCause: (e as { relayCause?: string })?.relayCause,
              kind: kind === 'video' ? 'upload:video' : 'upload:image',
              sizeMB: Math.round(entry.file.size / 1024 / 1024),
              status: e instanceof HttpError ? e.status : undefined,
              code: refusal.code,
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
        // A refusal is not a failure. Too-large and unsupported-type mean the product looked at
        // the file and correctly declined it — the same class of event as hitting the album cap,
        // which is already logged at warn. Logged as errors they sat in the admin Errors tab
        // implying something was broken: a 103 MB video refused twice on 2026-08-18 was two of
        // the four "errors" outstanding, and nothing was wrong.
        // A full album refused at presign is the same refusal as one refused at save: same source, same level.
        const full = sample.code === 'album_full'
        const expected = full || isExpectedRefusal(sample.msg)
        // A parked failure is not (yet) a lost photo — the uploader is going to retry it by itself.
        // Reporting it at error level would put a row in the Errors tab, and a count against the
        // error-alert threshold, for an incident the product is in the middle of handling
        // correctly; on ordinary venue Wi-Fi that is the dashboard crying wolf all evening. It is
        // still reported, at warn, because how often guests hit this is worth knowing. If auto-
        // resume then fails, that second failure is not parked and lands as a real error.
        const level = expected || sample.parked ? 'warn' : 'error'
        reportClientEvent(level, full ? 'album-full' : sample.kind, sample.msg, album.id, {
          failedFiles: n,
          sizeMB: sample.sizeMB,
          status: sample.status,
          ...(sample.parked ? { parked: true } : {}),
          ...(sample.waitedMs !== undefined ? { waitedSeconds: Math.round(sample.waitedMs / 1000) } : {}),
          ...(sample.directCause ? { directCause: sample.directCause } : {}),
          ...(sample.relayCause ? { relayCause: sample.relayCause } : {}),
        })
      }
    }

    const savedCount = await saver.finish()
    flushProgress()

    // Both halves of the outcome, so the dashboard shows a RATE rather than a count. media_uploaded
    // already recorded successes; without the failures beside them a bad night and a quiet night
    // produce the same shape.
    // What counts as measurable, and what "lost" means, are lib/upload/throughput's -- along with
    // the reason a short batch reports nothing rather than a number no upload could reach.
    const kbps = batchThroughputKbps(deliveredBytes, elapsedSince(batchStartedAt), savedCount)
    trackUploadStep('done', savedCount, album.id, kbps)
    const lost = lostCount(toUpload.length, savedCount)
    if (lost > 0) trackUploadStep('failed', lost, album.id)

    // Decrement before onPhotosUploaded so if the parent unmounts UploadZone
    // the queued setState call is already the final one
    activeBatchCountRef.current--
    setIsUploading(activeBatchCountRef.current > 0)
    // Only notify parent when at least one photo actually landed in the DB,
    // and only if still mounted (prevents leaking a timer in AlbumPageClient)
    if (mountedRef.current && savedCount > 0) onPhotosUploaded?.()
    abortCtrlsRef.current.delete(abortCtrl)
  // isOwner is a REAL dependency: owner verification is a round trip, so the page always
  // mounts as guest and flips later. Without it here, a batch started right after the flip
  // ran with the stale guest closure and encoded the owner's photos at 3500px — the exact
  // silent shrink this feature exists to end, live for that whole batch. (Correctness used
  // to depend, by accident, on `caps` changing identity after the owner refetch.)
  }, [album.id, caps, concurrency, isOwner, videoMax, patchEntry, flushProgress, onPhotosUploaded])

  const addFiles = useCallback((files: File[]) => {
    const valid = files.filter(f => detectKind(f) !== null)
    // Counted even when nothing is valid: someone who picks five files the product refuses is a
    // person who tried and got nothing, and that is exactly the case worth being able to see.
    trackUploadStep('picked', files.length, album.id)
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
  }, [startUploads, album.id])

  const handleInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const files = Array.from(input.files ?? [])
    // Read the bytes BEFORE clearing the input, never after.
    //
    // Clearing an <input type=file> releases the underlying reference the browser holds for each
    // File. On Android those are content:// URIs owned by another process, and a photo the CAMERA
    // has just written is backed by a short-lived one that dies with the input -- so every read
    // afterwards threw NotReadableError and the capture was lost. A gallery pick survives the same
    // treatment, which is exactly why "take a photo" failed while "choose a file" worked and the
    // difference looked like a camera problem.
    //
    // snapshotFiles copies each file into an in-memory File, so for those the bytes are ours and
    // the input can be released safely. NOT ALL of them: past SNAPSHOT_TOTAL_BUDGET a file keeps
    // its original reference, so on a very large selection most files are still holding a
    // content:// grant when the input is cleared. That is a deliberate trade -- copying 700 photos
    // into memory is what exhausted the tab and stopped uploads entirely -- but it means the
    // protection below is partial, and anyone changing either side should know which.
    // finally, so a throw mid-snapshot still leaves the control usable rather than stuck holding a
    // selection it cannot re-pick.
    try {
      await snapshotFilesStreaming(files, addFiles)
    } finally {
      input.value = ''  // allow re-selecting the same file after an error
    }
  }, [addFiles])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    await snapshotFilesStreaming(files, addFiles)
  }, [addFiles])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false)
  }, [])

  const retryBlockedRows = useCallback(async () => {
    const pending = pendingSaveRef.current
    if (retrying || pending.length === 0) return
    setRetrying(true)
    try {
      // The server saves what it can and NAMES what it refused. Discarding that list and
      // ticking everything green marks a video "done" that was never written — the guest sees a
      // finished tile for a video that is not in the album, which is worse than an honest error
      // because nothing prompts them to fix it. The debounced flush path already handles this
      // and says so; this sibling did not (rule 15: the decision was enforced at one call site
      // and not the other).
      const { rejected } = await saveUploadedRows(album.id, pending.map(p => p.row))
      const refused = new Set(rejected ?? [])
      const lost = refused.size > 0
        ? pending.filter(p => p.row.stream_uid && refused.has(p.row.stream_uid))
        : []
      const lostIds = new Set(lost.map(p => p.entryId))
      // ONLY WHAT THIS REQUEST CARRIED leaves the queue. A save takes up to 180 s on a venue
      // connection, and another file can be refused and queued while it is in flight -- clearing
      // the whole queue dropped that row on the floor with its bytes already in R2, and took the
      // "Finish saving" offer away with it, leaving a re-upload as the only route back. That is
      // the duplicate this path exists to prevent.
      const postedIds = new Set(pending.map(p => p.entryId))
      pendingSaveRef.current = pendingSaveRef.current.filter(p => !postedIds.has(p.entryId))
      setPendingSaveCount(pendingSaveRef.current.length)
      if (pendingSaveRef.current.length === 0) setPendingSaveReason(null)
      // Mark ONLY the entries whose rows were actually in this request. This used to flip every
      // entry with status 'error' to 'done', so in a mixed batch a photo that genuinely failed to
      // upload was given a green tick alongside the ones that really were saved — telling the
      // guest their photos were safe when those photos did not exist.
      const saved = new Set(pending.filter(p => !lostIds.has(p.entryId)).map(p => p.entryId))
      setEntries(prev => prev.map(e => {
        if (lostIds.has(e.id)) {
          // A refused uid will be refused forever — its upload token is already spent. Retry
          // (a fresh Stream session) is what actually works, so this has to land on the tile's
          // Retry button rather than back in the "finish the job" queue.
          return { ...e, status: 'error', progress: 0, error: 'its upload session had already been used. Tap Retry to send it again.' }
        }
        return saved.has(e.id) ? { ...e, status: 'done', error: undefined, progress: 100 } : e
      }))
      onPhotosUploaded?.()
      if (saved.size > 0) showAppToast(t('uploadWall.saved', { n: saved.size }), 'success')
    } catch (e) {
      // The sentence, not the endpoint name: a timed-out save reads "Timed out (/api/album/...)".
      showAppToast(e instanceof Error ? friendlyUploadError(e) : t('common.errorGeneric'), 'error')
    } finally {
      setRetrying(false)
    }
    // A useCallback so the two Retry paths can depend on it: both must be able to RE-SAVE a file
    // whose bytes are already in R2 rather than send them again.
  }, [album.id, retrying, t, onPhotosUploaded])

  const retryEntry = useCallback((id: string) => {
    // Same defect as the bulk path: `fresh` was assigned inside a setState updater and read on the
    // next line, before React had run it, so it was always null and startUploads was never called.
    // The tile flipped to "Preparing" and stayed there.
    const entry = entries.find(e => e.id === id)
    if (!entry) return
    // ITS BYTES MAY ALREADY BE IN R2. When the SAVE was refused (a full album, a blip), the upload
    // succeeded and the row is held for "Finish saving" -- re-uploading it presigns a fresh key,
    // sends the same bytes again, and queues a second row, so the album showed the photo twice
    // once there was room. Retry means re-save for those (lib/upload/retry-plan).
    if (retryMode(id, new Set(pendingSaveRef.current.map(p => p.entryId))) === 'resave') {
      void retryBlockedRows()
      return
    }
    // Which statuses a tap may retry, and whether it spends the one automatic resume, is the
    // module's; 'waiting' is tappable so nobody has to wait for the probe.
    const fresh = freshEntryFor(entry, 'tap')
    if (!fresh) return
    setEntries(prev => prev.map(e => (e.id === id ? fresh : e)))
    void startUploads([fresh])
  }, [entries, startUploads, retryBlockedRows])

  const dismissDone = useCallback(() => {
    setEntries(prev => {
      for (const e of prev) if (e.status === 'done' && e.preview) URL.revokeObjectURL(e.preview)
      return prev.filter(e => e.status !== 'done')
    })
  }, [])

  // Revoke any remaining preview object URLs when the component unmounts.
  const entriesRef = useRef(entries)
  useEffect(() => { entriesRef.current = entries })
  useEffect(() => () => {
    for (const e of entriesRef.current) if (e.preview) URL.revokeObjectURL(e.preview)
  }, [])

  const doneCount    = entries.filter(e => e.status === 'done').length
  const errorCount   = entries.filter(e => e.status === 'error').length
  const activeCount  = entries.filter(e => e.status === 'uploading' || e.status === 'pending').length
  const waitingCount = entries.filter(e => e.status === 'waiting').length


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
      .map(e => freshEntryFor(e, 'auto'))
      .filter((e): e is FileEntry => e !== null)
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
    void reachability.originRecovered().then((recovered) => {
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
    // Files whose bytes are already in R2 and whose row is waiting for "Finish saving" are
    // RE-SAVED, never re-sent: the chip used to re-upload them and duplicate the photo. This runs
    // BEFORE the re-upload guard below, and before its own early return: when every failure is a
    // refused save -- the full-album case -- there is nothing to re-upload, and a chip that
    // returned early would be a dead button for exactly the case it was fixed for. Re-saving has
    // its own guard (`retrying`), so it is not what retryingRef is protecting.
    const pendingIds = new Set(pendingSaveRef.current.map(p => p.entryId))
    const failed = entries.filter(e => e.status === 'error')
    if (failed.some(e => retryMode(e.id, pendingIds) === 'resave')) void retryBlockedRows()
    if (retryingRef.current) return
    const fresh = failed
      .filter(e => retryMode(e.id, pendingIds) === 'reupload')
      .map(e => freshEntryFor(e, 'chip'))
      .filter((e): e is FileEntry => e !== null)
    if (fresh.length === 0) return
    // Ref guard replaces the atomicity the updater was supposed to provide: a second tap before
    // the state has settled cannot start the same files twice.
    retryingRef.current = true
    const byId = new Map(fresh.map(e => [e.id, e]))
    setEntries(prev => prev.map(e => byId.get(e.id) ?? e))
    void startUploads(fresh).finally(() => { retryingRef.current = false })
  }, [entries, startUploads, retryBlockedRows])

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
      {wall && (
        <div style={{ marginBottom: 12, padding: 14, borderRadius: 14, background: '#F6E9EE', border: '1px solid #E3C9D3' }}>
          <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: '#630826' }}>{t(wall.title, { n: pendingSaveCount })}</p>
          <p style={{ margin: '0 0 12px', fontSize: 13.5, lineHeight: 1.5, color: '#5C4A3C' }}>{t(wall.body, { n: pendingSaveCount })}</p>
          {(wall.offersAccount || wall.canFinish) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {wall.offersAccount && (
            <a
              href="/login" target="_blank" rel="noopener noreferrer" className="hush-press"
              style={{ padding: '10px 18px', fontSize: 14, fontWeight: 700, color: '#FDFAF5', background: '#630826', borderRadius: 10, textDecoration: 'none' }}
            >
              {t('uploadWall.cta')}
            </a>
            )}
            {wall.canFinish && (
            <button
              type="button" onClick={() => void retryBlockedRows()} disabled={retrying} className="hush-press"
              style={{ padding: '10px 18px', fontSize: 14, fontWeight: 700, color: '#630826', background: '#FFFFFF', border: '1.5px solid #E3C9D3', borderRadius: 10, cursor: retrying ? 'wait' : 'pointer' }}
            >
              {retrying ? t('uploadWall.saving') : t('uploadWall.retry')}
            </button>
            )}
          </div>
          )}
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
            {/* Says what this DOES, because the box above says what it does. A guest who wants
                to find themselves must be able to tell the two apart at a glance. */}
            {album.face_finder_enabled && (
              <span className="block text-xs mt-1" style={{ color: '#8B6F4E' }}>{t('upload.contributeHint')}</span>
            )}
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
          On the rare narrow desktop it degrades to a normal file dialog (capture is ignored).

          OUTLINE WHEN FACE FINDER IS ON, FILLED OTHERWISE. Solid maroon and full width, this was
          the largest and loudest control on a phone — roughly 2.7x the area of anything in the
          actions bar, and in the same colour. Making "Find my photos" the one filled pill was not
          enough on its own: two maroon buttons competed and the bigger one still won, which is
          exactly how runners ended up photographing their faces into the album.

          Only on face-finder albums. Where the album's whole purpose IS collecting photos — a
          wedding, a party — the camera button is the right thing to shout, and it keeps shouting.
          One filled maroon control per screen, and it is the one that matches why the visitor
          came. */}
      <button
        type="button"
        onClick={() => cameraInputRef.current?.click()}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl py-3 font-semibold transition-transform active:scale-[0.99] sm:hidden"
        style={album.face_finder_enabled
          ? { background: '#FDFAF5', color: '#630826', border: '1.5px solid #630826' }
          : { background: '#630826', color: '#FDFAF5' }}
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
