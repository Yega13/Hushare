// EVERYTHING BETWEEN A GUEST PICKING A PHOTO AND ITS BYTES BEING READY TO UPLOAD, where a test can reach it.
//
// This lived inside UploadZone.tsx: the code that decides whether a photo is re-encoded or kept
// exactly as shot, how far it is shrunk, whether its location data is stripped, how a HEIC is
// converted, and what happens to a file the device will not hand over. No test executed a line of
// it. The encoder beneath it moved out first (lib/upload/image-encode), after it stored twelve
// photos as zero bytes on 2026-09-12; this is the rest.
//
// MOVED, NOT REWRITTEN. The body below was generated from the component by exact, counted
// replacements: every branch, its order, every thrown sentence and every literal is the one
// UploadZone had. The only change is that each call reaching for the browser now goes through
// `deps`, because every failure worth testing here is one CI cannot produce -- a resize the
// browser refuses, a file that displays but will not read, a HEIC converter that crashes or is
// refused by the CSP. The comments inside still name the real implementations.
//
// NOT INJECTED: lib/exif, lib/upload-policy, lib/media and the quality constants. They are pure,
// so the tests run the real rules rather than copies of them (rule 17).

import { jpegOrientation, stripExifFromJpeg, stripMetadataFromPng, stripMetadataFromWebp } from '@/lib/exif'
import { isAllowedImage } from '@/lib/media'
import { isEvalBlockedByCsp, needsReEncode, nextShrinkDim, outputMimeFor, shrinkLadderFor } from '@/lib/upload-policy'
import { MAIN_QUALITY, THUMB_MAX_DIM, THUMB_QUALITY } from '@/lib/upload/image-encode'

export type ProcessedImage = {
  blob: Blob
  thumbBlob: Blob | null
  mimeType: string
  name: string
  width: number | null
  height: number | null
}

/** The browser, as far as this pipeline needs it. The real implementations are wired in UploadZone. */
export type PipelineDeps = {
  /** Draw and encode at w x h: lib/upload/image-encode's bitmapToBlob. */
  bitmapToBlob: (source: CanvasImageSource, w: number, h: number, mime: string, quality: number) => Promise<Blob>
  /** The fused high-quality resample (createImageBitmap with resize options). May reject; the caller falls back to a plain draw. */
  resizeBitmap: (bitmap: ImageBitmap, w: number, h: number) => Promise<ImageBitmap>
  /** lib/image-decode's decodeImageSource: both native decoders, in order. */
  decodeImageSource: (source: Blob) => Promise<ImageBitmap | null>
  /** lib/image-decode's decodeBitmapSafe. */
  decodeBitmapSafe: (source: Blob) => Promise<ImageBitmap | null>
  /** HEIC to JPEG in a Web Worker. */
  convertHeicViaWorker: (file: File) => Promise<Blob>
  /** HEIC to JPEG on the main thread, tried when the worker fails. */
  convertHeicMainThread: (file: File) => Promise<Blob>
  /** lib/file-read's readFileRobust. */
  readBytes: (blob: Blob) => Promise<ArrayBuffer>
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
  /** Load a URL into an <img> element. */
  loadImageElement: (url: string) => Promise<HTMLImageElement>
  /** Take one of the bounded decode slots; resolves to the function that gives it back. */
  acquireDecode: () => Promise<() => void>
}

export function createImagePipeline(deps: PipelineDeps) {
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
        const resized = await deps.resizeBitmap(bitmap, w, h)
        try {
          return { blob: await deps.bitmapToBlob(resized, w, h, mime, quality), width: w, height: h }
        } finally {
          resized.close()
        }
      } catch { /* Safari < 17.4 — plain smoothed draw below */ }
    }
    return { blob: await deps.bitmapToBlob(bitmap, w, h, mime, quality), width: w, height: h }
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
    const buf = await deps.readBytes(source)
    const stripped = stripExifFromJpeg(new Uint8Array(buf))
    return new Blob([stripped.buffer as unknown as ArrayBuffer], { type: 'image/jpeg' })
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
    return { blob: await deps.bitmapToBlob(source, w, h, mime, quality), width: w, height: h }
  }

  // LAST-RESORT decode for Android files that DISPLAY but whose raw bytes are unreadable — every
  // byte read (Blob.arrayBuffer, FileReader, blob-URL fetch) throws NotReadableError, yet an <img>
  // renders them (the same path that makes the picked photo's PREVIEW appear). We load the file
  // into an <img> element and re-encode it through a canvas, producing FRESH in-memory bytes we
  // can actually upload. The <img> element auto-applies EXIF orientation, so the pixels are upright.
  async function processViaImgElement(file: File, maxDim: number): Promise<ProcessedImage | null> {
    const url = deps.createObjectURL(file)
    try {
      const img = await deps.loadImageElement(url)
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
      deps.revokeObjectURL(url)
    }
  }

  // ─── processImage — ONE decode produces everything ───────────────────────────
  // The upload blob, the 600px grid thumbnail AND the intrinsic dimensions all come from a
  // single createImageBitmap decode. The previous pipeline decoded every image up to three
  // times (resize, then thumbnail, then dimensions) — pure wasted CPU on the critical path.


  async function processImage(file: File, capBytes: number, maxDim: number): Promise<ProcessedImage> {
    const release = await deps.acquireDecode()
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
      const native = await deps.decodeImageSource(file)
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
        jpegBlob = await deps.convertHeicViaWorker(file)
      } catch {
        try {
          jpegBlob = await deps.convertHeicMainThread(file)
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

      const bitmap = await deps.decodeBitmapSafe(jpegBlob)
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
      const bitmap = await deps.decodeBitmapSafe(file)
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

    const bitmap = await deps.decodeBitmapSafe(file)
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
          raw = new Uint8Array(await deps.readBytes(file))
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
        raw = new Uint8Array(await deps.readBytes(file))
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

  return { processImage }
}
