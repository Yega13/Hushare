import { getCloudflareContext } from '@opennextjs/cloudflare'

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
  | { name: 'support_submitted' }
  | { name: 'report_submitted' }

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

function s(v: string | null | undefined): string {
  return v == null ? '' : String(v).slice(0, 256)
}

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
    case 'album_retired':
      return { blobs: [e.name, s(e.albumId), '', '', '', ''], doubles: [1, 0] }
    case 'support_submitted':
    case 'report_submitted':
      return { blobs: [e.name, '', '', '', '', ''], doubles: [1, 0] }
  }
}

/**
 * Record a product event to Workers Analytics Engine.
 *
 * Fire-and-forget: writeDataPoint is synchronous and non-blocking, and this function
 * swallows every error (missing binding in `next dev`, context unavailable, etc.) so a
 * telemetry failure can NEVER break — or even slow — the request that emitted it.
 */
export function track(event: AnalyticsEvent): void {
  try {
    const ds = (getCloudflareContext()?.env as AnalyticsEnv | undefined)?.ANALYTICS
    if (!ds) return // dev / binding not provisioned yet → silent no-op
    const { blobs, doubles } = shape(event)
    ds.writeDataPoint({ indexes: [event.name], blobs, doubles })
  } catch {
    // Analytics must never throw into the request path.
  }
}
