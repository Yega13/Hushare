// Mutation set for src/lib/upload/image-encode.ts -- run with:
//   node scripts/mutations/run.mjs image-encode
//
// This module is here because the code it holds lost twelve photos on 2026-09-12 while living
// inside UploadZone.tsx, where nothing executed it. Album dm1ybi7j stored twelve rows pointing at
// twelve zero-byte objects in R2 and every tile went green.
//
// Every mutation below leaves the uploader looking like it worked. That is the point: the failure
// mode of an encoder is not a crash, it is a photograph that quietly becomes nothing.
export default {
  file: 'src/lib/upload/image-encode.ts',
  test: 'tests/image-encode.test.ts',
  mutations: [
    // ── the defect itself ──────────────────────────────────────────────────────────────────────
    { name: 'AN EMPTY BLOB IS ACCEPTED AGAIN (it is truthy) -- twelve photos went to R2 this way',
      from: "    if (blob && blob.size > 0) return blob", to: "    if (blob) return blob" },
    { name: 'the retry only fires on null, so an EMPTY encode is never tried a second time',
      from: "    if (!blob || blob.size === 0) {\n      await sleep(ENCODE_RETRY_MS)", to: "    if (!blob) {\n      await sleep(ENCODE_RETRY_MS)" },
    { name: 'the data-URL fallback only fires on null, so two empty encodes skip the last encoder',
      from: "    if ((!blob || blob.size === 0) && surface.encodeDataUrl) {", to: "    if (!blob && surface.encodeDataUrl) {" },
    // NOT MUTATED: `if (fallback && fallback.size > 0)`. Dropping the size half is an EQUIVALENT
    // mutant -- the final `blob && blob.size > 0` catches an empty fallback either way, so no test
    // can tell the difference and none should pretend to. The inner check stays as defence in
    // depth; it is simply not a thing a mutation can prove.

    // ── the recovery that makes a flaky encoder survivable ─────────────────────────────────────
    { name: 'no second attempt at all, so one moment of memory pressure loses the photo',
      from: "      await sleep(ENCODE_RETRY_MS)\n      blob = await surface.encode(mime, quality)\n", to: "" },
    { name: 'the retry does not wait, so it asks again before any buffer has been released',
      from: "export const ENCODE_RETRY_MS = 150", to: "export const ENCODE_RETRY_MS = 0" },
    { name: 'the data-URL fallback is dropped -- the only encoder left when toBlob refuses',
      from: "      try {\n        const url = surface.encodeDataUrl(mime, quality)", to: "      try {\n        const url = null as string | null" },

    // ── two encoders, in order, and the fallthrough between them ───────────────────────────────
    { name: 'the offscreen encoder is never tried, so every photo pays for the DOM canvas',
      from: "    if (deps.surfaces.offscreen) {", to: "    if (false) {" },
    { name: 'a failing offscreen encoder is FATAL instead of falling through to a different one',
      from: "      } catch { /* fall through to the DOM canvas */ }", to: "      } catch (e) { throw e }" },

    // ── the numbers a customer can see ─────────────────────────────────────────────────────────
    { name: 'main quality drops back to the value that softened skin on every stored photo',
      from: "export const MAIN_QUALITY = 0.92", to: "export const MAIN_QUALITY = 0.86" },
    { name: 'thumbnails are encoded harder than the photo itself',
      from: "export const THUMB_QUALITY = 0.85", to: "export const THUMB_QUALITY = 0.95" },
    { name: 'the grid thumbnail is too small to be sharp on a 3x screen',
      from: "export const THUMB_MAX_DIM = 600", to: "export const THUMB_MAX_DIM = 200" },

    // ── dataUrlToBlob, whose every rejection prevents an empty blob ────────────────────────────
    { name: 'a non-base64 data URL is decoded anyway, producing empty bytes',
      from: "  if (!header.startsWith('data:') || !header.includes(';base64')) return null", to: "" },
    { name: 'a URL with no comma is treated as a data URL',
      from: "  if (comma < 0) return null", to: "" },
  ],
}
