// What a page was actually like to use: how long it held someone, how far they got, and whether it
// fought back.
//
// The product could already say what BROKE — error_events has recorded that from the beginning. It
// could not say what was HARD, and those are different things. A guest who taps "Add photos" four
// times because nothing appears to happen never generates an error; they just leave.
//
// NO IDENTIFIER AT ALL. Not a cookie, not a localStorage value, not even a per-tab id. Aggregate
// counts answer every question here — "how long does the album page hold people", "what fraction of
// uploads that start actually finish" — and none of them need to know that two page views came from
// the same person. It is the strongest privacy position available that still answers the question,
// so it is the one taken.
//
// Sent ONCE, when the page is hidden, with sendBeacon. Not on 'unload': that event never fires
// reliably on mobile Safari, which is most of this product's traffic, so anything reported there
// would be missing exactly the visitors it most matters to hear from.

const ENDPOINT = '/api/log/engagement'

// Rage = several clicks in the same small area in quick succession.
const RAGE_CLICKS = 3
const RAGE_WINDOW_MS = 800
const RAGE_RADIUS_PX = 40

// Beyond this a "visit" is somebody who left a tab open, not somebody reading.
const MAX_DWELL_SECONDS = 1800

export type EngagementPayload = {
  page: string
  albumId?: string | null
  dwellSeconds: number
  scrollPct: number
  active: boolean
  friction: { kind: 'rage' | 'dead'; label: string }[]
}

function labelFor(el: Element | null): string {
  if (!el) return 'unknown'
  const target = (el.closest('[data-friction-label]') as HTMLElement | null)
  const explicit = target?.dataset.frictionLabel
  if (explicit) return explicit.slice(0, 40)
  const btn = el.closest('button, a, [role="button"]') as HTMLElement | null
  const text = (btn?.getAttribute('aria-label') || btn?.textContent || (el as HTMLElement).tagName || '')
    .replace(/\s+/g, ' ')
    .trim()
  return (text || 'unknown').slice(0, 40)
}

/**
 * Begin measuring the current page. Returns a cleanup function.
 *
 * Everything is passive and cheap: two counters, a scroll listener that only ever does a comparison,
 * and one click listener. Nothing is sent until the page is hidden.
 */
export function startEngagement(page: string, albumId?: string | null): () => void {
  if (typeof window === 'undefined') return () => {}

  let visibleSince = document.visibilityState === 'visible' ? Date.now() : 0
  let dwellMs = 0
  let maxScrollPct = 0
  let interactions = 0
  let sent = false
  const friction: { kind: 'rage' | 'dead'; label: string }[] = []

  // Click history for rage detection, kept to the last handful of clicks only.
  let recent: { x: number; y: number; t: number }[] = []

  const measureScroll = () => {
    const doc = document.documentElement
    const scrollable = doc.scrollHeight - window.innerHeight
    // A page that does not scroll was seen in full, which is 100 — not 0. Reporting 0 here would
    // make every short page look like an instant bounce.
    const pct = scrollable <= 0 ? 100 : Math.round(((window.scrollY || 0) / scrollable) * 100)
    if (pct > maxScrollPct) maxScrollPct = Math.min(100, Math.max(0, pct))
  }

  const onClick = (e: MouseEvent) => {
    interactions++
    const now = Date.now()
    recent = recent.filter((c) => now - c.t < RAGE_WINDOW_MS)
    recent.push({ x: e.clientX, y: e.clientY, t: now })
    const near = recent.filter(
      (c) => Math.abs(c.x - e.clientX) < RAGE_RADIUS_PX && Math.abs(c.y - e.clientY) < RAGE_RADIUS_PX,
    )
    if (near.length >= RAGE_CLICKS) {
      const label = labelFor(e.target as Element)
      // One report per label per page — a genuinely stuck person can produce dozens, and the
      // interesting fact is "this happened here", not how many times somebody's finger moved.
      if (!friction.some((f) => f.kind === 'rage' && f.label === label) && friction.length < 5) {
        friction.push({ kind: 'rage', label })
      }
      recent = []
    }
  }

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      if (visibleSince) dwellMs += Date.now() - visibleSince
      visibleSince = 0
      send()
    } else if (!visibleSince) {
      visibleSince = Date.now()
    }
  }

  const send = () => {
    // Once per page. A tab switched away and back would otherwise report the same visit repeatedly
    // and multiply every average by however restless the visitor was.
    if (sent) return
    sent = true
    measureScroll()
    const dwellSeconds = Math.min(MAX_DWELL_SECONDS, Math.round(dwellMs / 1000))
    // Nothing to learn from a page that was never really looked at, and sending it would drag every
    // average toward zero.
    if (dwellSeconds < 1 && friction.length === 0) return

    const payload: EngagementPayload = {
      page,
      albumId: albumId ?? null,
      dwellSeconds,
      scrollPct: maxScrollPct,
      active: interactions > 0,
      friction,
    }
    try {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
      // sendBeacon survives the page going away; fetch() does not, which is the entire point.
      if (!navigator.sendBeacon?.(ENDPOINT, blob)) {
        void fetch(ENDPOINT, { method: 'POST', body: blob, keepalive: true }).catch(() => {})
      }
    } catch {
      // Telemetry must never surface to the person using the page.
    }
  }

  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', send)
  window.addEventListener('scroll', measureScroll, { passive: true })
  document.addEventListener('click', onClick, { passive: true, capture: true })

  return () => {
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', send)
    window.removeEventListener('scroll', measureScroll)
    document.removeEventListener('click', onClick, { capture: true } as EventListenerOptions)
    send()
  }
}

/**
 * Report one step of the upload path. Fire-and-forget; never awaited, never throws.
 *
 * media_uploaded already recorded successes. A success RATE needs the denominator, and until now
 * choosing twenty photos and then abandoning looked exactly like never having tried.
 */
export function trackUploadStep(
  step: 'picked' | 'started' | 'done' | 'failed',
  count: number,
  albumId?: string | null,
  /**
   * Throughput in KB/s for a finished batch. Answers the question nobody could answer before —
   * "is it slow because of my connection, or because of us?" — with a number instead of a feeling.
   * Sent only on `done`, where both the bytes and the elapsed time are actually known.
   */
  kbps?: number,
): void {
  if (typeof window === 'undefined') return
  try {
    const body = JSON.stringify({ upload: {
      step,
      count: Math.max(0, Math.round(count)),
      albumId: albumId ?? null,
      ...(kbps != null && Number.isFinite(kbps) ? { kbps: Math.max(0, Math.round(kbps)) } : {}),
    } })
    const blob = new Blob([body], { type: 'application/json' })
    if (!navigator.sendBeacon?.(ENDPOINT, blob)) {
      void fetch(ENDPOINT, { method: 'POST', body: blob, keepalive: true }).catch(() => {})
    }
  } catch {
    // Never let a counter interfere with an upload.
  }
}
