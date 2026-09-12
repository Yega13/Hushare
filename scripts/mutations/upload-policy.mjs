// Mutation set for src/lib/upload-policy.ts -- run with: node scripts/mutations/run.mjs upload-policy
//
// Everything the uploader decides about a file before and after the bytes move: whether to
// re-encode it, what format to write, how far down the shrink ladder to go, whether a failure is
// worth another attempt, and which route the next photo takes. Each mutation below is a real
// incident shape -- a ruined transparent image, a lost video, a thundering herd, a Worker budget
// spent on a network that was never blocked.
//
// Three test files are run together because the module's callers hold parts of it: retry.test.ts
// owns the retry loop's use of the verdicts, and video-caps.test.ts owns the refusal prefixes.
export default {
  file: 'src/lib/upload-policy.ts',
  test: 'tests/upload-policy.test.ts tests/retry.test.ts tests/video-caps.test.ts',
  mutations: [
  // ── keeping the original bytes ────────────────────────────────────────────────────────────────
  { name: 'every photo is re-encoded again, so an original inside both limits is thrown away',
    from: "  return longestEdge > maxDim || fileSizeBytes > capBytes", to: "  return true" },
  { name: 'a photo the album would refuse is uploaded untouched, and refused',
    from: "  return longestEdge > maxDim || fileSizeBytes > capBytes", to: "  return longestEdge > maxDim" },
  { name: 'a photo exactly at the cap is re-encoded for nothing',
    from: "  return longestEdge > maxDim || fileSizeBytes > capBytes", to: "  return longestEdge >= maxDim || fileSizeBytes > capBytes" },
  { name: 'the owner and the guest get the same pixels',
    from: "  return isOwner ? OWNER_IMG_DIM : MAX_IMG_DIM", to: "  return MAX_IMG_DIM" },
  { name: 'guests upload at the owner cap, so event WiFi carries 6000px files',
    from: "  return isOwner ? OWNER_IMG_DIM : MAX_IMG_DIM", to: "  return OWNER_IMG_DIM" },

  // ── transparency ──────────────────────────────────────────────────────────────────────────────
  { name: 'a transparent PNG is re-encoded to JPEG and comes back on a solid black background',
    from: "  if (mime === 'image/png') return 'image/png'\n", to: "" },
  { name: 'a WebP loses its alpha the same way',
    from: "  if (mime === 'image/webp') return 'image/webp'\n", to: "" },
  { name: 'the mime is not normalised, so a caller passing image/PNG gets the black background',
    from: "  const mime = inputMime.toLowerCase()", to: "  const mime = inputMime" },

  // ── the shrink ladder ─────────────────────────────────────────────────────────────────────────
  { name: 'rung 0 is not the cap that was asked for, so the first encode breaks the caller invariant',
    from: "  return [maxDim, ...SHRINK_LADDER.filter((rung) => rung < maxDim)]", to: "  return SHRINK_LADDER" },
  { name: 'a cap below the ladder climbs back above itself',
    from: "  return [maxDim, ...SHRINK_LADDER.filter((rung) => rung < maxDim)]", to: "  return [maxDim, ...SHRINK_LADDER]" },
  { name: 'the ladder can go back up mid-descent',
    from: "SHRINK_LADDER.filter((rung) => rung < maxDim)", to: "SHRINK_LADDER.filter((rung) => rung !== maxDim)" },
  { name: 'the descent continues after the result already fits, shrinking a photo for nothing',
    from: "  if (producedBytes <= capBytes) return null\n", to: "" },
  { name: 'a photo that fits exactly is shrunk one more rung',
    from: "  if (producedBytes <= capBytes) return null", to: "  if (producedBytes < capBytes) return null" },
  { name: 'the last rung is refused instead of accepted, so the upload fails rather than being smaller',
    from: "  return next < ladder.length ? ladder[next] : null", to: "  return ladder[next] ?? ladder[ladder.length - 1]" },
  { name: 'the ladder skips a rung, so a photo drops further than it had to',
    from: "  const next = index + 1", to: "  const next = index + 2" },

  // ── the failure that cost a wedding 19 videos ─────────────────────────────────────────────────
  { name: 'a missing Content-Length is called deterministic again, and every affected video dies',
    from: "  return m.includes('missing') || m.includes('invalid') || m.includes('10032')", to: "  return false" },
  { name: 'Cloudflare wording only, so our own relay phrasing is not recognised',
    from: "  return m.includes('missing') || m.includes('invalid') || m.includes('10032')", to: "  return m.includes('10032')" },
  { name: 'any message mentioning missing anything switches to the relay',
    from: "  if (!m.includes('content-length')) return false\n", to: "" },

  // ── the CSP dump shown to a guest ─────────────────────────────────────────────────────────────
  { name: 'the browser-independent name is not matched, so the guard depends on Chrome wording',
    from: "  return m.includes('evalerror')\n", to: "  return false\n    || " },
  { name: "Firefox's wording is dropped again, and a Firefox guest reads the raw directive",
    from: "    || m.includes('blocked by csp')", to: "" },

  // ── which verdict a failed TUS attempt gets, and in what order ────────────────────────────────
  { name: 'fatality is decided FIRST, so the relay fix becomes dead code again (it did, for 3 commits)',
    from: "  const relayCouldFix = status === null || isMissingContentLengthFailure(message)\n  if (relayCouldFix && !relayActive) return 'relay'\n",
    to: "" },
  { name: 'the relay is switched to even when it is already in use, so it is chosen forever',
    from: "  if (relayCouldFix && !relayActive) return 'relay'", to: "  if (relayCouldFix) return 'relay'" },
  { name: 'a pure network failure no longer reaches the relay',
    from: "  const relayCouldFix = status === null || isMissingContentLengthFailure(message)",
    to: "  const relayCouldFix = isMissingContentLengthFailure(message)" },
  { name: 'a 409 offset mismatch is final, so an aborted-and-resumed video can never finish',
    from: "  if (status !== null && status !== 409 && status >= 400 && status < 500) return 'fatal'",
    to: "  if (status !== null && status >= 400 && status < 500) return 'fatal'" },
  { name: 'a 5xx is fatal, so a transient Cloudflare error ends the upload',
    from: "status >= 400 && status < 500) return 'fatal'", to: "status >= 400) return 'fatal'" },
  { name: 'nothing is ever fatal, so a dead session burns every attempt',
    from: "  if (status !== null && status !== 409 && status >= 400 && status < 500) return 'fatal'\n", to: "" },

  // ── the thundering herd ───────────────────────────────────────────────────────────────────────
  { name: 'THE JITTER IS GONE: 300 phones on one access point retry in lockstep, forever',
    from: "  return base * (0.5 + random() * 0.5)", to: "  return base" },
  { name: 'the first jitter is gone, so the spread is half what the herd guard needs',
    from: "  const base = Math.min(8000, 500 * 2 ** (attempt - 1)) + random() * 300",
    to: "  const base = Math.min(8000, 500 * 2 ** (attempt - 1))" },
  { name: 'the ceiling is gone, so a long outage becomes an hour-long wait',
    from: "  const base = Math.min(8000, 500 * 2 ** (attempt - 1)) + random() * 300",
    to: "  const base = 500 * 2 ** (attempt - 1) + random() * 300" },
  { name: 'the backoff does not grow, so a struggling network is hammered at a fixed rate',
    from: "500 * 2 ** (attempt - 1)", to: "500" },

  // ── park it or give up on it ──────────────────────────────────────────────────────────────────
  { name: 'a timeout is not network-class, so a stalled upload is never parked for the reconnect',
    from: "  if (e instanceof DOMException && e.name === 'TimeoutError') return true\n", to: "" },
  { name: 'a 500 is treated as a dead connection, so the uploader waits for a network that is fine',
    from: "  return e instanceof TypeError", to: "  return true" },

  // ── a refusal is not an error ─────────────────────────────────────────────────────────────────
  { name: 'a refusal must equal the prefix exactly, so every per-file detail files it as an error',
    from: "  return EXPECTED_REFUSAL_PREFIXES.some((prefix) => message.startsWith(prefix))",
    to: "  return EXPECTED_REFUSAL_PREFIXES.some((prefix) => message === prefix)" },
  { name: 'a message that merely MENTIONS a refusal is swallowed, so real failures vanish',
    from: "  return EXPECTED_REFUSAL_PREFIXES.some((prefix) => message.startsWith(prefix))",
    to: "  return EXPECTED_REFUSAL_PREFIXES.some((prefix) => message.includes(prefix))" },
  { name: 'the album-full refusal is retyped instead of imported, so a reword stops recognising it',
    from: "  VIDEO_ALBUM_FULL_PREFIX,", to: "  'This album has reached its video limit'," },

  // ── which route the bytes take ────────────────────────────────────────────────────────────────
  { name: 'the relay is believed with no proof, so the first photo of the session goes through the Worker',
    from: "      if (!believed) return false\n", to: "" },
  { name: 'the belief never expires, so a temporary block costs the Worker budget all session',
    from: "      if (now() - provenAt > reprobeMs) {", to: "      if (false) {" },
  { name: 'the belief expires instantly, so every photo pays a failed direct attempt first',
    from: "      if (now() - provenAt > reprobeMs) {", to: "      if (now() >= provenAt) {" },

  // ── is this failure worth another attempt ────────────────────────────────────────────────────
  { name: 'a 429 is final again, so a limiter blip turns one photo into a manual retry',
    from: "  const retryable = state.status === 429 || state.status >= 500", to: "  const retryable = state.status >= 500" },
  { name: 'every 4xx is retried, burning the deadline to reach the same refusal',
    from: "  const retryable = state.status === 429 || state.status >= 500", to: "  const retryable = true" },
  { name: 'the server-error budget is ignored, so a broken host is retried forever',
    from: "  if (state.serverErrorsSoFar + 1 >= state.maxServerErrors) return 'accept'\n", to: "" },
  { name: 'the budget is spent one attempt late',
    from: "  if (state.serverErrorsSoFar + 1 >= state.maxServerErrors) return 'accept'",
    to: "  if (state.serverErrorsSoFar >= state.maxServerErrors) return 'accept'" },
  { name: 'the deadline is ignored on a response path',
    from: "  if (!state.withinDeadline) return 'accept'\n  return 'retry'", to: "  return 'retry'" },
  { name: 'a deliberate cancel is retried -- the loop re-sends the request the caller just cancelled',
    from: "  if (state.aborted) return 'give-up'\n", to: "" },
  { name: 'a throw past the deadline keeps retrying',
    from: "  if (!state.withinDeadline) return 'give-up'\n  return 'retry'", to: "  return 'retry'" },
  { name: 'A TYPE WE DO NOT ACCEPT GOES BACK TO BEING A FAULT in the Errors tab',
    from: "  TYPE_NOT_ALLOWED,\n", to: "" },
  { name: 'the words are retyped instead of imported, so a reword stops being recognised',
    from: "  TYPE_NOT_ALLOWED,", to: "  'File type is not allowed'," },
  ],
}
