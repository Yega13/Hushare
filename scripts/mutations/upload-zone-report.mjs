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
  { name: 'the code is dropped from the batch record, so a refusal is filed as a fault',
    from: "              code: refusal.code,", to: "              code: undefined," },
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

  // ── the wall, and the words on its button ────────────────────────────────────────────────────
  { name: 'A PRESIGN REFUSAL RAISES NO WALL, so a full album loses the account offer again',
    from: "          if (refusal.code === 'album_full') setPendingSaveReason", to: "          if (false) setPendingSaveReason" },
  { name: 'every refusal raises the full-album wall, including a network failure',
    from: "          if (refusal.code === 'album_full') setPendingSaveReason", to: "          if (true) setPendingSaveReason" },
  { name: 'the nudge is dropped, so a guest who could register is told to free up space instead',
    from: "wallFor(refusal.code, refusal.nudge)", to: "wallFor(refusal.code, undefined)" },
  { name: 'the wall decides its own words again, so a wall with nothing held claims uploads',
    from: "  const wall = pendingSaveReason ? wallCopy(pendingSaveReason, pendingSaveCount) : null",
    to: "  const wall = pendingSaveReason ? wallCopy(pendingSaveReason, 1) : null" },
  { name: 'the guest is shown our endpoint name when a save times out',
    from: "showAppToast(e instanceof Error ? friendlyUploadError(e) : t('common.errorGeneric'), 'error')",
    to: "showAppToast(e instanceof Error ? e.message : t('common.errorGeneric'), 'error')" },
  ],
}
