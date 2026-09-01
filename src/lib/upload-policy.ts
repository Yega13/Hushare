import { VIDEO_TOO_LONG_PREFIX, VIDEO_ALBUM_FULL_PREFIX } from '@/lib/album-entitlements'
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
 * Longest edge for the ALBUM OWNER's own uploads.
 *
 * 3500px was chosen for guests: prints a full A4 page without visible loss, uploads three times
 * faster on saturated venue WiFi, and phone photos barely exceed it anyway. Then the first
 * professional photographer used us — VMF, 4,566 photos, every original ~6000px — and the same
 * cap silently halved the detail of a paying customer's entire event, discovered only when their
 * runners compared downloads against the originals. The owner is not a guest on venue WiFi: they
 * upload from a laptop, after the event, and the pictures are their work. 6000px covers a 24MP
 * full-frame camera edge-to-edge; a re-encoded file lands ~5MB, and a straight-from-camera JPEG
 * already at or under 6000px keeps its ORIGINAL bytes (metadata stripped), which can run to the
 * album's byte cap — that is the point, the owner keeps their pixels. Uncapped DIMENSIONS were
 * considered and rejected: a 61MP file is a 15MB+ lightbox download for every viewer, forever.
 */
export const OWNER_IMG_DIM = 6000

/**
 * Which longest-edge cap applies to this upload.
 *
 * A COURTESY, NOT A GATE — this runs in the uploader's own browser, so it cannot be enforcement
 * and does not need to be: someone who lies about being the owner uploads bigger files that the
 * server's per-file BYTE cap still bounds, gaining nothing. The asymmetry is deliberate and is
 * the whole feature: guests keep fast, reliable event-WiFi uploads; the owner keeps their pixels.
 */
export function maxImageDimFor(isOwner: boolean): number {
  return isOwner ? OWNER_IMG_DIM : MAX_IMG_DIM
}

/**
 * Rungs to come down, in order, when a photo is STILL over the album's cap at MAX_IMG_DIM.
 * The first rung IS MAX_IMG_DIM: a photo only reaches the later ones if 3500px did not fit.
 */
export const SHRINK_LADDER = [3500, 2560, 1920] as const

/**
 * The ladder for a given starting cap. For the guest cap this IS the ladder above; a larger cap
 * (the owner's) is prepended so rung 0 stays "the size we actually want" and the descent still
 * ends at sizes that fit any album's byte cap. The invariant callers rely on: ladder[0] === the
 * cap they asked for.
 */
export function shrinkLadderFor(maxDim: number): readonly number[] {
  // The rungs BELOW the cap only — a cap under 3500 must not climb back above itself, or the
  // first encode exceeds the very cap that was asked for. Unreachable with today's two caps;
  // load-bearing the day a third appears.
  return [maxDim, ...SHRINK_LADDER.filter((rung) => rung < maxDim)]
}

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
 * Does this upload failure describe a request whose Content-Length never arrived?
 *
 * WHY THIS IS ITS OWN QUESTION. A 4xx from the upload host is normally final — the request was
 * malformed and repeating it changes nothing, which is why the direct→relay fallback only ever
 * triggered on a pure network failure. This one 4xx is different, and it cost a wedding album 19
 * failed video uploads in six minutes:
 *
 *   Chrome on iOS 26 sent TUS chunks with no Content-Length. Cloudflare Stream answered
 *   400 / code 10032 "Invalid Content-Length", the classifier called it deterministic, and every
 *   attempt was abandoned. Our OWN image relay rejected the same device for the same missing
 *   header, which is the corroboration that matters: two independent servers, one phone, one
 *   absent header. Nothing we deployed can remove a header from a request that goes straight
 *   from the phone to Cloudflare.
 *
 * And it is precisely the failure the relay fixes: our Worker forwards the chunk as an
 * ArrayBuffer, so the runtime sets an exact Content-Length and strips whatever the browser did or
 * did not send. So this failure must switch to the relay rather than end the upload.
 *
 * Matched on the message rather than the numeric code alone, because the code lives in a JSON body
 * the tus client folds into its error string, and because our own relay phrases it differently.
 * Both wordings are checked; a false positive costs one relayed attempt, a false negative costs
 * somebody their video.
 */
export function isMissingContentLengthFailure(message: unknown): boolean {
  if (typeof message !== 'string') return false
  const m = message.toLowerCase()
  if (!m.includes('content-length')) return false
  return m.includes('missing') || m.includes('invalid') || m.includes('10032')
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
  // Imported, never retyped. These two are built from the same constants in album-entitlements,
  // so a reworded refusal cannot quietly stop being recognised here — which would put it in the
  // Errors tab and collapse the guest's video lane at the same time.
  VIDEO_TOO_LONG_PREFIX,
  VIDEO_ALBUM_FULL_PREFIX,
] as const

export function isExpectedRefusal(message: string): boolean {
  return EXPECTED_REFUSAL_PREFIXES.some((prefix) => message.startsWith(prefix))
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// WHICH ROUTE DO THE BYTES TAKE?
//
// A photo normally goes straight to R2 on a presigned URL. Some networks block R2's upload domain
// outright, so there is a fallback that streams the body through our own Worker instead.
//
// Choosing wrong is expensive rather than cosmetic. The fallback routes every remaining photo in
// the session through the Worker, and on 2026-08-17 that is what Cloudflare killed 328 requests for
// exceeding resources — 100% of that day's Worker errors, clustered in exactly the two hours that
// had relay switches. It also triples the server authorization work per photo. A single
// connectivity blip used to latch the flag permanently, so one bad moment made the whole rest of
// the upload take the expensive, failure-prone path.
//
// The rule that avoids that: a direct failure PROVES NOTHING, because plain loss of connectivity
// looks identical to a blocked domain. Only a relay that SUCCEEDED where the direct path failed is
// evidence. And even then the belief expires, because a phone moves between wifi and cellular in
// the middle of an event.
//
// This was module-level mutable state plus a `shouldUseRelayFirst()` that silently reset the flag
// as a side effect of being read — a question that changed the answer by asking it, untestable and
// surprising. Same rules, in something that can be handed a clock.

/** How long a proven block is believed before the direct path is tried again. */
export const RELAY_REPROBE_MS = 60_000

export type RelayPolicy = {
  /** Skip the direct attempt and go straight through the Worker? */
  shouldRelayFirst: () => boolean
  /**
   * Record that the relay succeeded where the direct path failed — the only evidence that counts.
   * A relay success WITHOUT a preceding direct failure proves nothing and is ignored.
   */
  recordRelaySucceededAfterDirectFailure: () => void
  /** For tests and diagnostics. */
  isRelayBelieved: () => boolean
}

export function createRelayPolicy(
  now: () => number = Date.now,
  reprobeMs: number = RELAY_REPROBE_MS,
): RelayPolicy {
  let believed = false
  let provenAt = 0

  return {
    shouldRelayFirst() {
      if (!believed) return false
      // Expired: stop believing and try the direct path again. Being wrong in THIS direction costs
      // one failed attempt; being wrong the other way costs the Worker budget for the whole session.
      if (now() - provenAt > reprobeMs) {
        believed = false
        return false
      }
      return true
    },
    recordRelaySucceededAfterDirectFailure() {
      believed = true
      provenAt = now()
    },
    isRelayBelieved: () => believed,
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// IS THIS FAILURE WORTH ANOTHER ATTEMPT?
//
// The difference between a guest's photo arriving late and never arriving. A 4xx is a deterministic
// verdict — the file is too large, the album is locked, the type is refused — and retrying it burns
// the deadline to arrive at the same answer. A 5xx or a dead connection may well succeed next time.
// And the deadline outranks everything: past it, the honest thing is to stop and say so.
export type RetryVerdict = 'retry' | 'accept' | 'give-up'

export function verdictForResponse(state: {
  status: number
  /** How many retryable responses (5xx or 429) this request has already absorbed. */
  serverErrorsSoFar: number
  maxServerErrors: number
  /** Is there still time on the overall deadline? */
  withinDeadline: boolean
}): RetryVerdict {
  // 429 IS RETRYABLE, everything else under 500 is not.
  //
  // A 429 means "slow down and try again", which is exactly what the backoff below does — it is a
  // transient signal, not a verdict like 400/403/413. Treating it as final cost real photos: at an
  // event the rate-limit ceiling cannot be reached by legitimate use (5,000 uploads against a
  // 12,000/hour limit), so a 429 there is always a blip in the Supabase-backed limiter, and a blip
  // was turning one photo into a manual retry the guest had to notice and perform. Retried with
  // backoff and bounded by the deadline, that same blip becomes a two-second delay.
  //
  // 400, 403, 413, 415 stay final: they are deterministic refusals and retrying only burns the
  // deadline to reach the same answer.
  const retryable = state.status === 429 || state.status >= 500
  if (!retryable) return 'accept'
  // A 5xx that we are out of budget for is still a RESPONSE — the caller returns it and the error
  // surfaces with its real status, rather than as a generic network failure.
  if (state.serverErrorsSoFar + 1 >= state.maxServerErrors) return 'accept'
  if (!state.withinDeadline) return 'accept'
  return 'retry'
}

/**
 * A thrown failure — no response arrived at all.
 *
 * A deliberate cancel is a FINAL answer, not a transient one. Without that check an abort surfaces
 * as a plain DOMException, `isNetworkClass` says "not network", and the loop politely backs off and
 * retries the exact request the caller just cancelled.
 */
export function verdictForThrow(state: {
  aborted: boolean
  withinDeadline: boolean
}): RetryVerdict {
  if (state.aborted) return 'give-up'
  if (!state.withinDeadline) return 'give-up'
  return 'retry'
}
