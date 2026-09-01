import { resolveGridColumns, type MobileColumns } from '@/lib/grid-columns'

// WHICH MEDIA SETTINGS ACTUALLY CHANGED — the decision that ended the grid "merge".
//
// The settings save used to post all seven fields from local state on every call, so every save
// was a WRITE of every field. A tab holding a stale phone-grid value then re-wrote it whenever
// the owner touched anything else: set desktop 6 and phone 3, come back later, both are 6. The
// fix is that only fields differing from the album's CONFIRMED values go on the wire — and this
// comparison is that fix, so it lives here where a test can hold it (rule 15: extracting the
// decision without its enforcement would have tested nothing).

export const DEFAULT_MEDIA_RADIUS = 16

export type MediaSettingsSnapshot = {
  media_radius: number
  video_autoplay: boolean
  media_filter: string
  mobile_grid_columns: MobileColumns
  slideshow_interval_ms: number
  slideshow_animation: string
}

/** The album's confirmed values, normalised exactly the way the UI initialises its controls —
 *  the two must agree or an untouched control reads as a change. */
export function confirmedMediaSettings(album: {
  media_radius?: number | null
  video_autoplay?: boolean | null
  media_filter?: string | null
  mobile_grid_columns?: number | null
  desktop_grid_columns?: number | null
  slideshow_interval_ms?: number | null
  slideshow_animation?: string | null
}, defaultIntervalMs: number): MediaSettingsSnapshot {
  return {
    media_radius: album.media_radius ?? DEFAULT_MEDIA_RADIUS,
    video_autoplay: !!album.video_autoplay,
    media_filter: album.media_filter ?? 'none',
    mobile_grid_columns: resolveGridColumns(album).mobile as MobileColumns,
    slideshow_interval_ms: album.slideshow_interval_ms ?? defaultIntervalMs,
    slideshow_animation: album.slideshow_animation ?? 'fade',
  }
}

/** Only the keys whose next value differs from the confirmed one. An empty object means there is
 *  nothing to save — and nothing may be sent, because an "unchanged" field posted from local
 *  state is exactly the stale write this module exists to prevent. */
export function diffMediaSettings(
  confirmed: MediaSettingsSnapshot,
  next: MediaSettingsSnapshot,
): Partial<MediaSettingsSnapshot> {
  const changes: Partial<MediaSettingsSnapshot> = {}
  if (next.media_radius !== confirmed.media_radius) changes.media_radius = next.media_radius
  if (next.video_autoplay !== confirmed.video_autoplay) changes.video_autoplay = next.video_autoplay
  if (next.media_filter !== confirmed.media_filter) changes.media_filter = next.media_filter
  if (next.mobile_grid_columns !== confirmed.mobile_grid_columns) changes.mobile_grid_columns = next.mobile_grid_columns
  if (next.slideshow_interval_ms !== confirmed.slideshow_interval_ms) changes.slideshow_interval_ms = next.slideshow_interval_ms
  if (next.slideshow_animation !== confirmed.slideshow_animation) changes.slideshow_animation = next.slideshow_animation
  return changes
}
