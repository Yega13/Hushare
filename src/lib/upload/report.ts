// Fire-and-forget telemetry from the upload path to /api/log/client-error.
//
// Moved out of UploadZone.tsx verbatim. Four sites call it -- the image relay switch, the video
// relay switch, the save-failure path and the per-batch failure sample -- and the module that owns
// the retry loops needs it too, so it has to live somewhere both can import.
//
// It is DELIBERATELY not lib/report-error's reportClientError. That one is for UNCAUGHT errors: it
// carries a stack, decides whether a message means a stale deploy or DOM corruption, and may reload
// the page. This is a structured event the upload code chose to record, with a level it chose. The
// two must not be merged, or every deliberate "switched to relay" warning would run through logic
// built to decide whether the page is broken.
//
// NEVER THROWS, NEVER AWAITED. Telemetry that could fail an upload is worse than no telemetry; the
// try/catch and the swallowed rejection are the contract, not defensive noise. `keepalive: true` lets
// the request survive the page being closed mid-upload, which is exactly when the sample matters.

export type ClientEventLevel = 'error' | 'warn'

/** The one field injected for tests: the module never touches a global fetch it was not handed. */
export type EventTransport = (url: string, init: RequestInit) => Promise<unknown>

export function reportClientEvent(
  level: ClientEventLevel,
  source: string,
  message: string,
  albumId: string,
  context?: Record<string, unknown>,
  transport: EventTransport = (url, init) => fetch(url, init),
): void {
  try {
    void transport('/api/log/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level,
        source,
        // Clamped, not dropped: /api/log/client-error keeps the keys and trims the value, and the
        // server groups incidents by exact message -- a runaway message would shatter one outage
        // into a column of one-count chips.
        message: String(message).slice(0, 500),
        albumId,
        context: { ...(context ?? {}), build: process.env.NEXT_PUBLIC_BUILD_ID ?? 'unknown' },
      }),
      keepalive: true,
    }).catch(() => {})
  } catch { /* never let telemetry break an upload */ }
}
