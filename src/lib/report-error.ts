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
  // "This IS a stale deploy, whatever my message looks like." For the watchdog, which detects the
  // silent version of the failure: nothing throws, so there is no chunk text to pattern-match, and
  // matching on its own synthetic sentence would be a rule about our own prose rather than about
  // what happened. Only affects the level chosen below; the reload path still keys off the message.
  staleDeploy?: boolean
  // "This error left the page unrenderable." Set ONLY by the error boundaries, which is the one
  // situation where the user has already lost whatever was on screen. Recovery that RELOADS must
  // never fire without it — see the note on the DOM recovery below.
  fatal?: boolean
}

// Never throws and never returns a rejected promise: reporting an error must not be able to cause
// one. A failed report is simply lost.
// A deploy replaces the hashed JS chunks. Anyone with the page already open is still asking for
// the OLD filenames, which no longer exist, so the next lazy import fails and the app dies with a
// white screen. Caught in the wild the first day error reporting went live.
//
// The page is simply stale, so reloading once fixes it completely. The sessionStorage flag means a
// genuinely broken chunk can't put the browser in a reload loop: within one build, the second time
// we let the error surface normally instead.
const CHUNK_RE = /Loading chunk|ChunkLoadError|Failed to load chunk|error loading dynamically imported module/i

// ONE RELOAD PER BUILD, not one per tab for the life of the tab.
//
// The flag used to be a bare key, set once and never cleared. That made the recovery single-use
// forever: a tab that had already survived one deploy got NO recovery from the next one, and the
// chunk error surfaced as a dead page and a red row in /admin instead. Two of those arrived from
// one iPhone on 2026-08-26, from a session that sat open through several deploys in a morning —
// the mechanism was working exactly as written, and what was written was wrong.
//
// Keying on the build restores the loop protection it was actually there for — a genuinely broken
// chunk in THIS build still reloads at most once, then surfaces — while letting each new build
// earn its own attempt, which is the only case where a reload was ever going to help. Bounded by
// the number of deploys a tab lives through, so it can never spin.
const BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? 'unknown'
const RELOAD_FLAG = `hush-chunk-reloaded:${BUILD}`

export function looksLikeStaleDeploy(message: string): boolean {
  return CHUNK_RE.test(message)
}

// Reload at most once PER BUILD. Shared by both recovery paths (a thrown chunk error, and the
// watchdog below) so between them they can never bounce a browser in a loop.
export function reloadOnceForStaleDeploy(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return false
    // Drop the previous build's flag as we go. Without this a tab that lives through many deploys
    // slowly fills its own sessionStorage with dead keys — harmless individually, but it is our
    // rubbish and there is no other moment that would ever clear it.
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i)
      if (key && key.startsWith('hush-chunk-reloaded:') && key !== RELOAD_FLAG) sessionStorage.removeItem(key)
    }
    sessionStorage.setItem(RELOAD_FLAG, '1')
  } catch { return false }
  window.location.reload()
  return true
}

// Is this build's one-shot reload still available? Asked BEFORE reporting, to decide whether a
// chunk failure is an incident or a deploy doing what deploys do. Deliberately only reads the flag
// — consuming it here would spend the recovery on a log line.
function staleReloadStillAvailable(): boolean {
  try { return !sessionStorage.getItem(RELOAD_FLAG) } catch { return false }
}

// A DOM the browser rewrote underneath React.
//
// Seen 2026-08-20 on an album page from Android 10: "Failed to execute 'insertBefore' on 'Node':
// The node before which the new node is to be inserted is not a child of this node", with a stack
// recursing through React's commit phase. React holds direct references to the DOM nodes it
// created; anything that moves or replaces them behind its back makes the next commit reference a
// node that is no longer where React believes it is, and the whole tree throws.
//
// The usual cause is the browser's built-in page translation, which replaces text nodes wholesale
// and fires automatically on Android Chrome for a page not in the reader's language. Extensions
// that inject or rewrite markup do the same. Being honest about the limits of that diagnosis: the
// stack proves the DOM was inconsistent, it does not prove which actor made it so.
//
// Either way the page is already dead — the error boundary has replaced the album with "Something
// went wrong" — so a reload costs nothing that was not already lost, and rebuilds the tree from
// scratch. One shot only, on its own flag so it can never consume, or be consumed by, the
// stale-deploy recovery: if it happens twice the reload is not the answer and the error is real.
// EVERY ENGINE PHRASES THIS DIFFERENTLY, and matching only one of them was a real gap.
//
// The first two alternatives are Chrome/Blink and Gecko. Safari says none of that — WebKit's
// NotFoundError reads simply "The object can not be found here." Two of those arrived from an iPad
// on 2026-08-27, and because the pattern did not match them: the one-shot reload never fired, and
// the forensics added the day before (translated?, foreign scripts?) were never collected. The
// rows landed with no recovery attempted and nothing to diagnose from — the exact two things that
// instrumentation existed to provide.
//
// Matching on message text across three engines is fragile by nature, which is why the stack is
// also checked: a removeChild/insertBefore/appendChild frame is the same evidence, whatever the
// engine calls the error.
const DOM_CORRUPTION_RE =
  /Failed to execute '(?:insertBefore|removeChild|appendChild)' on 'Node'|The node (?:before which the new node is to be inserted|to be removed) is not a child of this node|The object can ?not be found here/i
const DOM_RELOAD_FLAG = 'hush-dom-reloaded'

export function looksLikeDomCorruption(message: string): boolean {
  return DOM_CORRUPTION_RE.test(message)
}

function domReloadStillAvailable(): boolean {
  try { return !sessionStorage.getItem(DOM_RELOAD_FLAG) } catch { return false }
}

export function reloadOnceForDomCorruption(): boolean {
  try {
    if (sessionStorage.getItem(DOM_RELOAD_FLAG)) return false
    sessionStorage.setItem(DOM_RELOAD_FLAG, '1')
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
// Identifiers that exist only in injected code. Safe to match anywhere in a message.
// _AutofillCallbackHandler is iOS Safari's own password-autofill bridge. It is injected into the
// page by the browser, and when Safari tears it down mid-interaction its own script throws
// "ReferenceError: Can't find variable: _AutofillCallbackHandler" — on our page, through our
// window.onerror, naming a global this codebase has never referenced. Seen 2026-08-26 from
// iPhone OS 26.5. Nothing to fix and nothing we could fix; it is the same class as the wallet and
// reader-mode shims already listed here.
const FOREIGN_INJECTED_RE =
  /\b(?:__firefox__|__gCrWeb|_AutofillCallbackHandler|tronWeb|tronLink|evmAsk|webkit\.messageHandlers)\b/

// Wallet globals whose names are also ordinary words. "Backpack" and "phantom" are a plausible
// album title and a plausible filename, and our messages routinely quote both — so matching these
// on their own would let an album called Backpack silence its own errors. They count as foreign
// only when the message ALSO shows the name being used as a property of the global object, which
// is the only way a wallet shim ever throws. Two independent signals, so user data alone can never
// trip it.
const WALLET_NAME_RE = /\b(?:ethereum|solana|phantom|Backpack|coinbaseWalletExtension)\b/
// Deliberately not a `window.` prefix: only WebKit echoes the full source expression. Chrome says
// "Cannot redefine property: ethereum" and "Cannot set property ethereum of #<Window> which has
// only a getter"; Firefox says "can't redefine non-configurable property". A prefix rule would
// under-filter on two engines out of three and need patching for every new phrasing.
const GLOBAL_PROP_RE =
  /window\.|#<Window>|globalThis|\bredefine\b|non-?configurable|only a getter|read[ -]?only property/i

// `iabjs:` is the in-app browser inside Facebook, Instagram and similar apps. It injects its own
// analytics script into every page it opens, and when that script throws, window.onerror fires on
// OUR page with ITS filename. Seen 2026-08-20 from an Android 16 device:
// "Error invoking postMessage: Java object is gone" at iabjs://navigation_performance_logger_android
// — entirely inside their bridge, nothing to do with this site, and not fixable from here. Guests
// arrive from Instagram links constantly, so this is a steady source of unactionable noise in the
// Errors tab, which is exactly what buries the reports that matter.
const EXTENSION_ORIGIN_RE =
  /^(?:chrome|moz|safari-web|safari|ms-browser)-extension:\/\/|^webkit-masked-url:|^iabjs:/

/**
 * How much of a stack we keep.
 *
 * Sized to fit INSIDE the server's per-value clamp (lib/error-context's MAX_VALUE_CHARS), so the
 * stack arrives whole rather than being trimmed twice. Raising this without raising that one just
 * moves where the cut happens.
 *
 * 600 characters of FRAMES — the message is stripped first — is roughly six production frames,
 * which is what it takes to get past React's internals to ours.
 */
export const STACK_CHARS = 600

/**
 * The part of a stack worth storing — FRAMES, not the message again.
 *
 * `error.stack` begins with the message, and both boundaries stored `error.stack.slice(0, 400)`
 * beside the same message in its own column. That is not a small waste. React's own minified error
 * text is about 180 characters —
 *
 *     "Minified React error #310; visit https://react.dev/errors/310 for the full message or use
 *      the non-minified dev environment for full errors and additional helpful warnings."
 *
 * — and each production frame is a long hashed chunk URL, so 400 characters bought roughly three
 * frames, all of them inside React. A real #310 arrived from a customer on 2026-09-02 and the
 * capture stopped at `at r.useMemo (https://hushare.space/_ne` — one character before anything that
 * could name the component. An error report that cannot identify what threw is not a report.
 *
 * So: drop the leading message lines, keep the frames, and keep enough of them to get past the
 * framework. The message is already stored, in full, in its own column.
 */
export function stackFrames(stack: string | undefined): string | undefined {
  if (!stack) return undefined
  const lines = stack.split('\n')
  // V8 puts the message first (possibly over several lines); frames are the ones starting with
  // "at ". Firefox and Safari have no message line at all and no "at " prefix, so when nothing
  // looks like a V8 frame the whole stack is kept rather than silently emptied (rule 19).
  const firstFrame = lines.findIndex((l) => /^\s*at\s/.test(l))
  const frames = firstFrame === -1 ? lines : lines.slice(firstFrame)
  return frames.join('\n').slice(0, STACK_CHARS) || undefined
}

// A BROWSER EXTENSION TALKING TO ITSELF, on our page.
//
// Extensions run their content scripts in OUR page's context, so when their internal messaging
// fails the rejection surfaces as an unhandled rejection on hushare.space and lands in the Errors
// tab. Seen 2026-09-02 from Safari 26.5 on macOS, on a marketing page:
//
//     Error: No Listener: tabs:outgoing.message.ready
//
// That string appears nowhere in this codebase. It is an extension whose background listener has
// gone away — nothing to do with this site and not fixable from here. Unfiltered it is steady
// unactionable noise, which is exactly what buries the reports that matter (rule 12).
//
// Matched on the message because these arrive with NO file: an unhandled rejection carries only
// whatever the rejection value stringified to, so the extension-origin test below cannot see them.
// NO WORD-BOUNDARY ESCAPE IN HERE, deliberately. The first version of this line opened with a
// word-boundary escape written through a shell heredoc, and the heredoc turned it into a literal
// BACKSPACE character: the regex still compiled, still type-checked, and matched nothing —
// invisible in the diff and in grep output. That is MISTAKES entry 24, and
// tests/source-hygiene.test.ts caught it by code point, which is the only thing that ever does.
// These alternatives are distinctive enough to need no boundary.
const EXTENSION_MESSAGING_RE =
  /No Listener:|Could not establish connection\. Receiving end does not exist|The message port closed before a response was received|Extension context invalidated/i

export function isForeignError(message: string, file?: string): boolean {
  if (EXTENSION_MESSAGING_RE.test(message)) return true
  if (file && EXTENSION_ORIGIN_RE.test(file)) return true
  // "Script error." is all a browser will say about an exception inside a cross-origin script it
  // refuses to describe. No file, no line, no stack — there is nothing to act on even in principle.
  if (/^script error\.?$/i.test(message.trim())) return true
  if (FOREIGN_INJECTED_RE.test(message)) return true
  return WALLET_NAME_RE.test(message) && GLOBAL_PROP_RE.test(message)
}

// What was actually done to the DOM, collected at the moment it broke.
//
// The diagnosis above has been a THEORY since 2026-08-17 — page translation or an extension — and
// nine occurrences later it is still a theory, because nothing recorded the one thing that would
// decide it. Guessing again would be the third fix aimed at a cause nobody has confirmed.
//
// Chrome's translator is not subtle about itself: it stamps `translated-ltr` (or `translated-rtl`)
// on <html> and rewrites text nodes inside <font> tags, neither of which this app ever emits. A
// changed <html lang> against the language the document was served in says the same thing. Scripts
// from an origin that is not ours are the extension case. All three are free to read and none of
// them contain anything personal — no text, no URLs beyond our own origin, just counts and flags.
//
// The NEXT occurrence answers the question instead of adding to the pile.
function domForensics(): Record<string, unknown> {
  try {
    const html = document.documentElement
    const scripts = Array.from(document.querySelectorAll('script[src]'))
      .map((el) => (el as HTMLScriptElement).src)
      .filter((src) => { try { return new URL(src).origin !== window.location.origin } catch { return true } })
    return {
      translated: /\btranslated-(?:ltr|rtl)\b/.test(html.className) || document.querySelector('font') !== null,
      htmlLang: html.lang || null,
      htmlClass: html.className.slice(0, 120),
      foreignScripts: scripts.length,
      // Origins only — never the full URL, which can carry an extension id that identifies a person.
      foreignOrigins: Array.from(new Set(scripts.map((src) => { try { return new URL(src).origin } catch { return 'unparseable' } }))).slice(0, 4),
      bodyChildren: document.body.childElementCount,
    }
  } catch {
    return {}
  }
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
    // A DOM-corruption reload is only safe when the page is ALREADY DEAD.
    //
    // reportClientError is the sink for window.onerror too (see installGlobalErrorReporting), and
    // that handler is mounted app-wide from the root layout — including the album page that hosts
    // the uploader. A non-fatal insertBefore/removeChild error from a timer, an async callback or
    // an unmount cleanup would therefore have reloaded the page underneath a guest with photos
    // still uploading, destroying the in-memory File objects, the resumable video sessions and the
    // pending-save queue. Nothing warns them, and nothing recovers it. That is far worse than the
    // cosmetic glitch the reload was meant to repair.
    //
    // Only the error boundaries set `fatal`, and only there has the user already lost the screen.
    const domFatal = input.fatal === true && looksLikeDomCorruption(message)

    const key = `${input.source}:${message}`
    // Recovery is not telemetry, so it must not be suppressed by the dedupe key or the per-pageload
    // cap. Ten junk errors ahead of a chunk error would otherwise leave the user staring at a dead
    // page with the fix one line away.
    if (stale && (seen.has(key) || sent >= MAX_PER_PAGELOAD)) { reloadOnceForStaleDeploy(); return }
    // Same reasoning as the line above: a corrupted DOM makes React throw repeatedly, so the tenth
    // error is exactly when recovery matters most. Without this the cap silently swallows the fix.
    if (domFatal && (seen.has(key) || sent >= MAX_PER_PAGELOAD)) { reloadOnceForDomCorruption(); return }
    if (seen.has(key)) return
    if (sent >= MAX_PER_PAGELOAD) return
    seen.add(key)
    sent++

    // A chunk failure we are ABOUT to fix is not an incident, it is a deploy landing under an open
    // tab: the file names change, whatever was still open asks for the old ones, and the reload
    // below puts it right within a second. Nothing failed for that person.
    //
    // Filing it as an error was actively harmful, not just untidy. The alert cron watches for 8
    // errors in 10 minutes, and a deploy during an event hands the SAME chunk error to every guest
    // with the album open at once — an alarm email about a problem that had already fixed itself,
    // arriving exactly when nobody has time to check. Recorded at warn instead, because how often
    // this happens is still worth seeing.
    //
    // The distinction is whether recovery is actually available: once the one-shot reload has been
    // spent and the chunk STILL fails, the page is genuinely broken and that is a real error.
    // Gathered ONCE, because the answer now decides the level as well as filling the context.
    const forensics = looksLikeDomCorruption(message) ? domForensics() : {}

    // THE QUESTION IS ANSWERED, so this stops being filed as our error.
    //
    // The diagnosis was a theory from 2026-08-17 through nine occurrences. On 2026-08-29 the
    // forensics above finally caught one: translated: true, htmlLang "ja", on a page served in
    // English — Chrome's built-in translator replacing text nodes underneath React, which then
    // cannot find the children it put there. Three reports in two minutes from one session, plus a
    // fourth as the error boundary itself tore down.
    //
    // React cannot survive a third party rewriting its DOM, so there is no fix here to make. The
    // one-shot reload already recovers the page. What was left was an unfixable browser behaviour
    // filing itself as an app error every time, which is how a panel full of real problems becomes
    // a panel nobody reads.
    //
    // Recorded at warn, not dropped: if this ever becomes frequent it is worth seeing, and the
    // answer would be to reconsider what is marked translate="no" — the photo grid already is.
    const translatedDom = forensics.translated === true

    const recoverable =
      ((stale || input.staleDeploy === true) && staleReloadStillAvailable()) ||
      (domFatal && domReloadStillAvailable())
    void fetch('/api/log/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // keepalive lets the report survive the page being torn down, which is exactly when a fatal
      // error tends to happen.
      keepalive: true,
      body: JSON.stringify({
        source: input.source.slice(0, 60),
        message,
        level: (recoverable || translatedDom) ? 'warn' : (input.level ?? 'error'),
        albumId: input.albumId ?? undefined,
        context: {
          ...(input.context ?? {}),
          // Only for the error class it can explain — everything else would carry the noise for
          // nothing. See domForensics.
          ...forensics,
          path: window.location.pathname,
          // Which bundle this browser is actually running (see next.config.ts).
          build: process.env.NEXT_PUBLIC_BUILD_ID ?? 'unknown',
          ...(recoverable ? { autoReloaded: true } : {}),
        },
      }),
    }).catch(() => { /* telemetry is best-effort by definition */ })

    // Reload AFTER the report is in flight — keepalive keeps it alive across the navigation.
    if (stale) reloadOnceForStaleDeploy()
    // After the report is in flight, same as the stale-deploy path — keepalive carries it across
    // the navigation, so the incident is always recorded even though the page is about to reload.
    else if (domFatal) reloadOnceForDomCorruption()
  } catch { /* must never surface */ }
}

// Catches what React error boundaries cannot: errors thrown outside render (event handlers, async
// callbacks, timers) and promise rejections nobody handled. Installed once from the root layout.
export function installGlobalErrorReporting(): () => void {
  if (typeof window === 'undefined') return () => {}

  const onError = (e: ErrorEvent) => {
    const message = e.message || String(e.error ?? 'unknown error')
    // looksLikeStaleDeploy first: filtering a chunk error would drop not just the log row but the
    // one-shot reload that is the entire fix for it.
    if (!looksLikeStaleDeploy(message) && isForeignError(message, e.filename)) return
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
    if (!looksLikeStaleDeploy(message) && isForeignError(message)) return
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
