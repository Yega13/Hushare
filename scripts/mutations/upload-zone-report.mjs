// Mutation set for the FAILURE REPORTING in src/components/UploadZone.tsx -- run with:
//   node scripts/mutations/run.mjs upload-zone-report
//
// The classifiers are proven in their own sets (upload-failure, upload-policy). This proves the
// lines in the component that decide whether they are asked, and of what. Every mutation below
// leaves uploading exactly as it was for the guest; what it breaks is the admin panel -- a refusal
// filed as a fault, or a fault filed as a warning nobody reads. Both are silent.
export default {
  file: 'src/components/UploadZone.tsx',
  test: 'tests/upload-zone-wiring.test.ts',
  mutations: [
  // ── reading a refusal ────────────────────────────────────────────────────────────────────────
  { name: 'PRESIGN THROWS THE WORDS ALONE AGAIN, so a full album refused there is filed as a fault',
    from: "  if (!presignRes.ok) throw await refusalFrom(presignRes, 'Presign failed')", to: "  if (!presignRes.ok) throw new Error('Presign failed')" },
  { name: 'the save throws the words alone, so the banner cannot tell a full album from a blip',
    from: "  if (!res.ok) throw await refusalFrom(res, 'Save failed')", to: "  if (!res.ok) throw new Error('Save failed')" },

  // ── the batch report ─────────────────────────────────────────────────────────────────────────
  { name: 'the code is dropped from the batch record',
    from: "              code: typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : undefined,", to: "              code: undefined," },
  { name: 'A FULL ALBUM REFUSED AT PRESIGN IS AN ERROR AGAIN',
    from: "        const full = sample.code === 'album_full'", to: "        const full = false" },
  { name: 'a full album is recognised but still filed at error level',
    from: "        const expected = full || isExpectedRefusal(sample.msg)", to: "        const expected = isExpectedRefusal(sample.msg)" },
  { name: 'a full album at presign is filed apart from the same refusal at save',
    from: "reportClientEvent(level, full ? 'album-full' : sample.kind,", to: "reportClientEvent(level, sample.kind," },
  { name: 'a parked failure is an error, so ordinary venue Wi-Fi cries wolf all evening',
    from: "        const level = expected || sample.parked ? 'warn' : 'error'", to: "        const level = expected ? 'warn' : 'error'" },
  { name: 'A CANCEL REACHES THE BATCH REPORT, because the upload path stops dropping it',
    from: "          if (!(e instanceof DOMException && e.name === 'AbortError')) {", to: "          if (true) {" },

  // ── the save path ────────────────────────────────────────────────────────────────────────────
  { name: 'a refusal on the save path is a fault again',
    from: "        const expectedSave = full || isExpectedRefusal(msg)", to: "        const expectedSave = full" },
  { name: 'a full album on the save path is a fault again',
    from: "        const expectedSave = full || isExpectedRefusal(msg)", to: "        const expectedSave = isExpectedRefusal(msg)" },
  { name: 'the save levels are swapped, so every real save failure is a warning nobody reads',
    from: "reportClientEvent(expectedSave ? 'warn' : 'error', full ? 'album-full' : 'save'", to: "reportClientEvent(expectedSave ? 'error' : 'warn', full ? 'album-full' : 'save'" },
  ],
}
