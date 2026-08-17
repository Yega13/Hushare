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
// A deploy replaces the hashed JS chunks. Anyone with the page already open is still asking for
// the OLD filenames, which no longer exist, so the next lazy import fails and the app dies with a
// white screen. Caught in the wild the first day error reporting went live.
//
// The page is simply stale, so reloading once fixes it completely. The sessionStorage flag means a
// genuinely broken chunk can't put the browser in a reload loop: second time we let the error
// surface normally instead.
const CHUNK_RE = /Loading chunk|ChunkLoadError|Failed to load chunk|error loading dynamically imported module/i
const RELOAD_FLAG = 'hush-chunk-reloaded'

export function looksLikeStaleDeploy(message: string): boolean {
  return CHUNK_RE.test(message)
}

// Reload at most once per tab. Shared by both recovery paths (a thrown chunk error, and the
// watchdog below) so between them they can never bounce a browser in a loop.
export function reloadOnceForStaleDeploy(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return false
    sessionStorage.setItem(RELOAD_FLAG, '1')
  } catch { return false }
  window.location.reload()
  return true
}

// The silent version of the same failure, and the one that actually stranded people.
//
// The recovery above needs the chunk error to REACH us — as a window error, an unhandled rejection,
// or an error boundary. When the failed import happens inside a Suspense boundary (which is every
// client-side navigation into a route that has a loading.tsx), React catches the thrown promise and
// simply keeps waiting. Nothing is thrown, nothing is reported, nothing recovers: the route sits on
// its loading skeleton forever. On an album that reads as "the album will not open at all".
//
// So we check the other way round: if a fallback is still on screen long after it should be, ask
// whether the chunks THIS DOCUMENT booted with still exist. A 404 there is proof the tab is stale
// (a slow connection returns 200, just later) — and reloading is the whole fix.
export async function isStaleDocument(): Promise<boolean> {
  if (typeof document === 'undefined' || !navigator.onLine) return false
  const srcs = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src*="/_next/static/"]'))
    .map((s) => s.src)
    .slice(0, 4)
  if (srcs.length === 0) return false
  try {
    const results = await Promise.all(srcs.map((src) =>
      fetch(src, { method: 'HEAD', cache: 'no-store' }).then((r) => r.status).catch(() => 0),
    ))
    return results.some((status) => status === 404)
  } catch {
    return false
  }
}

// Errors that are not ours and never will be.
//
// A browser extension or an in-app browser injects its own script into every page it opens, and
// when that script throws, window.onerror fires on OUR page. We then faithfully record a "bug" we
// cannot see, cannot reproduce and cannot fix: a crypto wallet probing window.ethereum, Firefox
// iOS's reader-mode shim, Chrome iOS's __gCrWeb bridge. Four of the five most recent entries in
// error_events were exactly this — and they land at error level, so they inflate the count the
// admin dashboard leads with. During an event, that noise is what a real upload failure would be
// hiding behind.
//
// Note these often carry the PAGE's own URL as the filename, because the extension injects an
// inline <script> into the document — so filtering by origin alone does not catch them.
//
// Matching is deliberately explicit and narrow: anything unrecognised is kept. Silently dropping
// one real report is far worse than keeping one junk row.
const FOREIGN_GLOBAL_RE =
  /\b(?:ethereum|solana|phantom|tronWeb|tronLink|__firefox__|__gCrWeb|evmAsk|Backpack|webkit\.messageHandlers)\b/
const EXTENSION_ORIGIN_RE = /^(?:chrome|moz|safari-web|safari|ms-browser)-extension:\/\//

export function isForeignError(message: string, file?: string): boolean {
  if (file && EXTENSION_ORIGIN_RE.test(file)) return true
  // "Script error." is all a browser will say about an exception inside a cross-origin script it
  // refuses to describe. No file, no line, no stack — there is nothing to act on even in principle.
  if (/^script error\.?$/i.test(message.trim())) return true
  return FOREIGN_GLOBAL_RE.test(message)
}

export function reportClientError(input: ReportInput): void {
  try {
    if (typeof window === 'undefined') return

    const message = (input.message ?? '').trim().slice(0, 500)
    if (!message || !input.source) return

    // A render loop or a listener firing on every frame could otherwise hammer the endpoint with
    // thousands of identical rows. First occurrence is the informative one.
    // Report it first (so the frequency is visible in /admin), then recover.
    const stale = looksLikeStaleDeploy(message)

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

    // Reload AFTER the report is in flight — keepalive keeps it alive across the navigation.
    if (stale) reloadOnceForStaleDeploy()
  } catch { /* must never surface */ }
}

// Catches what React error boundaries cannot: errors thrown outside render (event handlers, async
// callbacks, timers) and promise rejections nobody handled. Installed once from the root layout.
export function installGlobalErrorReporting(): () => void {
  if (typeof window === 'undefined') return () => {}

  const onError = (e: ErrorEvent) => {
    const message = e.message || String(e.error ?? 'unknown error')
    if (isForeignError(message, e.filename)) return
    reportClientError({
      source: 'window.onerror',
      message,
      context: {
        // Line/column locate it in the deployed bundle; the filename tells us whose code it was.
        file: (e.filename ?? '').slice(0, 200), line: e.lineno, col: e.colno,
      },
    })
  }

  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason as unknown
    const message = r instanceof Error ? `${r.name}: ${r.message}` : String(r)
    if (isForeignError(message)) return
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
