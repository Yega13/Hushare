// Mutation set for src/lib/upload/image-pipeline.ts -- run with:
//   node scripts/mutations/run.mjs image-pipeline
//
// The code that decides what happens to a guest's photo before it leaves their phone. It lived in
// UploadZone.tsx, where no test ran it. Nearly every mutation below produces an upload that LOOKS
// successful: a photo stored sideways, stored with its GPS position, stored as PNG bytes under a
// .webp name, flattened from an animation to one frame, or a phone that runs out of memory halfway
// through a batch. None of those throws.
export default {
  file: 'src/lib/upload/image-pipeline.ts',
  test: 'tests/image-pipeline.test.ts',
  mutations: [
    // ── memory: every decoded bitmap is released, and the decode slot is given back ───────────────
    { name: 'the resized bitmap is never released -- a 48 MP batch exhausts the phone',
      from: 'resized.close()', to: 'void 0' },
    { name: 'the native HEIC bitmap is never released',
      from: 'native.close()', to: 'void 0' },
    { name: 'the decode slot is never given back -- after N photos every later one waits forever',
      from: 'release()', to: 'void 0' },
    // The two `bitmap.close()` calls are told apart by indentation: the HEIC one sits two levels
    // deeper. Each anchor below matches exactly one of them, and the runner refuses it otherwise.
    { name: 'the converted HEIC bitmap is never released',
      from: '      } finally {\n        bitmap.close()\n      }', to: '      } finally {\n        void 0\n      }' },
    { name: 'the main decoded bitmap is never released -- every photo in a batch holds its full decode',
      from: '    } finally {\n      bitmap.close()\n    }\n  }', to: '    } finally {\n      void 0\n    }\n  }' },
    { name: 'the GIF bitmap is never released',
      from: 'bitmap?.close()', to: 'void 0' },

    // ── resize ────────────────────────────────────────────────────────────────────────────────────
    { name: 'a refused high-quality resample fails the photo instead of falling back to a plain draw',
      from: '} catch { /* Safari < 17.4 — plain smoothed draw below */ }', to: '} catch (e) { throw e }' },
    { name: 'a very thin image gets a zero-pixel side',
      from: 'const h = Math.max(1, Math.round(bitmap.height * scale))', to: 'const h = Math.round(bitmap.height * scale)' },
    { name: 'the shrink ladder never steps down, so an over-cap photo is refused at upload',
      from: 'const dim = nextShrinkDim(rung, main.blob.size, capBytes, ladder)', to: 'const dim = null as number | null' },
    { name: 'a resized photo is labelled with the type ASKED for, not the one produced (PNG bytes under .webp)',
      from: 'const actualMime = main.blob.type && isAllowedImage(main.blob.type) ? main.blob.type : outMime', to: 'const actualMime = outMime' },

    // ── thumbnail ─────────────────────────────────────────────────────────────────────────────────
    { name: 'the grid thumbnail is encoded at full photo quality',
      from: "scaleAndEncode(bitmap, THUMB_MAX_DIM, 'image/jpeg', THUMB_QUALITY)", to: "scaleAndEncode(bitmap, THUMB_MAX_DIM, 'image/jpeg', MAIN_QUALITY)" },

    // ── JPEG: orientation and location ────────────────────────────────────────────────────────────
    { name: 'a rotated JPEG is losslessly stripped -- the orientation tag goes with it, stored SIDEWAYS',
      from: 'if (jpegOrientation(raw) !== 1) {', to: 'if (false) {' },
    { name: 'an undecodable JPEG goes up with its EXIF (GPS) intact',
      from: "return { blob: await strippedJpegBlob(file), thumbBlob: null, mimeType: 'image/jpeg', name: file.name, width: null, height: null }",
      to: "return { blob: file, thumbBlob: null, mimeType: 'image/jpeg', name: file.name, width: null, height: null }" },

    // ── PNG / WebP ────────────────────────────────────────────────────────────────────────────────
    { name: 'a small PNG/WebP goes up with its location metadata',
      from: "const cleaned = mimeType === 'image/png' ? stripMetadataFromPng(raw) : stripMetadataFromWebp(raw)", to: 'const cleaned = raw' },
    { name: 'a file with nothing to strip is copied into a new Blob instead of passed through',
      from: 'const blob = cleaned.length === raw.length', to: 'const blob = false' },
    { name: 'an unreadable small WebP re-encoded by iOS 15/16 as PNG is stored under .webp',
      from: 'const actual = main.blob.type && isAllowedImage(main.blob.type) ? main.blob.type : want', to: 'const actual = want' },

    // ── GIF ───────────────────────────────────────────────────────────────────────────────────────
    { name: 'a GIF goes through the canvas like any other image -- the animation is flattened to one frame',
      from: "if (mimeType === 'image/gif') {", to: 'if (false) {' },

    // ── formats the server will not store ─────────────────────────────────────────────────────────
    { name: 'an undecodable unsupported file is uploaded and refused at presign instead of refused here',
      from: "throw new Error('Unsupported image format. Please upload JPEG, PNG, HEIC, WebP or GIF.')", to: 'void 0' },
    { name: 'a converted AVIF keeps its .avif name on JPEG bytes',
      from: "name: file.name.replace(/\\.[^.]+$/, '.jpg'), width: main.width", to: 'name: file.name, width: main.width' },

    // ── the <img> last resort ─────────────────────────────────────────────────────────────────────
    { name: 'the object URL is never revoked -- every unreadable photo leaks its whole file',
      from: 'deps.revokeObjectURL(url)', to: 'void url' },
    { name: 'an <img> reporting zero size is trusted and drawn as a 1-pixel image',
      from: 'if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) return null', to: '' },
    { name: 'a transparent PNG redrawn through <img> comes out as JPEG with a black background',
      from: "const outMime = mimeType === 'image/png' ? 'image/png' : 'image/jpeg'", to: "const outMime = 'image/jpeg'" },

    // ── HEIC ──────────────────────────────────────────────────────────────────────────────────────
    { name: 'a .HEIC with no type (common from file pickers) is not recognised as HEIC',
      from: '|| /\\.(heic|heif)$/i.test(file.name)', to: '' },
    { name: 'the native decode is skipped, so Safari pays for the slow converter',
      from: 'const native = await deps.decodeImageSource(file)', to: 'const native = null as ImageBitmap | null' },
    { name: 'the worker is skipped and every HEIC converts on the main thread, freezing the page',
      from: 'jpegBlob = await deps.convertHeicViaWorker(file)', to: "throw new Error('skipped')" },
    { name: 'the CSP classifier is handed the message only, so an EvalError named only by its name is missed',
      from: 'const signature = mainErr instanceof Error ? `${mainErr.name}: ${mainErr.message}` : String(mainErr)', to: 'const signature = detail' },
    { name: 'a guest whose browser refuses the converter is shown the raw policy error',
      from: 'if (isEvalBlockedByCsp(signature)) {', to: 'if (false) {' },
    { name: 'the HEIC bloat check uses the album cap, so a 30 MB conversion goes up whole',
      from: 'jpegBlob.size, 2 * 1024 * 1024, maxDim)', to: 'jpegBlob.size, capBytes, maxDim)' },
    { name: 'the HEIC bloat limit is 2,000,000 bytes rather than 2 MiB',
      from: '2 * 1024 * 1024', to: '2 * 1000 * 1000' },

    // ── survivors the review of ccb9b1d found, each killed by an assertion added for it ───────────
    { name: 'a native-HEIC photo loses its thumbnail, so the grid downloads the full photo',
      from: "thumbBlob, mimeType: 'image/jpeg', name: jpgName, width: main.width, height: main.height }\n        } finally {\n          native.close()",
      to: "thumbBlob: null, mimeType: 'image/jpeg', name: jpgName, width: main.width, height: main.height }\n        } finally {\n          native.close()" },
    { name: 'a small HEIC conversion loses its thumbnail',
      from: 'strippedJpegBlob(jpegBlob), thumbBlob, mimeType', to: 'strippedJpegBlob(jpegBlob), thumbBlob: null, mimeType' },
    { name: 'a resized photo loses its thumbnail',
      from: 'thumbBlob, mimeType: actualMime, name,', to: 'thumbBlob: null, mimeType: actualMime, name,' },
    { name: 'a stripped PNG/WebP loses its thumbnail',
      from: 'return { blob, thumbBlob, mimeType, name: file.name,', to: 'return { blob, thumbBlob: null, mimeType, name: file.name,' },
    { name: 'a TALL photo is judged on its width, so a portrait over 3500px is never shrunk',
      from: 'needsReEncode(Math.max(bitmap.width, bitmap.height), file.size', to: 'needsReEncode(bitmap.width, file.size' },
    { name: 'a TALL HEIC conversion is judged on its width',
      from: 'needsReEncode(Math.max(bitmap.width, bitmap.height), jpegBlob.size', to: 'needsReEncode(bitmap.width, jpegBlob.size' },
    { name: 'the <img> last resort ENLARGES a small photo to the 3500px limit',
      from: 'const scale = Math.min(1, maxDim / Math.max(srcW, srcH))', to: 'const scale = maxDim / Math.max(srcW, srcH)' },
    { name: 'an undecodable image/jpg goes up with its GPS',
      from: "      if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {\n        try {", to: "      if (mimeType === 'image/jpeg') {\n        try {" },
    { name: 'a type written in capitals is not recognised as HEIC',
      from: '/heic|heif/i.test(file.type)', to: '/heic|heif/.test(file.type)' },
    { name: 'the main path does not lowercase the type, so IMAGE/GIF is flattened like any other image',
      from: "    const mimeType = (file.type || 'image/jpeg').toLowerCase()\n\n    // Animated", to: "    const mimeType = (file.type || 'image/jpeg')\n\n    // Animated" },
    { name: 'the <img> path does not lowercase the type, so IMAGE/PNG loses its transparency',
      from: "      const mimeType = (file.type || 'image/jpeg').toLowerCase()\n      // Preserve", to: "      const mimeType = (file.type || 'image/jpeg')\n      // Preserve" },
    { name: 'any extension on a HEIC-typed file is renamed .jpg',
      from: "file.name.replace(/\\.(heic|heif)$/i, '.jpg')", to: "file.name.replace(/\\.[^.]+$/, '.jpg')" },
    { name: 'an unreadable WebP that re-encodes as WebP is named .jpg',
      from: "const ext = actual === 'image/png' ? '.png' : actual === 'image/webp' ? '.webp' : '.jpg'", to: "const ext = actual === 'image/png' ? '.png' : actual === 'image/webp' ? '.jpg' : '.jpg'" },
    { name: 'a stripped PNG/WebP is typed image/jpeg',
      from: '{ type: mimeType })', to: "{ type: 'image/jpeg' })" },
    { name: 'an encoder type the server refuses (BMP) becomes the stored label',
      from: 'const actualMime = main.blob.type && isAllowedImage(main.blob.type) ? main.blob.type : outMime', to: 'const actualMime = main.blob.type ? main.blob.type : outMime' },
    { name: 'a stripped JPEG carries no type',
      from: "return new Blob([stripped.buffer as unknown as ArrayBuffer], { type: 'image/jpeg' })", to: 'return new Blob([stripped.buffer as unknown as ArrayBuffer])' },
  ],
}
