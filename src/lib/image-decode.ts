/**
 * TURNING SOMEBODY'S PHOTO INTO PIXELS — every attempt, in order, and when to give up.
 *
 * WHY IT IS HERE AND NOT IN THE UPLOADER. It lived in UploadZone.tsx, where four mutations to it
 * survived the entire suite: deleting the WebCodecs attempt outright, reversing the order of the two
 * native attempts, dropping `image.close()`, and skipping the `isTypeSupported` question. Each is a
 * silent defect on the path a guest's photo takes — the first two decide whether an Android guest
 * can upload at all, the third leaks a full-resolution frame per photo, and the fourth throws inside
 * the decoder instead of falling through. None is visible in review and none throws where anyone
 * would see it (rule 14).
 *
 * THE ORDER IS THE DECISION.
 *
 *   1. createImageBitmap — the platform's ordinary path. Handles HEIC on Safari, which is why
 *      iPhones never reach anything below this line, and is the cheapest of the three.
 *   2. ImageDecoder (WebCodecs) — the platform's OTHER decoder. Android has HEIF support at the OS
 *      level and Chrome exposes it here.
 *   3. (the caller's WASM converter, which is not in this module)
 *
 * Reversing 1 and 2 is not a style question: it sends every photo on every device through a decoder
 * that copies a full-resolution frame an extra time, to reach the same pixels the first attempt
 * would have produced.
 *
 * WHY STEP 2 EXISTS AT ALL. Chrome on Android cannot decode HEIC through createImageBitmap, so it
 * fell through to heic2any — whose emscripten glue calls `new Function(...)`, which our
 * Content-Security-Policy refuses in a worker and on the main thread alike. The only alternatives on
 * the table were weakening script-src for the whole site or telling that guest no. This needs no
 * eval, no CSP change and no dependency, and where it works it is BETTER than the converter, which
 * decodes and then re-encodes to JPEG — two lossy generations instead of one decode.
 *
 * Every step is strictly additive: each returns null rather than throwing, and null means "the next
 * attempt, or the caller's own fallback". Nothing here can make a working path worse (rule 19).
 */

import { readFileRobust } from '@/lib/file-read'

/**
 * createImageBitmap, with EXIF rotation baked into the pixels and a fallback for old engines.
 *
 * `imageOrientation: 'from-image'` is the default in modern browsers but was 'none' in older Android
 * WebViews — which decode a rotated photo un-rotated, so the re-encoded upload arrives sideways.
 * Being explicit guarantees it, and the retry covers an engine that rejects the options bag outright.
 *
 * Takes an ImageBitmapSource, not just a Blob, so the WebCodecs path below can hand its VideoFrame
 * through the SAME orientation handling instead of calling createImageBitmap bare. That call was
 * bare, and a second copy of "how to turn a source into a correctly-oriented bitmap" is exactly the
 * shape of rule 13.
 */
export async function decodeBitmapSafe(source: ImageBitmapSource): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(source, { imageOrientation: 'from-image' })
  } catch {
    try {
      return await createImageBitmap(source)
    } catch {
      return null
    }
  }
}

/**
 * The platform's own decoder via WebCodecs. Null whenever it cannot help.
 *
 * MEMORY. This briefly holds three things at once: the file's bytes, the decoded frame, and the
 * ImageBitmap copied out of it — so its peak is roughly double the bitmap that UploadZone's decode
 * semaphore is sized against (~190MB RGBA for a 48MP photo, times two). That overlap is unavoidable:
 * the frame cannot be released until the copy exists. It is accepted rather than fixed because this
 * path is only ever reached when the ordinary decoder has ALREADY failed — HEIC on Android, and
 * nothing else — so it is rare, while lowering the semaphore for everyone would slow every upload on
 * every device to guard a case most of them never take. If Android phones start failing here, the
 * semaphore is the thing to lower, not this function.
 */
export async function decodeViaImageDecoder(source: Blob): Promise<ImageBitmap | null> {
  try {
    if (typeof ImageDecoder === 'undefined') return null
    const type = source.type
    if (!type) return null
    // ASKED, NEVER ASSUMED. An unsupported type throws inside the decoder instead of answering, and
    // this path must stay silent when the platform cannot help — a throw here would escape as a
    // failed upload rather than falling through to the converter that can still do the job.
    if (!(await ImageDecoder.isTypeSupported(type))) return null

    // readFileRobust, NEVER a bare arrayBuffer(). Android hands back a File backed by a content://
    // reference whose bytes throw NotReadableError for a few hundred milliseconds — and
    // intermittently again under memory pressure. That is not a hypothesis: this product has logged
    // 165 of them, against 556 Android user agents.
    //
    // This path is reached ONLY by Android Chrome with a HEIC — createImageBitmap has already
    // failed, which on every other platform it does not. So the one population that takes it is
    // exactly the population whose reads blip. With a bare read, that blip returned null even though
    // isTypeSupported had ALREADY said yes, and the guest fell through to the WASM converter, which
    // our CSP refuses, and was told:
    //
    //     "This browser cannot convert iPhone photo files (HEIC). Ask for the photo as a JPEG, or
    //      add it from an iPhone."
    //
    // — pointed at a device they do not have, for a photo the platform decoder had already agreed to
    // handle, when a retry 400ms later would have decoded it (rule 20).
    //
    // THE FULL RETRY BUDGET, not a reduced one. A readable file returns on the first attempt and
    // sleeps not at all, so the healthy path costs nothing. The file that pays the extra seconds is
    // one whose bytes are permanently unavailable — and that upload already fails today, because
    // convertHeicViaWorker calls readFileRobust too and spends the same time before dying. A second,
    // shorter definition of "how patient are we with a flaky file" is exactly what rule 13 forbids.
    const decoder = new ImageDecoder({ data: await readFileRobust(source), type })
    try {
      const { image } = await decoder.decode({ frameIndex: 0 })
      try {
        // A VideoFrame, not an ImageBitmap — through decodeBitmapSafe so it gets the same
        // orientation handling as every other decode.
        return await decodeBitmapSafe(image)
      } finally {
        // WITHOUT THIS, EVERY PHOTO LEAKS A FULL-RESOLUTION FRAME. A VideoFrame holds memory outside
        // the JS heap that the garbage collector cannot reclaim; 30 photos is gigabytes, on a phone.
        image.close()
      }
    } finally {
      decoder.close()
    }
  } catch {
    return null
  }
}

/**
 * Both native attempts, in order. Null means neither platform decoder could read this file.
 *
 * The caller decides what happens then — UploadZone falls through to the WASM converter, and other
 * call sites simply give up.
 */
export async function decodeImageSource(source: Blob): Promise<ImageBitmap | null> {
  return (await decodeBitmapSafe(source)) ?? (await decodeViaImageDecoder(source))
}
