// Mutation set for src/lib/image-decode.ts -- run with:
//   node scripts/mutations/run.mjs image-decode
//
// This module had tests and no mutation set, which is the combination that lets a suite go quietly
// weak: tests/image-decode.test.ts opens by naming four mutations that once survived the WHOLE
// suite, and nothing has re-run them since the day they were fixed.
//
// Everything here fails silently. A photo stored sideways, a decode path never attempted, a
// full-resolution frame leaked per photo -- none of them throw, and none of them look wrong in a
// diff.
export default {
  file: 'src/lib/image-decode.ts',
  test: 'tests/image-decode.test.ts',
  mutations: [
    // ── EXIF orientation: the failure that is permanent and invisible ──────────────────────────
    { name: 'THE ENGINE LIMITATION IS NEVER RECORDED, so the caller re-encodes un-rotated pixels',
      from: "    if (rejectsOrientationOption(e)) orientationOptionRejected = true\n", to: "" },
    { name: 'ANY decode failure is treated as an engine that cannot rotate, so every photo skips re-encoding',
      from: "  return e instanceof TypeError && /imageOrientation/i.test(e.message)",
      to: "  return e instanceof Error" },
    { name: 'the option rejection is never recognised, which is the same as not looking',
      from: "  return e instanceof TypeError && /imageOrientation/i.test(e.message)",
      to: "  return false" },
    { name: 'orientation is always reported as applied, whatever the engine said',
      from: "  return !orientationOptionRejected", to: "  return true" },
    { name: 'the limitation is forgotten after the photo that revealed it, so the next one goes sideways',
      from: "    if (rejectsOrientationOption(e)) orientationOptionRejected = true",
      to: "    orientationOptionRejected = false" },
    { name: 'the decode stops ASKING for orientation at all -- old Android WebViews default to none',
      from: "createImageBitmap(source, { imageOrientation: 'from-image' })",
      to: "createImageBitmap(source, { imageOrientation: 'none' })" },

    // ── the four the test file says once survived the whole suite ──────────────────────────────
    { name: 'the two native attempts swap order, so every photo pays for WebCodecs first',
      from: "  return (await decodeBitmapSafe(source)) ?? (await decodeViaImageDecoder(source))",
      to: "  return (await decodeViaImageDecoder(source)) ?? (await decodeBitmapSafe(source))" },
    { name: 'EVERY PHOTO LEAKS A FULL-RESOLUTION FRAME (VideoFrame memory is outside the JS heap)',
      from: "        image.close()\n", to: "" },
    { name: 'the WebCodecs attempt is dropped, so Android cannot upload a HEIC at all',
      from: "  return (await decodeBitmapSafe(source)) ?? (await decodeViaImageDecoder(source))",
      to: "  return await decodeBitmapSafe(source)" },
    { name: 'the bare retry is dropped, turning an options-bag rejection into a failed upload',
      from: "      return await createImageBitmap(source)\n", to: "      return null\n" },
  ],
}
