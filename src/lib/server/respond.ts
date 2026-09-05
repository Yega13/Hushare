import { NextResponse } from 'next/server'
import { reportServerError } from '@/lib/report-server-error'

// EVERY JSON ANSWER THIS API GIVES, BUILT IN ONE PLACE.
//
// Four measurements taken 2026-09-04, each of which is a bug waiting rather than an untidiness:
//
//   * 98 separate `Cache-Control: no-store` header literals. All 98 agree today. Rule 13 says they
//     will not stay that way, and the first one to drift caches an album's photo list — or a
//     signed URL — on a shared CDN.
//   * 117 sites return a 5xx. 36 calls to reportServerError exist across all of src/app, and only
//     10 of the 64 route files that can 500 call it anywhere at all. So most 500s this product
//     serves are invisible in the admin panel — the one surface whose entire job is to answer "is
//     anything broken right now?".
//   * FIVE of those silent 500s are on the Polar payment path: album_lookup_failed, apply_failed,
//     refund_lookup_failed, refund_order_fetch_failed, revoke_failed. Those are precisely "a
//     payment could not be applied" and "a refund could not be revoked".
//   * 8 route files answer 429 with no Retry-After, though `rl.retryAfterSeconds` is in scope at
//     every one of them. The client is told to slow down and not told for how long, so it guesses.
//
// THE MECHANISM, not a convention: a 5xx cannot be constructed through this module without a
// `source`, and both functions that build one REPORT BEFORE THEY RETURN. There is no argument to
// forget and no branch that skips it. That is the difference between this and a house style.
//
// WHAT THIS DOES NOT OWN: redirects and streamed bodies. Those are correct as they are and a JSON
// serializer has no business touching them.

const NO_STORE = { 'Cache-Control': 'no-store' } as const

/**
 * A decision about the CALLER — they asked for something they may not have, or too often.
 *
 * Never a failure of ours; see serverError for that. The two are deliberately different types
 * because they are different events: one is the system working, the other is somebody waiting for
 * help. Collapsing them is how a 500 comes to look routine.
 *
 * Carried as a value rather than a Response so a lib module can make the decision and a route can
 * turn it into bytes, and so a test can assert the decision without parsing a body.
 */
export type Refusal =
  | { kind: 'bad_request'; message: string }
  | { kind: 'unauthorized'; message: string }
  | { kind: 'forbidden'; message: string }
  | { kind: 'not_found'; message: string }
  | { kind: 'conflict'; message: string }
  /**
   * retryAfterSeconds is REQUIRED here, and that is the entire fix for the eight routes that omit
   * the header. It cannot be built without the number, so the header cannot be forgotten.
   */
  | { kind: 'rate_limited'; message: string; retryAfterSeconds: number }
  /** A dependency is down and the caller SHOULD retry. Not our code failing, so not an incident. */
  | { kind: 'unavailable'; message: string; retryAfterSeconds?: number }

const STATUS: Record<Refusal['kind'], number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  unavailable: 503,
}

/** The single serializer. Every header and body-shape decision in this API is made here. */
function json(body: Record<string, unknown>, status: number, extra?: Record<string, string>): NextResponse {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...extra } })
}

export function ok<T extends Record<string, unknown>>(body: T): NextResponse {
  return json(body, 200)
}

export function toResponse(r: Refusal): NextResponse {
  const retryAfter =
    r.kind === 'rate_limited' ? r.retryAfterSeconds
      : r.kind === 'unavailable' ? r.retryAfterSeconds
        : undefined
  return json(
    { error: r.message, reason: r.kind },
    STATUS[r.kind],
    // Math.max(1, ceil): `Retry-After: 0` means "retry immediately", the exact opposite of the
    // intent, and it is what a sub-second window rounds down to. Erring upward costs a moment;
    // erring downward turns a rate limit into a retry storm from the room that triggered it.
    retryAfter === undefined ? undefined : { 'Retry-After': String(Math.max(1, Math.ceil(retryAfter))) },
  )
}

/** Shorthand for the overwhelmingly common `return refuse({ ... })`. */
export const refuse = (r: Refusal): NextResponse => toResponse(r)

/**
 * A rate-limit refusal built from the limiter's OWN answer.
 *
 * Takes the result object rather than a number, so Retry-After travels with the decision instead of
 * being re-supplied by hand. checkRateLimit already returns retryAfterSeconds on every rejection;
 * eight route files currently have it in scope and throw it away.
 */
export function refuseRateLimited(
  rl: { ok: false; retryAfterSeconds: number },
  message = 'Too many requests. Please slow down.',
): NextResponse {
  return toResponse({ kind: 'rate_limited', message, retryAfterSeconds: rl.retryAfterSeconds })
}

/**
 * Serialize an owner-access failure.
 *
 * `verifyAlbumOwnerAccess` / `verifyOwnerViaCookie` return a decision, and 31 route files each
 * turned it into bytes by hand as
 *   `NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })`
 * — which dropped the `reason` the library had already computed, and dropped Retry-After on the
 * two branches that are rate limits. So an endpoint could send the header on its own limiter's 429
 * and omit it on the owner-access 429 a few lines later.
 *
 * Typed structurally rather than importing AccessFail, so lib/server does not depend on the module
 * that depends on it.
 */
export function refuseAccess(fail: {
  status: number
  error: string
  reason: string
  retryAfterSeconds?: number
}): NextResponse {
  return json(
    { error: fail.error, reason: fail.reason },
    fail.status,
    fail.retryAfterSeconds === undefined
      ? undefined
      : { 'Retry-After': String(Math.max(1, Math.ceil(fail.retryAfterSeconds))) },
  )
}

/**
 * SOMETHING WENT WRONG ON OUR SIDE. Reports it, then answers 500.
 *
 * `source` is required and first for one reason: it is what makes forgetting to report impossible.
 * `detail` goes to the admin panel and never to the caller — an internal message in a customer's
 * browser is both unhelpful to them and useful to somebody else.
 */
export function serverError(
  source: string,
  detail: string | unknown,
  opts: { albumId?: string | null; account?: string | null; context?: Record<string, unknown> } = {},
): NextResponse {
  const message = detail instanceof Error ? `${detail.name}: ${detail.message}` : String(detail)
  reportServerError(source, message, opts)
  return json({ error: 'Something went wrong on our side. Please try again.' }, 500)
}

/**
 * A 500 THAT IS DELIBERATELY ASKING FOR A RETRY — not a failure being hidden.
 *
 * webhooks/polar answers 500 on purpose in several branches, and it is right to: Polar retries
 * until it gets a 200, so replying 200 to "paid, but I cannot tell which album" makes a real
 * payment vanish into a log line. Those branches are a protocol decision, not an incident.
 *
 * They still have to be REPORTED, which five of them were not. But they must keep their
 * machine-readable body: the operator reads `apply_failed` in Polar's delivery log to find out
 * which branch fired, and replacing that with a customer sentence would destroy the only signal
 * that says which one. So this is a separate function rather than a flag on serverError — the
 * intent is greppable, and the body is preserved by contract rather than by care.
 */
export function askCallerToRetry(
  source: string,
  reason: string,
  opts: { albumId?: string | null; account?: string | null; context?: Record<string, unknown> } = {},
): NextResponse {
  reportServerError(source, `retry requested: ${reason}`, opts)
  // The body is EXACTLY what these branches always returned: `{ error: <token> }`, nothing added.
  //
  // A `retry: true` field was here briefly and removed on review. This webhook has eleven
  // deliberate-retry 500s; only five route through this function, because the other six already
  // carry richer human-readable reports that a bare token would have replaced. A field meaning
  // "this 500 is on purpose", present on five of eleven on-purpose 500s, misleads the first
  // operator who reads it as a discriminator. The status code and the token already say everything
  // the delivery log is read for.
  return json({ error: reason }, 500)
}
