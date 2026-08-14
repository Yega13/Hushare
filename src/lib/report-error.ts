// Client-side error reporting into the existing error_events sink (/api/log/client-error), which
// /admin already reads and groups.
//
// This is deliberately not Sentry. The sink, the table, the pruning and the admin UI all already
// existed — the only thing missing was that almost nothing ever called them, so production looked
// error-free while real users hit crashes. A vendor SDK would add weight to a Worker that just hit
// Cloudflare's size cap, to solve a problem that was one function wide.

const MAX_PER_PAGELOAD = 10
const seen = new Set<string>()
let sent = 0

export type ReportInput = {
  source: string
  message: string
  level?: 'error' | 'warn'
  albumId?: string | null
  context?: Record<string, unknown>
}

// Never throws and never returns a rejected promise: reporting an error must not be able to cause
// one. A failed report is simply lost.
export function reportClientError(input: ReportInput): void {
  try {
    if (typeof window === 'undefined') return

    const message = (input.message ?? '').trim().slice(0, 500)
    if (!message || !input.source) return

    // A render loop or a listener firing on every frame could otherwise hammer the endpoint with
    // thousands of identical rows. First occurrence is the informative one.
    const key = `${input.source}:${message}`
    if (seen.has(key)) return
    if (sent >= MAX_PER_PAGELOAD) return
    seen.add(key)
    sent++

    void fetch('/api/log/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // keepalive lets the report survive the page being torn down, which is exactly when a fatal
      // error tends to happen.
      keepalive: true,
      body: JSON.stringify({
        source: input.source.slice(0, 60),
        message,
        level: input.level ?? 'error',
        albumId: input.albumId ?? undefined,
        context: {
          ...(input.context ?? {}),
          path: window.location.pathname,
        },
      }),
    }).catch(() => { /* telemetry is best-effort by definition */ })
  } catch { /* must never surface */ }
}

// Catches what React error boundaries cannot: errors thrown outside render (event handlers, async
// callbacks, timers) and promise rejections nobody handled. Installed once from the root layout.
export function installGlobalErrorReporting(): () => void {
  if (typeof window === 'undefined') return () => {}

  const onError = (e: ErrorEvent) => {
    reportClientError({
      source: 'window.onerror',
      message: e.message || String(e.error ?? 'unknown error'),
      context: {
        // Line/column locate it in the deployed bundle; the filename tells us whose code it was.
        file: (e.filename ?? '').slice(0, 200), line: e.lineno, col: e.colno,
      },
    })
  }

  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason as unknown
    const message = r instanceof Error ? `${r.name}: ${r.message}` : String(r)
    reportClientError({
      source: 'unhandledrejection',
      message,
      context: r instanceof Error && r.stack ? { stack: r.stack.slice(0, 500) } : undefined,
    })
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
