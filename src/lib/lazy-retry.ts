// RETRY A LAZY-LOADED CHUNK BEFORE GIVING UP ON IT.
//
// Parts of the album page are loaded on demand (the uploader, the owner toolbar, Face Finder,
// the designer). Each is a network request made at the moment somebody taps a button — and a
// dynamic import does not retry. One dropped packet on venue WiFi or a phone switching cells and
// the component never appears at all: no error the guest can act on, just a button that did
// nothing, plus an unhandled rejection filed as a red error in the admin panel.
//
// Observed exactly that way: "TypeError: Load failed" from a real visitor on the current build,
// whose chunks were all present and correct. Nothing was broken except their connection for a
// moment, and the product had no answer for it.
//
// Retries are for the TRANSIENT case only. A chunk that no longer exists — an open tab across a
// deploy — fails the same way every time, so the attempts finish quickly and the error that
// remains is the real one. Backoff is short because a person is waiting behind it.

const ATTEMPTS = 3
const BASE_DELAY_MS = 250

/** Delay before attempt `n` (1-based), jittered.
 *  Jittered because a deploy makes every open tab fail at the same moment, and a fixed backoff
 *  would have all of them retry in the same instant — the thundering herd this codebase spreads
 *  everywhere else it retries. */
export function lazyRetryDelay(attempt: number, rand: () => number = Math.random): number {
  const base = BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1))
  return Math.round(base * (0.5 + rand() * 0.5))
}

/**
 * Wrap a dynamic import so a transient network failure is retried instead of becoming a dead
 * button. Rejects with the LAST error once the attempts are spent, so a genuinely missing chunk
 * still surfaces rather than being swallowed.
 */
export function retryImport<T>(load: () => Promise<T>, attempts = ATTEMPTS): () => Promise<T> {
  return async () => {
    let lastError: unknown
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await load()
      } catch (err) {
        lastError = err
        if (attempt === attempts) break
        await new Promise((resolve) => setTimeout(resolve, lazyRetryDelay(attempt)))
      }
    }
    throw lastError
  }
}
