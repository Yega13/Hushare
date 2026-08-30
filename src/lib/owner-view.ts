// SHOULD THE PAGE WAIT, OR SHOW THE GATE?
//
// An album's owner token lives in the URL *fragment* (#owner=…), which browsers never send to a
// server. So the server render of a password-protected or not-yet-revealed album is always the
// GUEST one — a password prompt, or "this album has not been revealed yet" — and the owner sees
// that until the client has read the fragment and checked the token. Their own album, telling them
// they cannot come in.
//
// Holding the loading skeleton over that window fixes it, and has already caused a worse problem
// than it solved: an earlier attempt held the page until the owner check resolved, with no escape.
// On production the check sometimes never resolved, so a gated album never opened at all — for
// guests too. Waiting is only correct when it is bounded.
//
// Extracted here because the rule is three booleans and an outage, and it was previously expressed
// inline in a 1,400-line component where nothing could check it.
export function shouldHoldForOwnerCheck(state: {
  /** The URL carried #owner=… on this load. */
  ownerHashPresent: boolean
  /** The owner check has finished — succeeded or failed, either way we know. */
  ownerTokenReady: boolean
  /** The check took too long and we stopped waiting for it. */
  ownerCheckTimedOut: boolean
  /** There is a gate to show: a password prompt or a reveal date. */
  hasGate: boolean
}): boolean {
  // Nothing to hide behind the skeleton: an open album renders normally either way.
  if (!state.hasGate) return false
  // Nobody claimed to be the owner, so the gate is simply the right answer.
  if (!state.ownerHashPresent) return false
  // We know the answer now; render it.
  if (state.ownerTokenReady) return false
  // We waited long enough. Showing the gate is correct for a guest and merely the old annoyance
  // for an owner — a page that never arrives is worse than both.
  if (state.ownerCheckTimedOut) return false
  return true
}
