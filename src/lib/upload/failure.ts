import { HttpError, readWithin } from '@/lib/upload/http'
import { isFileReadFailure } from '@/lib/file-read'

// WHAT A FAILED UPLOAD MEANS: does the tile park and wait for the network, or fail with a manual
// Retry, and what sentence does the guest read. This sat in UploadZone as five functions and a
// class; tests/file-read.test.ts had to COPY two of its regexes to test them (rule 17), and a
// drift between the copy and the component would have stayed green.

// Everything needed to RESUME a failed video upload instead of restarting it: the tus uploadUrl
// lets tus-js-client HEAD the server for the last confirmed offset and continue from there (a
// 100 MB video that died at 80% resumes at 80%). Poster/duration/dimensions are carried along so
// none of that work is redone either.
export type VideoResume = {
  uploadUrl: string
  streamUid: string
  iframeUrl: string
  thumbnailUrl: string | null
  posterUrl: string | null
  durationSeconds: number
  videoWidth: number | null
  videoHeight: number | null
  /** Set once this file has proven the direct-to-Cloudflare path is network-blocked, so a manual
   *  Retry resumes via the relay directly instead of re-attempting the doomed direct path first. */
  viaRelay?: boolean
}

/**
 * Thrown when a video's TUS phase fails after the Stream session was already created: carries the
 * resume state so Retry continues instead of starting over, plus the real HTTP status (or null for
 * a pure network drop) so the message can name the actual cause.
 */
export class VideoUploadError extends Error {
  constructor(
    message: string,
    public readonly resume: VideoResume | null,
    public readonly httpStatus: number | null,
  ) {
    super(message)
  }
}

/** The text of a thrown upload error, for the classifiers. */
export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * tus-js-client's DetailedError hides the real cause inside a stringified blob. The HTTP status of
 * the failing request: a number means the server rejected it (4xx = the video is bad, too long,
 * too large; 5xx = transient); null means no response arrived at all (a genuine network drop, the
 * "response code: n/a" case).
 */
export function tusHttpStatus(e: unknown): number | null {
  const resp = (e as { originalResponse?: { getStatus?: () => number } | null })?.originalResponse
  const status = resp?.getStatus?.() ?? 0
  return status > 0 ? status : null
}

/**
 * A TUS error with a 4xx response is a final server verdict (expired or invalid upload URL, bad
 * request): retrying the same URL cannot succeed. Everything else (network drop, stall, 5xx) is
 * transient. Used for tus-js-client's own onShouldRetry, and for deciding whether a RESUMED
 * upload's session is stale and needs a fresh Stream init.
 */
export function isDeterministicTusError(e: unknown): boolean {
  const status = tusHttpStatus(e)
  return status !== null && status >= 400 && status < 500
}

/**
 * The text shapes that mean the network went away. Exported so the test imports it, not a copy.
 * "load failed" is Safari's and carries a word boundary: "Upload failed" and "Video upload failed"
 * -- this product's own generic messages -- contain it, and without the boundary a generic
 * failure was classified as the network and PARKED, waiting for a connection that was fine.
 */
export const NETWORK_FAILURE_TEXT = /failed to fetch|\bload failed|network request failed|networkerror|network error during upload|couldn't upload after trying multiple connection methods|couldn't reach the server|upload stalled/i

/**
 * Did this file fail because the NETWORK went away, rather than because anything about the file or
 * the server was wrong? Only those are worth parking and resuming on our own: the connection
 * coming back is a real, observable event that changes the answer, whereas a 413 or an unsupported
 * codec will fail identically forever and must stay a plain error with a manual Retry.
 *
 * Deliberately an allow-list: an unrecognised failure stays an error. Parking something that can
 * never succeed would leave a tile claiming it is waiting for a network that was never the problem.
 */
export function isRecoverableNetworkFailure(e: unknown): boolean {
  // A deliberate cancel, and a server that answered (even badly), are both out of scope.
  if (e instanceof DOMException && e.name === 'AbortError') return false
  if (e instanceof HttpError) return false
  // The control plane's own verdict (lib/upload/retry): no attempt was answered and the last one
  // failed at the network. Read as a fact rather than from the text, because a timeout's text is
  // "Timed out (/api/...)", which matches none of the network wording below.
  if ((e as { unreachable?: unknown } | null)?.unreachable === true) return true
  // Videos: httpStatus null means no HTTP response ever arrived on ANY attempt, direct or relayed.
  if (e instanceof VideoUploadError) return e.httpStatus === null
  const raw = errText(e)
  // Refusals the product made on purpose are never network failures, whatever else they contain.
  if (/^(File too large|Unsupported)/i.test(raw)) return false
  // A file the DEVICE would not hand over earns the same treatment as a dropped connection -- park
  // it, try once more -- for a different reason: a freshly captured or cloud-backed photo is very
  // often readable a moment after it is not, and that second attempt is what saves it.
  if (isFileReadFailure(e)) return true
  return NETWORK_FAILURE_TEXT.test(raw)
}

/** The text shapes that mean the DEVICE would not hand the file over. Exported for the same reason. */
export const FILE_READ_FAILURE_TEXT = /could not be read|NotReadableError|NotFoundError|permission problems|object can not be found|did not match the expected pattern|InvalidStateError/i

export const READ_FAILURE_MESSAGE = 'Could not read this file from your device. Please remove it and add it again.'
export const UNREACHABLE_MESSAGE = "Couldn't reach the server after several tries. Switch networks (e.g. mobile data), or turn off any VPN or ad-blocker, then tap Retry."
export const VIDEO_UNREACHABLE_MESSAGE = "Couldn't upload after trying multiple connection methods. Check that you're connected to the internet, then tap Retry."

/**
 * tus failures stringify their entire request and response internals: a wall of text that
 * overflows a phone screen and says nothing. Known failure shapes become short, actionable
 * sentences that still NAME the real cause (the HTTP status), so a failure screenshot is
 * diagnostic instead of a generic "connection dropped".
 */
export function friendlyUploadError(e: unknown): string {
  const raw = e instanceof Error ? e.message : 'Upload failed'
  // A stale or unreadable picked-file reference: Android says NotReadableError, iOS/WebKit says
  // NotFoundError or a decode SyntaxError. All map to the same action: remove it and add it again.
  if (FILE_READ_FAILURE_TEXT.test(raw)) return READ_FAILURE_MESSAGE
  // The presign or save request never reached the server, and this shows only AFTER the retry
  // loop is exhausted, so the network itself is blocking us: venue Wi-Fi, a VPN, an ad-blocker.
  if (/failed to fetch|\bload failed|network request failed|networkerror/i.test(raw)) return UNREACHABLE_MESSAGE
  // The same situation stated structurally: every attempt timed out or dropped. It used to reach the
  // guest as the raw "Timed out (/api/upload/presign)".
  if ((e as { unreachable?: unknown } | null)?.unreachable === true) return UNREACHABLE_MESSAGE
  // Video (tus): a real server rejection versus a pure network failure.
  const status = e instanceof VideoUploadError ? e.httpStatus : tusHttpStatus(e)
  if (status !== null) {
    if (status === 413) return 'This video is too large to upload.'
    if (status >= 400 && status < 500) return `This video was rejected by the server (HTTP ${status}) — it may be too long or an unsupported format.`
    return `Video server error (HTTP ${status}). Tap Retry — it continues where it left off.`
  }
  // No HTTP response on ANY attempt: the direct path AND the relay both failed, true connectivity loss.
  if (e instanceof VideoUploadError || /^tus:|stalled/i.test(raw)) return VIDEO_UNREACHABLE_MESSAGE
  return raw.length > 160 ? `${raw.slice(0, 157)}…` : raw
}

/**
 * THE SERVER'S REFUSAL, AS AN ERROR THAT STILL KNOWS WHAT IT WAS.
 *
 * The save path carried the server's `code` and `nudge` with the message, so a full album could be
 * told from a failure without matching English. The presign path threw the message alone -- and
 * presign now refuses a full album too (lib/server/image-upload-authorization), so without the code
 * that refusal would be filed as an upload fault. One reader for both, so they cannot disagree
 * about what a refusal carries.
 */
/**
 * The `code` and `nudge` a refusal carries, read off an error that is `unknown` by then.
 *
 * refusalFrom attaches both, but a failure reaching the uploader's catch has lost its type, and the
 * same two narrowings were written twice there -- once to raise the banner, once to file the admin
 * report. Two copies of one narrowing is how one of them ends up narrower than the other: the report
 * checked `typeof === 'string'` while the banner would have taken anything truthy.
 */
export function refusalFields(e: unknown): { code?: string; nudge?: string } {
  const r = e as { code?: unknown; nudge?: unknown } | null
  return {
    code: typeof r?.code === 'string' ? r.code : undefined,
    nudge: typeof r?.nudge === 'string' ? r.nudge : undefined,
  }
}

export async function refusalFrom(res: Response, fallback: string): Promise<Error & { code?: string; nudge?: string }> {
  // Bounded, and the two failures are kept apart: a body that is not JSON gives an empty object and
  // the caller still gets the step and the status, while a body that never ARRIVES rejects with a
  // TimeoutError and parks the file. Inventing a refusal out of a stalled connection would tell a
  // guest their photo was declined when nothing was ever read.
  const body = await readWithin(res.json().catch(() => ({}))) as { error?: unknown; code?: unknown; nudge?: unknown }
  const message = typeof body.error === 'string' && body.error ? body.error : `${fallback} (${res.status})`
  return Object.assign(new Error(message), {
    code: typeof body.code === 'string' ? body.code : undefined,
    nudge: typeof body.nudge === 'string' ? body.nudge : undefined,
  })
}
