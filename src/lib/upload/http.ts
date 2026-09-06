import { createStallWatch } from '@/lib/clock'
import { IMMUTABLE_CACHE_CONTROL } from '@/lib/media'

// THE UPLOAD PATH'S HTTP PRIMITIVES, moved out of UploadZone.tsx verbatim so they can be tested.
//
// xhrPut is the single function that carries a guest's photo bytes off their phone -- direct to R2
// on the presigned PUT, or to our relay as a POST when the network blocks R2. Every retry loop in the
// upload path sits on top of it. It lived at module scope in a 2,900-line component with no `export`,
// which is the only reason it had no test (AGENTS.md rule 14).

/** How long an in-flight PUT may go with zero progress before the watchdog aborts it for a retry. */
export const STALL_TIMEOUT_MS = 20_000

/**
 * A server answered, and the answer was a refusal. Distinct from a network failure on purpose: the
 * retry loops treat a 4xx as final (a signature or size problem no amount of waiting fixes) and a
 * network-class error as "wait for the connection", so the two must not share a type.
 */
export class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

/**
 * Parse a JSON response body defensively.
 *
 * A flaky mobile network can deliver a 200 with a truncated or empty body -- res.json() then throws
 * the cryptic "Unexpected end of JSON input". Reading text first turns that into a clean, retryable
 * error the guest actually understands.
 */
export async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text()
  if (!text) throw new Error('Empty response from the server — please retry')
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('Unreadable response from the server — please retry')
  }
}

/**
 * The subset of XMLHttpRequest this module drives -- so a test can hand in a fake.
 *
 * `onprogress` takes a real `ProgressEvent`, not a three-field object, because the real
 * XMLHttpRequest must be assignable to this type at the default `makeXhr` -- and a handler slot is
 * checked contravariantly on its parameter, so declaring a narrower event here made the REAL object
 * fail to fit. The fake in tests/http.test.ts builds a three-field stand-in and casts it; that is the
 * honest place for the cast, since the fake is the thing pretending.
 */
export type XhrLike = {
  open(method: string, url: string): void
  setRequestHeader(name: string, value: string): void
  send(body: Blob): void
  abort(): void
  readonly status: number
  readonly responseText: string
  upload: { onprogress: ((e: ProgressEvent) => void) | null; onload: ((e: ProgressEvent) => void) | null }
  onload: ((e: ProgressEvent) => void) | null
  onerror: ((e: ProgressEvent) => void) | null
}

/**
 * Upload a body with progress, a stall watchdog, and cooperative cancellation.
 *
 * method: 'PUT' for the direct-to-R2 presigned PUT; 'POST' for the same-origin image-relay fallback
 * (src/app/api/upload/image-relay/route.ts). Resolves to the response body text -- R2's PUT response
 * is empty (callers ignore it), the relay's POST response is JSON ({ key, publicUrl }).
 *
 * `makeXhr` is injectable for tests only; production callers never pass it.
 */
export async function xhrPut(
  method: 'PUT' | 'POST',
  url: string,
  body: Blob,
  contentType: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
  makeXhr: () => XhrLike = () => new XMLHttpRequest(),
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Upload aborted', 'AbortError')); return }
    const xhr = makeXhr()

    // NO `settled` FLAG, and that is deliberate. The original carried `let settled = false` with an
    // `if (settled) return` in finish(). A mutation run deleted it and every test stayed green -- not
    // because the tests were weak, but because it cannot be reached: finish() disarms the stall watch
    // and removes the abort listener, and an XMLHttpRequest fires exactly one terminal event, so
    // there is no second caller left. A guard that cannot execute reads as the thing holding the
    // invariant while doing nothing, and the next person edits around it trusting it. The invariant
    // is what finish() disarms, stated in the two lines below.

    // Stall watchdog: mobile connections sometimes open the socket then stop sending bytes. Abort
    // after STALL_TIMEOUT_MS of zero progress so the retry loop can reconnect quickly. Reset on every
    // upload-progress event and once the body is fully sent (see below).
    //
    // On the monotonic clock: as `Date.now() - lastActivity` a backward clock step made the
    // difference negative, the comparison never became true, and the watchdog silently stopped
    // existing -- the guest watched a spinner until they gave up (rule 22). The timer lives inside
    // createStallWatch with the decision it enforces (rule 15).
    const stall = createStallWatch({
      stallMs: STALL_TIMEOUT_MS,
      checkEveryMs: 4000,
      onStall: () => {
        finish(() => { try { xhr.abort() } catch { /* ignore */ }; reject(new Error('Upload stalled — retrying')) })
      },
    })

    const finish = (fn: () => void) => {
      stall.stop()
      signal?.removeEventListener('abort', onAbort)
      fn()
    }

    const onAbort = () => finish(() => { try { xhr.abort() } catch { /* ignore */ }; reject(new DOMException('Upload aborted', 'AbortError')) })
    signal?.addEventListener('abort', onAbort, { once: true })
    xhr.open(method, url)
    xhr.setRequestHeader('Content-Type', contentType)
    // Cache-Control is bound into R2's presigned-PUT signature, so it must be exactly the value the
    // server signed -- one definition in lib/media, imported by both sides. The relay route doesn't
    // read this header at all.
    if (method === 'PUT') xhr.setRequestHeader('Cache-Control', IMMUTABLE_CACHE_CONTROL)
    xhr.upload.onprogress = (e) => {
      stall.poke()
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    // Body fully sent -- restart the stall clock so a slow server response during the
    // request->response gap (when upload progress no longer fires) isn't mistaken for a stall.
    xhr.upload.onload = () => { stall.poke() }
    xhr.onload = () => finish(() => {
      if (xhr.status >= 200 && xhr.status < 300) { resolve(xhr.responseText); return }
      // The relay returns a JSON {error} body with the real reason (rate limited, too large, etc).
      // R2's own PUT error body is XML, which fails to parse here and falls back to the generic
      // message below.
      let message = method === 'PUT' ? `R2 PUT ${xhr.status}` : `Relay upload failed (${xhr.status})`
      try {
        const parsed = JSON.parse(xhr.responseText) as { error?: string }
        if (parsed?.error) message = parsed.error
      } catch { /* non-JSON error body -- keep the generic message */ }
      reject(new HttpError(xhr.status, message))
    })
    xhr.onerror = () => finish(() => reject(new Error('Network error during upload')))
    xhr.send(body)
  })
}
