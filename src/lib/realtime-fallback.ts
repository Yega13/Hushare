// How an album page stays fresh when realtime cannot connect at all.
//
// The reconnect loop in AlbumPageClient handles DROPS: backoff, jitter, resubscribe,
// refetch on SUBSCRIBED. What it never handled is REFUSAL — a venue network that blocks
// websockets outright, or the realtime service at its concurrent-connection cap on a
// heavy day. Those clients retried forever, never reached SUBSCRIBED, and therefore
// never refetched: the page silently froze at whatever it first loaded, which for a
// guest during a live event means "the photographer stopped" (rule 20's cousin — a
// negative the page cannot back up).
//
// While the channel is down, the page polls instead. Slow on purpose: this is a floor
// for correctness, not a substitute for realtime, and hundreds of blocked clients must
// not become a synchronised refetch herd.

export const FALLBACK_POLL_BASE_MS = 60_000

/** Delay until the next fallback poll: 45-75s, jittered by DEFAULT.
 *  The jitter is the point — every client behind the same websocket-blocking network
 *  fails together, so a fixed interval would poll together. Same 0.75+rand()*0.5 smear
 *  reasoning as the reconnect backoff and the upload retry path. */
export function fallbackPollDelay(rand: () => number = Math.random): number {
  return Math.round(FALLBACK_POLL_BASE_MS * (0.75 + rand() * 0.5))
}
