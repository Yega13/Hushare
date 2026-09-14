// WHETHER FACE FINDER MAY SKIP ASKING THE SERVER WHAT IS STILL UNSCANNED.
//
// Found 2026-09-14. FaceFinder skipped straight to the selfie step whenever every photo it had been
// handed already carried face data -- and what it is handed is the album page's LOADED window, 500
// photos on first load. On an album of thousands, the first 500 are exactly the ones the upload-time
// sweep scans first, while the rest wait for the every-minute cron. So a runner opening Face Finder in
// that gap skipped the check that would have scanned the rest, searched a collection holding a
// fraction of the album, and was told "No matches found -- Try a clearer selfie": a negative stated
// over thousands of photos nobody had looked at, with advice that blames them (rule 20). The server
// refuses a search only when NOTHING is scanned, so nothing downstream caught it.
//
// No album was exposed on the day it was found (Face Finder was on for two albums, both fully
// scanned); the next race album uploaded in bulk would have been.

/** The part of a photo row this decision reads. A photo row may omit face_ids; missing means unscanned. */
export type ScannablePhoto = { media_type: string; face_ids?: string[] | null }

/**
 * True only when the loaded photos ARE the whole album and every image among them is scanned.
 *
 * `albumTotal` is the album's own count as the photos API reports it (videos included, the same
 * rows `loaded` is drawn from). Anything short of the whole album means there may be unscanned
 * photos this client has never seen, so the answer errs toward asking the server -- which costs one
 * request before the selfie step, against telling someone they are in no photos (rule 19).
 */
export function canSkipFaceIndexing(loaded: readonly ScannablePhoto[], albumTotal: number): boolean {
  if (!Number.isFinite(albumTotal) || loaded.length < albumTotal) return false
  const images = loaded.filter((p) => p.media_type !== 'video')
  return images.length > 0 && images.every((p) => p.face_ids != null)
}
