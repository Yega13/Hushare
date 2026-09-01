// WHAT TO SAY BETWEEN TAKING THE MONEY AND THE PACKAGE ARRIVING.
//
// Polar redirects the buyer back to the album the moment they pay, and the webhook that actually
// applies the package lands separately — usually within seconds, occasionally later. In that gap
// the album looked exactly as it did before the payment: no acknowledgement anywhere, and the
// owner toolbar still offering the same two "Get" buttons. Someone who had just paid $99 and saw
// nothing had one obvious thing to try, which was to pay again.
//
// So the gap gets a state of its own. Three of them, because they are three different truths and
// rule 20 says they must not look alike:
//
//   applying — money taken, package not visible yet. Buying is BLOCKED while this shows.
//   applied  — the package is on the album. Say so, then get out of the way.
//   slow     — it has been long enough that something may be wrong. Never says "it failed"
//              (it usually has not) and never says "wait" forever either: it names the support
//              address, because at that point a person is the fastest remaining path.

/** How often to re-ask the server whether the package has landed. */
export const THANKS_POLL_MS = 3000

/** After this long without the package appearing, stop reassuring and offer a human. */
export const THANKS_SLOW_AFTER_MS = 45_000

export type ThanksState = 'applying' | 'applied' | 'slow'

/**
 * The state to show, or null when this page load is not a return from checkout.
 *
 * `elapsedMs` is a duration measured from a single origin (performance.now), never the difference
 * of two wall-clock readings — a phone taking an NTP correction mid-payment must not jump this
 * straight to 'slow' or strand it at 'applying' forever (rule 22). It is clamped for the same
 * reason: a negative or absurd reading is treated as "just started", which errs toward keeping the
 * reassuring message rather than raising a false alarm.
 */
export function packageThanksState(
  requested: boolean,
  packagedLive: boolean,
  elapsedMs: number,
): ThanksState | null {
  if (!requested) return null
  // Applied wins over everything, including a slow clock: the money question is answered.
  if (packagedLive) return 'applied'
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  return elapsed >= THANKS_SLOW_AFTER_MS ? 'slow' : 'applying'
}

/**
 * Whether the buy buttons may be shown at all.
 *
 * A payment in flight hides them — that is the whole point of this module. Once it has landed
 * ('applied') the section shows the package's status instead, and a stalled one ('slow') keeps
 * them hidden too: if the first payment did go through, the second would be a duplicate charge,
 * and a refund costs more trust than the wait does.
 */
export function packagePurchaseAllowed(state: ThanksState | null): boolean {
  return state === null
}
