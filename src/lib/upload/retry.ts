import { createDeadline, monotonicNow, elapsedSince } from '@/lib/clock'
import { backoffDelay, isNetworkClass, createRelayPolicy, verdictForResponse, verdictForThrow, type RelayPolicy } from '@/lib/upload-policy'
import { xhrPut as realXhrPut, HttpError } from '@/lib/upload/http'
import { reachability as pageReachability, type Reachability } from '@/lib/upload/reachability'
import { reportClientEvent } from '@/lib/upload/report'

// THE RETRY LOOPS THAT DECIDE WHETHER A GUEST'S PHOTO SURVIVES A BAD CONNECTION.
//
// Three of them, moved out of UploadZone.tsx so they can be tested:
//
//   fetchWithRetry    the control plane -- presign, stream-init, and the SAVE that writes the row
//   putWithRetry      the bytes, direct to R2 on a presigned PUT
//   relayUploadImage  the bytes, through our own Worker when a network blocks R2's domain
//
// and putImageWithRelay, which sequences the last two. Each carries the incident that shaped it in
// its comments; none of that reasoning was reachable from a test while it sat in a component.
//
// Everything with side effects is a dependency -- fetch, the XHR PUT, the reachability probe, the
// relay-policy state, the telemetry sink, and the randomness in the backoff -- so a test scripts one
// outage and watches exactly what the loop does about it. Production uses the bound exports at the
// bottom and passes nothing.

/** Control-plane budget. Long enough to ride out a WiFi drop of a few seconds; short because every second holds one of 6 upload slots with an unexplained spinner. */
export const FETCH_DEADLINE_DEFAULT_MS = 30_000
/** Save is the exception, and gets six times the patience: by this point the bytes are already in R2, so giving up strands an uploaded photo with no database row. */
export const FETCH_DEADLINE_SAVE_MS = 180_000
/** A hung request should burn this long, not hang the file forever. */
export const FETCH_ATTEMPT_TIMEOUT_MS = 20_000
/**
 * A 5xx proves the server is reachable and struggling. Wall-clock patience is the right answer to
 * lost connectivity and the wrong answer to an overloaded origin -- without this cap the deadline
 * alone would send ~11 requests per call (26 on save), and with a whole venue behind one NAT that
 * is how a slow database becomes a tripped rate limit and a hard failure for every guest.
 */
export const MAX_SERVER_ERROR_ATTEMPTS = 4
/**
 * Extra time granted when connectivity is CONFIRMED back inside the window.
 *
 * The probe returning true is fresh positive evidence: the origin answered a HEAD moments ago.
 * Without this, that evidence was thrown away -- the loop exited reachable, fell into the ordinary
 * backoff, found the deadline passed and threw "Failed to fetch" having just proved the server was
 * up, WITHOUT ever re-issuing the request. The whole budget went on detecting the outage and the one
 * attempt it was saving up for was never made. That is the exact shape of the 2026-08-18 19:47
 * report: 5 images and 3 videos, every one dead at the control plane with no bytes moved.
 */
export const POST_RECOVERY_GRACE_MS = 8_000
/** Capped so a network that flaps up and down can extend the deadline twice, not indefinitely. */
export const MAX_RECOVERY_GRACES = 2
/**
 * The byte transfer gets MORE patience than the control plane, not less. Measured 2026-08-17: a
 * guest on Android lost 25 photos in 61 seconds, because this was a fixed 5 attempts (~7.5s of
 * tolerance) while the presign one layer up already had a deadline. Being generous here is close
 * to free: the bytes are in memory and the R2 key is fixed, so re-PUTting is idempotent -- the only
 * cost of waiting is time, while the cost of giving up is a photo the guest believed they handed over.
 */
export const PUT_DEADLINE_MS = 120_000

/**
 * A per-attempt AbortSignal that fires on the CALLER's abort or on a timeout, whichever comes first.
 *
 * AbortSignal.any() would be one line, but it lands in Chrome 116 / Safari 17.4 and a good share of
 * the phones at an event are older than that -- the Android 10 devices in our own error log among
 * them. TimeoutError, not a bare abort: isNetworkClass treats it as network-class, which is what
 * makes a hung request wait for the origin rather than burn an attempt. `cleanup()` must run in a
 * `finally`: each attempt otherwise leaves a live timer and an abort listener on a signal that
 * outlives the whole upload -- one per attempt, per file.
 */
export function withTimeoutSignal(caller: AbortSignal | undefined, timeoutMs: number) {
  const ctrl = new AbortController()
  // Whether OUR timer is what ended this attempt. Held here rather than read back off the error,
  // because the error is the browser's to word -- see fetchWithRetry. Only set when the timer is
  // what aborted: a caller's cancel that landed first stays a cancel.
  let timedOut = false
  const onCallerAbort = () => ctrl.abort(caller?.reason)
  const timer = setTimeout(() => {
    if (!ctrl.signal.aborted) timedOut = true
    ctrl.abort(new DOMException('Timed out', 'TimeoutError'))
  }, timeoutMs)
  if (caller) {
    if (caller.aborted) ctrl.abort(caller.reason)
    else caller.addEventListener('abort', onCallerAbort, { once: true })
  }
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer)
      caller?.removeEventListener('abort', onCallerAbort)
    },
  }
}

export type RelayTarget = { albumId: string; fileName: string; contentType: string; isThumb: boolean }
export type Stored = { key: string; publicUrl: string }

export type TransportDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  xhrPut: typeof realXhrPut
  reachability: Pick<Reachability, 'awaitRecovery'>
  relayPolicy: RelayPolicy
  report: typeof reportClientEvent
  /** 0..1, for the backoff jitter. Injected so a test can pin the waits. */
  random?: () => number
}

export function createUploadTransport(deps: TransportDeps) {
  const random = deps.random ?? Math.random
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  /**
   * The control plane: small JSON calls that decide whether a photo's bytes are allowed up and
   * whether they are recorded once they are. Bounded by a DEADLINE, not an attempt count, so the
   * budget is expressed in the unit that matters: how long a drop we can survive.
   *
   * `signal` is the caller's cancellation, taken as an explicit option: `{ ...init, signal }` used
   * to overwrite whatever init carried, silently, so the control-plane calls were simply not
   * cancellable and any future caller adding one would have had it discarded without a word.
   */
  async function fetchWithRetry(
    url: string,
    init: RequestInit,
    opts: { deadlineMs?: number; signal?: AbortSignal } = {},
  ): Promise<Response> {
    // MONOTONIC. On the wall clock a forward step larger than the budget made the first retry check
    // read the deadline as passed -- so a transient failure on the SAVE gave up at once, leaving
    // bytes in R2 with no row that references them (rule 22).
    const startedAt = monotonicNow()
    const deadline = createDeadline(opts.deadlineMs ?? FETCH_DEADLINE_DEFAULT_MS)
    let graces = 0
    // Set when the probe confirms the origin is back: the next attempt skips the backoff, because
    // waiting out a delay we already spent probing is exactly the wasted patience described above.
    let skipBackoff = false
    let lastErr: Error | null = null
    // Whether the last failure was the network's. Handed on with the final error as `unreachable`.
    let lastWasNetwork = false
    // The most recent 5xx, held so that running out of time still returns the server's own response
    // rather than throwing a generic error. Callers read the real message -- and the `code` that
    // tells an expected refusal from a genuine failure -- out of that body. At most one is retained.
    let lastServerRes: Response | null = null
    let attempt = 0
    let serverErrors = 0
    for (;;) {
      if (attempt > 0 && !skipBackoff) {
        // FULL jitter. Devices that lost the network together come back together, and at an event
        // that means thousands of clients firing inside the same narrow window -- recovery turning
        // straight back into an outage. Never sleep past the deadline just to fail on the far side.
        const wait = backoffDelay(attempt, random)
        if (deadline.wouldOverrun(wait)) break
        await sleep(wait)
      }
      skipBackoff = false
      attempt++
      const attemptSignal = withTimeoutSignal(opts.signal, FETCH_ATTEMPT_TIMEOUT_MS)
      try {
        const res = await deps.fetch(url, { ...init, signal: attemptSignal.signal })
        // Verdict and reasoning both live in lib/upload-policy, where they are tested.
        const verdict = verdictForResponse({
          status: res.status,
          serverErrorsSoFar: serverErrors,
          maxServerErrors: MAX_SERVER_ERROR_ATTEMPTS,
          withinDeadline: !deadline.expired(),
        })
        if (verdict === 'retry') {
          serverErrors++
          lastErr = new Error(`HTTP ${res.status}`)
          // Keep only the newest; draining the one it replaces frees its connection instead of
          // leaving it pinned until garbage collection.
          void lastServerRes?.body?.cancel()
          lastServerRes = res
          continue
        }
        void lastServerRes?.body?.cancel()
        return res
      } catch (e) {
        // A deliberate cancel is a final answer, not a transient failure. Without this the abort
        // surfaced as a plain DOMException, isNetworkClass said "not network", and the loop politely
        // backed off and retried the exact request the caller had just cancelled.
        const throwVerdict = verdictForThrow({
          aborted: opts.signal?.aborted === true,
          withinDeadline: !deadline.expired(),
        })
        if (throwVerdict === 'give-up' && opts.signal?.aborted) {
          // Drain a retained 5xx on the way out, same as every other exit from this loop.
          void lastServerRes?.body?.cancel()
          throw new DOMException('Upload aborted', 'AbortError')
        }
        // OUR TIMER, WHATEVER THE BROWSER CALLS IT. Chrome rejects the fetch with the reason we
        // aborted with -- the TimeoutError that isNetworkClass keys on. On 2026-09-11 an iPhone
        // (Safari 26.6) reported the same abort as a plain "Fetch is aborted": not network-class,
        // so the loop never waited for the connection, and the photo failed as "Fetch is aborted
        // (/api/upload/presign)" after 31 seconds -- the 30-second budget every Chrome "Timed out"
        // row shows. The caller's own cancel is handled above, so if our timer fired, this attempt
        // timed out, and it is named here by what happened.
        const failure = attemptSignal.timedOut() ? new DOMException('Timed out', 'TimeoutError') : e
        lastErr = failure instanceof Error ? failure : new Error(String(failure))
        lastWasNetwork = isNetworkClass(failure)
        if (throwVerdict === 'give-up') break
        // Nothing came back. Before spending another attempt (and another timeout) on a connection
        // that may simply be gone, ask whether we can reach ourselves at all -- and while we cannot,
        // wait on the page-wide probe rather than hammering the real endpoint. This is the part that
        // turns "the batch died" into "the batch paused".
        if (lastWasNetwork) {
          const remaining = deadline.remaining()
          if (remaining <= 0) break
          const recovered = await deps.reachability.awaitRecovery({ remainingMs: remaining, signal: opts.signal })
          // Confirmed up. Give the request a real chance to run now rather than expiring on the
          // doorstep -- and go straight there, without a backoff we effectively already served.
          //
          // Both effects are tied to the SAME cap. An origin that answers HEAD while this particular
          // request keeps failing would otherwise loop probe->retry->probe with no backoff for as
          // long as the window lasted, a tight spin against our own health endpoint. Once the graces
          // are spent, further recoveries fall back to ordinary jittered backoff.
          if (recovered && graces < MAX_RECOVERY_GRACES) {
            graces++
            deadline.extendTo(POST_RECOVERY_GRACE_MS)
            skipBackoff = true
          }
        }
      } finally {
        // Must be finally: the try block exits by `continue` on a retried 5xx and by `return` on
        // success, so anything after it would be skipped on exactly the paths that run most.
        attemptSignal.cleanup()
      }
    }
    // Out of time. A server that answered badly still told us something useful -- hand that back
    // rather than a generic network error.
    if (lastServerRes) return lastServerRes
    // Name the endpoint. "Failed to fetch" on its own cannot distinguish a presign from a
    // stream-init from a save -- all three are the same TypeError from this one helper -- so an
    // /admin report of it said the network broke, never where. The message stays PREFIXED by the
    // original text, so friendlyUploadError's substring matching and the network classifier behave
    // exactly as before. How long we waited is deliberately NOT in the message: /admin tallies
    // incidents by exact message string, and a per-file value would shatter one outage into a
    // column of one-count chips. It rides in the report context instead.
    const path = (() => { try { return new URL(url, 'http://origin.invalid').pathname } catch { return url } })()
    const err = new Error(`${lastErr?.message ?? 'Network request failed'} (${path})`)
    // `unreachable`: every attempt threw and the last was the network's -- the loop's own verdict,
    // handed on so the park decision (lib/upload/failure) reads what happened instead of guessing it
    // back out of the wording. "Timed out" matches no network phrase, so before this a photo whose
    // every attempt timed out was never parked for the reconnect.
    throw Object.assign(err, { waitedMs: elapsedSince(startedAt), unreachable: lastWasNetwork })
  }

  /**
   * One attempt loop shared by the direct PUT and the relay POST. The two differ only in what
   * one attempt IS and what the final error says; the policy -- abort is final, a 4xx is final, a
   * 5xx backs off, no answer at all waits for the origin -- is one policy, written once.
   */
  async function withPutPolicy<T>(attemptOnce: () => Promise<T>, signal: AbortSignal | undefined, deadlineMs: number, giveUpMessage: string): Promise<T> {
    // MONOTONIC, because a wall-clock deadline can expire before it is ever consulted: a phone whose
    // clock corrects FORWARD by more than the budget while a PUT is in flight read the deadline as
    // already passed on its first retry check, and the guest was told their photo failed having
    // spent none of its two minutes (rule 22).
    const deadline = createDeadline(deadlineMs)
    let lastErr: Error | null = null
    let attempt = 0
    for (;;) {
      if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError')
      if (attempt > 0) {
        const wait = backoffDelay(attempt, random)
        if (deadline.wouldOverrun(wait)) break
        await sleep(wait)
      }
      attempt++
      try {
        return await attemptOnce()
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e
        // The server answered and refused -- a signature or size problem no amount of waiting fixes.
        if (e instanceof HttpError && e.status < 500) throw e
        lastErr = e instanceof Error ? e : new Error(String(e))
        // NO `if (deadline.expired()) break` here, on purpose. wouldOverrun at the top of the loop
        // uses >=, so an expired deadline already breaks before any wait; the only thing that line
        // ever did was skip one awaitRecovery call with remainingMs 0, which returns false at once.
        // A review's mutation deleted it and every test stayed green -- the same equivalent-guard
        // shape as the probe loop's second deadline check (rule 16).
        // No response at all: wait for the connection rather than spending attempts on a dead one.
        if (!(e instanceof HttpError)) {
          await deps.reachability.awaitRecovery({ remainingMs: deadline.remaining(), signal })
        }
      }
    }
    throw lastErr ?? new Error(giveUpMessage)
  }

  /** The bytes, direct to R2 on the presigned PUT. Only a 4xx is deterministic; R2's transient 5xxs are exactly the errors a retry fixes. */
  function putWithRetry(
    url: string,
    body: Blob,
    contentType: string,
    onProgress: (pct: number) => void,
    signal?: AbortSignal,
    deadlineMs = PUT_DEADLINE_MS,
  ): Promise<void> {
    return withPutPolicy(async () => { await deps.xhrPut('PUT', url, body, contentType, onProgress, signal) }, signal, deadlineMs, 'Upload failed')
  }

  /**
   * The bytes, through hushare.space's own Worker (src/app/api/upload/image-relay/route.ts, which
   * writes to R2 via the native binding -- no outbound fetch, no SSRF surface) when a network blocks
   * R2's upload domain outright. Confirmed in production: the same blocked device also failed image
   * uploads. Deadline-driven because this is the LAST route the bytes have; the server derives the
   * same key on every attempt, so retrying is safe.
   */
  function relayUploadImage(
    target: RelayTarget,
    body: Blob,
    onProgress: (pct: number) => void,
    signal?: AbortSignal,
  ): Promise<Stored> {
    const url = `/api/upload/image-relay?albumId=${encodeURIComponent(target.albumId)}&fileName=${encodeURIComponent(target.fileName)}&contentType=${encodeURIComponent(target.contentType)}&isThumb=${target.isThumb ? '1' : '0'}`
    return withPutPolicy(async () => {
      const text = await deps.xhrPut('POST', url, body, target.contentType, onProgress, signal)
      return JSON.parse(text) as Stored
    }, signal, PUT_DEADLINE_MS, 'Relay upload failed')
  }

  /**
   * A presigned direct-to-R2 PUT with the relay fallback behind it.
   *
   * A network-class failure (plain Error -- no HTTP response ever arrived) switches to the relay for
   * a fresh attempt of the SAME bytes; an HttpError (R2 itself responded, even with a 5xx) is never
   * relayed -- putWithRetry already exhausted its own retries against that same signed URL.
   *
   * CRITICAL: the relay always derives its OWN server-side key, so this returns the key/publicUrl
   * that ACTUALLY got written. Callers must use the returned values, never the presign-time ones, or
   * the DB row would point at bytes that were never written while the relay's object sits orphaned.
   */
  async function putImageWithRelay(
    original: Stored,
    presignedUrl: string,
    relay: RelayTarget,
    body: Blob,
    onProgress: (pct: number) => void,
    signal?: AbortSignal,
  ): Promise<Stored> {
    let directFailed = false
    let lastDirectErr: unknown
    if (!deps.relayPolicy.shouldRelayFirst()) {
      try {
        await putWithRetry(presignedUrl, body, relay.contentType, onProgress, signal)
        return original
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e
        if (e instanceof HttpError) throw e
        directFailed = true
        lastDirectErr = e
      }
    }
    try {
      const result = await relayUploadImage(relay, body, onProgress, signal)
      // The relay working where the direct path did not is the ONLY evidence that this network
      // blocks R2 specifically. Recorded here, after the fact, rather than guessed at above. Getting
      // this wrong is expensive: the flag routes every remaining photo through our Worker, and on
      // 2026-08-17 that is what Cloudflare killed 328 requests for. Rules and expiry live in
      // lib/upload-policy with the incident that shaped them.
      if (directFailed && !deps.relayPolicy.isRelayBelieved()) {
        deps.relayPolicy.recordRelaySucceededAfterDirectFailure()
        deps.report('warn', 'upload:image-relay', 'Switched to relay after direct upload was network-blocked', relay.albumId, { fileName: relay.fileName })
      }
      return result
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      if (e instanceof HttpError) throw e
      // Both routes failed on a pure network-level basis. Thrown pre-formatted, since this message is
      // the final, user-facing text. The two underlying failures ride along as DATA, not in the
      // message: on 2026-08-23 it appeared 23 times for one photographer and said nothing about WHY
      // both routes died. The message stays fixed so /admin groups the incident into one row; the
      // causes travel in context, where they can be read without fragmenting the grouping.
      const why = new Error("Couldn't upload after trying multiple connection methods. Check that you're connected to the internet, then tap Retry.")
      const cause = (x: unknown) => (x instanceof Error ? `${x.name}: ${x.message}` : String(x)).slice(0, 80)
      throw Object.assign(why, { directCause: directFailed ? cause(lastDirectErr) : 'skipped', relayCause: cause(e) })
    }
  }

  return { fetchWithRetry, putWithRetry, relayUploadImage, putImageWithRelay }
}

// The page-wide transport. The relay policy is session-scoped state -- has THIS network proven it
// blocks R2's upload domain -- and deliberately SEPARATE from video's: the two direct-upload hosts
// are distinct, so a confirmed block on one says nothing about the other.
export const { fetchWithRetry, putWithRetry, relayUploadImage, putImageWithRelay } = createUploadTransport({
  fetch: (url, init) => fetch(url, init),
  xhrPut: realXhrPut,
  reachability: pageReachability,
  relayPolicy: createRelayPolicy(),
  report: reportClientEvent,
})
