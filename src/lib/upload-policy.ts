// THE DECISIONS THE UPLOADER MAKES ABOUT SOMEONE ELSE'S PHOTO.
//
// UploadZone.tsx is 2,846 lines of canvas work, retries, workers and progress plumbing, and until
// now every judgement it makes lived inside that — reachable only by driving a browser. So the
// questions a customer actually cares about had no answer anyone could check:
//
//   Will my photo be re-encoded, or kept exactly as I shot it?
//   If my upload fails, will it be retried or quietly dropped?
//   When 300 phones retry at once on a saturated venue access point, how hard do they push?
//
// Every function here is pure. The I/O stays in the component; the judgement lives where a test can
// ask it directly. Nothing about the behaviour changed in moving it.

/** Longest edge we ever store. A4 at 300dpi is 3508px, so this prints full-page without loss. */
export const MAX_IMG_DIM = 3500

/**
 * Rungs to come down, in order, when a photo is STILL over the album's cap at MAX_IMG_DIM.
 * The first rung IS MAX_IMG_DIM: a photo only reaches the later ones if 3500px did not fit.
 */
export const SHRINK_LADDER = [3500, 2560, 1920] as const

/**
 * Is re-encoding this photo necessary at all?
 *
 * The answer used to be "always": the test was `file.size > 1.2 MB`, which every phone photo
 * exceeds, so every original was thrown away at the point of upload — including images already
 * smaller than the target. Testing the LONG EDGE means a photo at or under MAX_IMG_DIM keeps its
 * original bytes with only metadata stripped. Only genuinely larger images pay, or ones so large
 * the album would refuse them outright.
 */
export function needsReEncode(
  longestEdge: number,
  fileSizeBytes: number,
  capBytes: number,
  maxDim: number = MAX_IMG_DIM,
): boolean {
  return longestEdge > maxDim || fileSizeBytes > capBytes
}

/**
 * What format the re-encode writes.
 *
 * PNG and WebP are re-encoded IN THEIR OWN FORMAT, never to JPEG: a JPEG re-encode turned every
 * transparent area solid black, which on a logo or a cut-out is not a quality regression, it is a
 * ruined image. Everything else becomes JPEG.
 */
export function outputMimeFor(inputMime: string): string {
  // Lowercased first. Both call sites already normalise, so this changes nothing today — but a
  // caller handing over a raw `file.type` of "image/PNG" would otherwise get JPEG, and a
  // transparent PNG would come back with a solid black background. The cost of being wrong here is
  // a ruined image, so it does not depend on every future caller remembering.
  const mime = inputMime.toLowerCase()
  if (mime === 'image/png') return 'image/png'
  if (mime === 'image/webp') return 'image/webp'
  // NOTE: formats with alpha that are not listed above (AVIF) become JPEG and lose transparency.
  // Correct today only because the server refuses to store AVIF at all — if that ever changes,
  // this list must grow before it does.
  return 'image/jpeg'
}

/**
 * After encoding at `ladder[index]`, what should be tried next?
 *
 * Returns null when the result fits, or when the ladder is exhausted — the last rung is used
 * whatever its size, because a photo that is smaller than the owner wanted still beats an upload
 * that was refused.
 */
export function nextShrinkDim(
  index: number,
  producedBytes: number,
  capBytes: number,
  ladder: readonly number[] = SHRINK_LADDER,
): number | null {
  if (producedBytes <= capBytes) return null
  const next = index + 1
  return next < ladder.length ? ladder[next] : null
}

/**
 * How long to actually wait before retry `attempt` (1-based). The COMPLETE wait, not a base for a
 * caller to modify.
 *
 * Exponential with a ceiling, then two independent jitters — and the jitter is the whole point at
 * an event. 300 phones on one venue access point fail at the same instant and, without it, retry at
 * the same instant too, forever, in a thundering herd that keeps the network down.
 *
 * THE SECOND JITTER USED TO LIVE AT THE CALL SITES. All three multiplied this by
 * `(0.5 + Math.random() * 0.5)` themselves, so the real wait was never the number this returned —
 * a test of this function asserted a curve the product does not use, and the larger half of the
 * herd guard sat outside any test at all. Both halves are here now, so the tested function is the
 * shipped one. The arithmetic is unchanged: same two draws, same order.
 *
 * `random` is injectable so the curve can be asserted rather than sampled.
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(8000, 500 * 2 ** (attempt - 1)) + random() * 300
  return base * (0.5 + random() * 0.5)
}

/**
 * A failure where NO HTTP RESPONSE ARRIVED AT ALL — DNS, TCP, TLS, a reset, or our own timeout.
 *
 * An HTTP response is not network-class even when it is a 500: the server was reached and answered,
 * so waiting for the network to come back cannot help. This decides whether a failed upload is
 * parked and retried when the connection returns, or given up on — which is the difference between
 * a guest's photos arriving late and never arriving.
 */
export function isNetworkClass(e: unknown): boolean {
  if (e instanceof DOMException && e.name === 'TimeoutError') return true
  return e instanceof TypeError
}

/**
 * Refusals the product makes ON PURPOSE. They are not errors and must not be filed as ones.
 *
 * Prefix matching, deliberately: /admin groups by exact message, so a per-file detail in the text
 * scatters one problem across a column of single rows.
 */
export const EXPECTED_REFUSAL_PREFIXES = [
  'File too large',
  'Unsupported',
  'Enter the album password before adding photos',
  'This album has not been revealed yet',
] as const

export function isExpectedRefusal(message: string): boolean {
  return EXPECTED_REFUSAL_PREFIXES.some((prefix) => message.startsWith(prefix))
}
