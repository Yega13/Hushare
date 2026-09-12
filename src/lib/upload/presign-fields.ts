// WHAT AN UPLOAD DOOR REQUIRES OF A FILE BEFORE IT WILL SIGN FOR IT.
//
// These four rules are written out THREE TIMES in this codebase -- /api/upload/presign,
// /api/upload/stream and (minus the size rule) /api/upload/image-relay -- and each copy answers with
// the same six words: "Missing or invalid fields". Nothing matched the copies to each other, and
// nothing on the client knew what they were, so the client's only way to discover it had broken one
// was to upload a declaration and read a 400 back.
//
// On 2026-09-12 at 14:14 UTC that is exactly what happened, for the first time ever recorded: an
// iPhone on album 77fe2598 filed "Missing or invalid fields" against two files. Every decode path
// had already failed on that device (createImageBitmap threw InvalidStateError seconds earlier), so
// processImage fell through to its last resort -- hand over the original File untouched -- and six
// of that guest's photos saved with no dimensions and no thumbnail while two produced nothing at
// all. A file whose bytes the device never materialised has size 0, and `fileSize <= 0` is one of
// the rules below.
//
// The guest was told "Missing or invalid fields" about their own photograph. The product already
// owns the right sentence for this -- lib/file-read's "Could not be read from this device", which
// parks the file and tries again, because a cloud-backed photo is very often readable a moment
// later. It could not be used, because nothing on the client asked the question before presigning.
//
// So the rules live here, once, as predicates a test can reach (rule 14) and every side imports
// (rule 13): /api/upload/presign, /api/upload/stream, /api/upload/image-relay and the uploader all
// call these and none of them retypes the conditions. tests/presign-fields.test.ts reads the three
// route sources and fails if one grows its own copy again -- because the first version of this
// comment claimed the deduplication before it had happened, which a review caught.

/** The longest a file name may be. The doors all clamp at the same number; now they clamp at THIS one. */
export const MAX_FILE_NAME_LEN = 255

/** Present, and short enough to store. */
export function fileNameValid(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= MAX_FILE_NAME_LEN
}

/** Present. The door decides separately whether the TYPE is one we accept (lib/media). */
export function contentTypeValid(contentType: unknown): contentType is string {
  return typeof contentType === 'string' && contentType.length > 0
}

/**
 * A real, positive, whole number of bytes.
 *
 * Zero is the one that matters and the one that is easy to miss: it is not a malformed request, it
 * is a file the device would not hand over. Number.isInteger already excludes NaN and both
 * infinities, but the checks are spelled out because the doors spell them out, and this module
 * exists so that the two can be compared at a glance.
 */
export function fileSizeValid(fileSize: unknown): fileSize is number {
  return typeof fileSize === 'number' && Number.isFinite(fileSize) && Number.isInteger(fileSize) && fileSize > 0
}

/** Why this cannot be presigned, or null if it can. */
export type UnusableReason = 'empty' | 'name' | 'type'

/**
 * THE DOOR'S OWN QUESTION, asked by the client before any bytes move.
 *
 * Named for the decision, not for one caller: it guards a processed image AND a raw video File,
 * which are the two things the uploader sends.
 *
 * Not to save a round trip -- to answer it in words that mean something. Every one of these
 * conditions is a fault of the FILE, not of the request, and the uploader has a recovery for
 * exactly that (park it, read it again in a moment). Sending the declaration anyway trades a
 * sentence the guest can act on for one they cannot.
 *
 * Order matters only for the message: an empty blob is the case that actually happens, so it is
 * named first rather than being reported as whichever rule the loop reached.
 */
export function unusableUpload(
  candidate: { size: number; name: unknown; mimeType: unknown },
): UnusableReason | null {
  if (!fileSizeValid(candidate.size)) return 'empty'
  if (!fileNameValid(candidate.name)) return 'name'
  if (!contentTypeValid(candidate.mimeType)) return 'type'
  return null
}
