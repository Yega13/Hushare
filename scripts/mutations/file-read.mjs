// Mutation set for src/lib/file-read.ts -- run with:
//   node scripts/mutations/run.mjs file-read
//
// This module decides what a guest is told when their phone will not hand over a photo, and -- by
// the message text alone -- WHICH RECOVERY the uploader attempts. Those are two different things
// riding on one string, and that is what makes it worth mutating: every mutation below leaves the
// product looking correct while changing what happens to the file.
//
// isFileReadFailure matches on the exact prefix. Change the wording and the guest still reads a
// sensible sentence (friendlyUploadError falls through to its own regex), but the file is no longer
// parked, no longer read again a moment later, and is filed in /admin as a fault. A cloud-backed
// photo that would have arrived on the second attempt is simply lost, and nothing looks wrong.
//
// The module had tests and no mutation set until 2026-09-12, when a guard in the uploader started
// depending on its wording to classify a zero-byte file (error_events 1226).
export default {
  file: 'src/lib/file-read.ts',
  test: 'tests/file-read.test.ts tests/presign-fields.test.ts',
  mutations: [
    { name: 'THE WORDING DRIFTS AND NOTHING PARKS: the prefix everything matches on is shortened',
      from: "const READ_FAILURE = 'Could not be read from this device'",
      to:   "const READ_FAILURE = 'Could not be read'" },
    { name: 'a device failure is classified as something else entirely',
      from: 'return (e instanceof Error ? e.message : String(e)).startsWith(READ_FAILURE)',
      to:   "return (e instanceof Error ? e.message : String(e)).startsWith('Failed to fetch')" },
    { name: 'everything is a read failure, so a network error parks as an unreadable file',
      from: 'return (e instanceof Error ? e.message : String(e)).startsWith(READ_FAILURE)',
      to:   'return true' },
    { name: 'the detail is dropped, so /admin cannot tell an empty file from a dead reference',
      from: 'return new Error(`${READ_FAILURE} (${detail})`)', to: 'return new Error(READ_FAILURE)' },
    { name: "the original error's NAME is replaced by a constant, losing what the device actually said",
      from: '  return readFailure(name)', to: "  return readFailure('Error')" },
  ],
}
