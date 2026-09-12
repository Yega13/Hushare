// Mutation set for THE UNREADABLE-FILE GUARD in src/components/UploadZone.tsx -- run with:
//   node scripts/mutations/run.mjs upload-zone-presign-guard
//
// scripts/mutations/presign-fields.mjs proves the module. This proves the lines that decide whether
// it runs -- and, above all, WHERE it runs. A guard placed after the request it exists to prevent
// prevents nothing, while every test of the predicate above it still passes.
//
// The incident (error_events 1226, 2026-09-12 14:14 UTC): every decode path failed on an iPhone, so
// processImage handed back the original File, which the device had never materialised and which
// therefore had size 0. presign answered "Missing or invalid fields" -- six words about a request,
// shown to a guest about her own photograph, and counted in /admin as a fault. The guard asks the
// door's question first and throws lib/file-read's failure instead, which PARKS the file and reads
// it again a moment later. That second read is the whole point: a cloud-backed photo is very often
// readable moments after it is not.
//
// Every mutation below leaves the uploader looking correct and takes that recovery away.
export default {
  file: 'src/components/UploadZone.tsx',
  test: 'tests/upload-zone-wiring.test.ts',
  mutations: [
    { name: 'the guard is gone, and a zero-byte declaration goes out exactly as it did on 09-12',
      from: "  const unusable = unusableUpload({ size: processed.blob.size, name: processed.name, mimeType: processed.mimeType })\n  if (unusable) throw readFailure(unusable)\n",
      to: '' },

    { name: 'the guard is asked and its answer thrown away',
      from: '  if (unusable) throw readFailure(unusable)', to: '  if (false) throw readFailure(unusable)' },

    // ── THE ONE THIS FILE EXISTS FOR ───────────────────────────────────────────────────────────
    // Deleting the guard is caught by "is it called at all". Only moving it proves the ORDERING
    // assertion can fire -- and moving it is the realistic mistake, because the code still reads
    // sensibly afterwards and every test of the predicate still passes.
    // Concatenated strings, not a template literal, and that is not a style choice. A template
    // spanning these lines puts `//` at the START of a line inside a string, and
    // tests/helpers/source-text.test.ts fails the whole repository the moment a new one of those
    // appears -- the guard that exists because a phantom template once copied 77 lines of comments
    // into what a grep could see. Quoted this way the bytes are identical and no line opens with a
    // comment marker. Double quotes because the text contains both an apostrophe and single quotes.
    { name: 'THE GUARD RUNS AFTER THE REQUEST IT EXISTS TO PREVENT, so the refusal happens anyway',
      from: "  const unusable = unusableUpload({ size: processed.blob.size, name: processed.name, mimeType: processed.mimeType })\n" +
            "  if (unusable) throw readFailure(unusable)\n" +
            "\n" +
            "  // ONE presign round trip covers both the image and its thumbnail (the old flow made two,\n" +
            "  // each paying the server's full rate-limit + album + tier lookup cost).\n" +
            "  const presignRes = await fetchWithRetry('/api/upload/presign', {",
      to:   "  // ONE presign round trip covers both the image and its thumbnail (the old flow made two,\n" +
            "  // each paying the server's full rate-limit + album + tier lookup cost).\n" +
            "  const presignRes = await fetchWithRetry('/api/upload/presign', {" },

    // ── the two copies rule 13 exists to stop ──────────────────────────────────────────────────
    { name: 'the failure wording is retyped here, so lib/file-read can reword and nothing parks',
      from: '  if (unusable) throw readFailure(unusable)',
      to:   "  if (unusable) throw new Error(`Could not be read from this device (${unusable})`)" },

    // ── the video door, which had the identical hole until the same review found it ───────────
    { name: 'THE VIDEO DOOR IS UNGUARDED AGAIN, so a picker that declares no type loses the video',
      from: "    const unusableVideo = unusableUpload({ size: file.size, name: file.name, mimeType: file.type })\n    if (unusableVideo) throw readFailure(unusableVideo)\n",
      to: '' },
    { name: 'the video guard is asked and its answer thrown away',
      from: '    if (unusableVideo) throw readFailure(unusableVideo)', to: '    if (false) throw readFailure(unusableVideo)' },

    { name: "the door's name rule is retyped at the call site instead of imported",
      from: '  if (unusable) throw readFailure(unusable)',
      to:   "  if (unusable || processed.name.length > 255) throw readFailure(unusable ?? 'name')" },
  { name: 'THE ENCODER ACCEPTS AN EMPTY IMAGE AGAIN (an empty Blob is truthy) -- the dm1ybi7j defect',
    from: "  if (blob && blob.size > 0) return blob", to: "  if (blob) return blob" },
  { name: 'ZERO BYTES ARE UPLOADED TO R2 and a row is written for them',
    from: "  if (processed.blob.size === 0) throw readFailure('the photo arrived empty from this device')\n", to: "" },
  { name: 'an empty photo is refused but not as a read failure, so it is never tried again',
    from: "if (processed.blob.size === 0) throw readFailure('the photo arrived empty from this device')",
    to: "if (processed.blob.size === 0) throw new Error('the photo arrived empty from this device')" },
  { name: 'an empty thumbnail is uploaded beside a good image',
    from: "(processed.thumbBlob && processed.thumbBlob.size > 0 && thumb)", to: "(processed.thumbBlob && thumb)" },
  ],
}
