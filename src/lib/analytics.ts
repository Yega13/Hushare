import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { VisitorContext } from '@/lib/visitor-context'

// Minimal local type — avoids importing @cloudflare/workers-types globally (it conflicts with DOM types).
type AnalyticsEngineDataset = {
  writeDataPoint(event: {
    indexes?: string[]
    blobs?: (string | null)[]
    doubles?: number[]
  }): void
}
type AnalyticsEnv = { ANALYTICS?: AnalyticsEngineDataset }

type Tier = 'free' | 'pro' | 'studio'
type MediaKind = 'image' | 'video'
type UploadSource = 'owner' | 'guest' | 'unknown'

// Discriminated union of every product event we record. Add new variants here — the
// switch in track() will force you to map each one to the fixed column schema below.
export type AnalyticsEvent =
  | { name: 'album_created';        albumId: string; userId?: string | null }
  | { name: 'album_viewed';         albumId: string; source?: UploadSource }
  | { name: 'media_uploaded';       albumId: string; mediaType: MediaKind; count: number; source: UploadSource; bytes?: number }
  | { name: 'media_downloaded';     albumId: string; kind: 'single' | 'zip'; source: 'owner' | 'guest' }
  | { name: 'media_deleted';        albumId: string; count: number }
  | { name: 'face_search_run';      albumId: string; matches?: number }
  | { name: 'checkout_started';     userId?: string | null; tier: Tier; cycle?: string }
  | { name: 'subscription_active';  userId?: string | null; tier: Tier }
  | { name: 'subscription_canceled'; userId?: string | null; tier: Tier }
  | { name: 'album_retired';        albumId: string }
  /** The bin emptied: an album the OWNER deleted, destroyed after its recovery window. */
  | { name: 'album_bin_purged';     albumId: string }
  // One-off package purchases — album-scoped money, unlike the user-scoped subscription events.
  | { name: 'package_purchased';    albumId: string; product: string }
  | { name: 'package_renewed';      albumId: string; product: string }
  | { name: 'support_submitted' }
  | { name: 'report_submitted' }
  // Support-chat turn. blob5 = outcome, blob6 = the visitor's question (PII-redacted, truncated).
  // Never logged for crisis/welfare turns — we don't store self-harm disclosures.
  | { name: 'support_chat'; question?: string; outcome: 'answered' | 'handoff' }
  // ── Engagement, reported by the browser when a page is hidden ──
  // How long a page held someone, how far down they got, and whether they touched anything at all.
  // Answers "where do they linger" — which nothing in the product could say before.
  | { name: 'page_engaged'; page: string; albumId?: string | null; dwellSeconds: number; scrollPct: number; active: boolean }
  // The upload path, step by step. media_uploaded already recorded successes; a success rate needs
  // the denominator, and abandoning after picking files looked identical to never trying.
  | { name: 'upload_funnel'; albumId?: string | null; step: 'picked' | 'started' | 'done' | 'failed'; count: number; kbps?: number; source?: UploadSource }
  // Someone hammering the same spot, or tapping something that does nothing. This is the closest a
  // product gets to hearing a person swear at it.
  | { name: 'friction'; page: string; albumId?: string | null; kind: 'rage' | 'dead'; label: string }

// ── Fixed positional column schema (keep stable — queries reference these positions) ──
//   index1 = event name         (sampling key; groups adaptive sampling per event type)
//   blob1  = event name         (queryable without relying on _sample)
//   blob2  = album id
//   blob3  = user id
//   blob4  = tier
//   blob5  = source             (owner | guest | unknown)
//   blob6  = detail             (mediaType | download kind | billing cycle)
//   double1 = count             (magnitude: items uploaded/deleted, else 1)
//   double2 = value             (bytes for uploads, match count for face search, else 0)
//
// ── Visitor context, APPENDED (positions 7+ / 3+ are new; everything above keeps its place) ──
// Added at the end on purpose. Existing dashboard queries address columns by position, so inserting
// anywhere earlier would silently re-point every one of them at the wrong data — the kind of break
// that shows up as plausible-looking numbers rather than an error.
//   blob7  = country ISO-2      (edge-resolved; '' when unavailable)
//   blob8  = city
//   blob9  = region
//   blob10 = referrer class     (direct | search | social | qr | internal | other)
//   blob11 = referrer host
//   blob12 = device             (mobile | tablet | desktop | bot | unknown)
//   double3 = visitor-local hour     0-23, -1 unknown  (THEIR clock, not the server's)
//   double4 = visitor-local weekday  0=Sun … 6=Sat, -1 unknown

function s(v: string | null | undefined): string {
  return v == null ? '' : String(v).slice(0, 256)
}

// INVARIANT: every branch returns exactly 6 blobs and exactly 2 doubles.
//
// The visitor context is appended after this, so it lands on blob7-12 and double3-4 for every event
// type. Return a third double from any branch here and the visitor's hour silently becomes double4
// for that event alone — the clock query would then read a weekday as an hour and draw a chart that
// looks completely reasonable and is entirely wrong.
function shape(e: AnalyticsEvent): { blobs: string[]; doubles: number[] } {
  switch (e.name) {
    case 'album_created':
      return { blobs: [e.name, s(e.albumId), s(e.userId), '', '', ''], doubles: [1, 0] }
    case 'album_viewed':
      return { blobs: [e.name, s(e.albumId), '', '', s(e.source), ''], doubles: [1, 0] }
    case 'media_uploaded':
      return { blobs: [e.name, s(e.albumId), '', '', s(e.source), e.mediaType], doubles: [e.count, e.bytes ?? 0] }
    case 'media_downloaded':
      return { blobs: [e.name, s(e.albumId), '', '', s(e.source), e.kind], doubles: [1, 0] }
    case 'media_deleted':
      return { blobs: [e.name, s(e.albumId), '', '', '', ''], doubles: [e.count, 0] }
    case 'face_search_run':
      return { blobs: [e.name, s(e.albumId), '', '', '', ''], doubles: [1, e.matches ?? 0] }
    case 'checkout_started':
      return { blobs: [e.name, '', s(e.userId), e.tier, '', s(e.cycle)], doubles: [1, 0] }
    case 'subscription_active':
    case 'subscription_canceled':
      return { blobs: [e.name, '', s(e.userId), e.tier, '', ''], doubles: [1, 0] }
    case 'package_purchased':
    case 'package_renewed':
      // Same column plan as the subscription events: blob2 the album, blob6 the product key.
      return { blobs: [e.name, s(e.albumId), '', '', '', e.product], doubles: [1, 0] }
    case 'album_retired':
    case 'album_bin_purged':
      return { blobs: [e.name, s(e.albumId), '', '', '', ''], doubles: [1, 0] }
    case 'support_submitted':
    case 'report_submitted':
      return { blobs: [e.name, '', '', '', '', ''], doubles: [1, 0] }
    case 'support_chat':
      return { blobs: [e.name, '', '', '', e.outcome, s(e.question)], doubles: [1, e.question ? e.question.length : 0] }
    case 'page_engaged':
      // 'active' vs 'passive' rather than a click COUNT, because doubles 3 and 4 belong to the
      // visitor context and shape() must always return exactly two — see the note below.
      return { blobs: [e.name, s(e.albumId), '', '', s(e.page), e.active ? 'active' : 'passive'], doubles: [e.dwellSeconds, e.scrollPct] }
    case 'upload_funnel':
      // double2 carries KB/s on a finished batch. "Uploads feel slow" is unanswerable without it:
      // the same complaint fits a slow connection, a slow phone and a slow server, and those are
      // three completely different fixes.
      return { blobs: [e.name, s(e.albumId), '', '', s(e.source ?? 'unknown'), e.step], doubles: [e.count, e.kbps ?? 0] }
    case 'friction':
      // kind and label share blob6 as `kind:label`. blob4 and blob5 already mean tier and source
      // everywhere else, and quietly redefining a column per event type is how a dashboard starts
      // reporting one thing under the name of another.
      return { blobs: [e.name, s(e.albumId), '', '', s(e.page), `${e.kind}:${s(e.label)}`], doubles: [1, 0] }
  }
}

/**
 * Record a product event to Workers Analytics Engine.
 *
 * Fire-and-forget: writeDataPoint is synchronous and non-blocking, and this function
 * swallows every error (missing binding in `next dev`, context unavailable, etc.) so a
 * telemetry failure can NEVER break — or even slow — the request that emitted it.
 */
export function track(event: AnalyticsEvent, visitor?: VisitorContext): void {
  try {
    const ds = (getCloudflareContext()?.env as AnalyticsEnv | undefined)?.ANALYTICS
    if (!ds) return // dev / binding not provisioned yet → silent no-op
    const { blobs, doubles } = shape(event)
    // Optional, because most events are emitted from places that have no request to read — a cron
    // retiring an album, a webhook confirming a payment. Those write empty columns rather than
    // inventing a location, so a query for "where do views come from" is never quietly polluted by
    // rows that had no visitor at all.
    if (visitor) {
      blobs.push(visitor.country, visitor.city, visitor.region, visitor.refClass, visitor.refHost, visitor.device)
      doubles.push(visitor.hour, visitor.weekday)
    }
    ds.writeDataPoint({ indexes: [event.name], blobs, doubles })
  } catch {
    // Analytics must never throw into the request path.
  }
}
