import { resolveGridColumns } from '@/lib/grid-columns'
import type { MediaDisplayFilter, MobileGridColumns, SlideshowAnimation } from '@/types'

// WHICH MEDIA SETTINGS ACTUALLY CHANGED — the decision that ended the grid "merge".
//
// The settings save used to post all seven fields from local state on every call, so every save
// was a WRITE of every field. A tab holding a stale phone-grid value then re-wrote it whenever
// the owner touched anything else: set desktop 6 and phone 3, come back later, both are 6. The
// fix is that only fields differing from the album's CONFIRMED values go on the wire — and this
// comparison is that fix, so it lives here where a test can hold it (rule 15: extracting the
// decision without its enforcement would have tested nothing).

export const DEFAULT_MEDIA_RADIUS = 16

// The Album's own field types, so a draft patch IS an album patch: the panel hands the same object
// to the album and to the save, and a type gap here would mean a cast at every control.
export type MediaSettingsSnapshot = {
  media_radius: number
  video_autoplay: boolean
  media_filter: MediaDisplayFilter
  mobile_grid_columns: MobileGridColumns
  slideshow_interval_ms: number
  slideshow_animation: SlideshowAnimation
}

/** The album's confirmed values, normalised exactly the way the UI initialises its controls —
 *  the two must agree or an untouched control reads as a change. */
export function confirmedMediaSettings(album: {
  media_radius?: number | null
  video_autoplay?: boolean | null
  media_filter?: MediaDisplayFilter | null
  mobile_grid_columns?: number | null
  desktop_grid_columns?: number | null
  slideshow_interval_ms?: number | null
  slideshow_animation?: SlideshowAnimation | null
}, defaultIntervalMs: number): MediaSettingsSnapshot {
  return {
    media_radius: album.media_radius ?? DEFAULT_MEDIA_RADIUS,
    video_autoplay: !!album.video_autoplay,
    media_filter: album.media_filter ?? 'none',
    mobile_grid_columns: resolveGridColumns(album).mobile as MobileGridColumns,
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

// THE CONFIRMED / DRAFT MACHINE -- what the panel shows versus what the server has acknowledged.
//
// diffMediaSettings above is only as good as the "confirmed" side it is handed. The panel used to
// hand it the album prop -- which the panel itself patches OPTIMISTICALLY the moment a slider moves,
// so the grid redraws live. So: drag the radius to 40 (album now says 40, unsaved), flip autoplay
// inside the debounce window, and the immediate save diffed {40, true} against an album that already
// said 40 -- the flip went out, the radius did not, and the per-photo override reset fired for a
// value the server never received. A review traced it with a rendered component. This is the
// baseline done right: `confirmed` is what the server last acknowledged and nothing else moves it.

export type MediaDraftState = {
  /** What the server last acknowledged. Moves only on a successful save or a change from elsewhere. */
  confirmed: MediaSettingsSnapshot
  /** What the owner sees and is about to have saved. */
  draft: MediaSettingsSnapshot
}

const KEYS = ['media_radius', 'video_autoplay', 'media_filter', 'mobile_grid_columns', 'slideshow_interval_ms', 'slideshow_animation'] as const

export function initialMediaDraft(confirmed: MediaSettingsSnapshot): MediaDraftState {
  return { confirmed, draft: { ...confirmed } }
}

/** The owner changed something: only the draft moves. */
export function editMediaDraft(state: MediaDraftState, patch: Partial<MediaSettingsSnapshot>): MediaDraftState {
  return { confirmed: state.confirmed, draft: { ...state.draft, ...patch } }
}

/**
 * The album prop changed. Per field, three cases:
 *   - equals confirmed: nothing happened.
 *   - equals the draft (and not confirmed): our own optimistic patch echoed back. NOT a confirmation
 *     -- the server has not spoken -- so confirmed stays put and the save still goes out.
 *   - neither: a change from elsewhere (another device, a refetch). It becomes confirmed; the draft
 *     follows only if it was pristine, so an edit in progress is never wiped -- and the next save
 *     will diff the edit against the new truth and send it, last writer wins WITH intent.
 */
export function adoptIncomingMedia(state: MediaDraftState, incoming: MediaSettingsSnapshot): MediaDraftState {
  const confirmed = { ...state.confirmed }
  const draft = { ...state.draft }
  let changed = false
  for (const k of KEYS) {
    const value = incoming[k]
    if (value === state.confirmed[k] || value === state.draft[k]) continue
    const pristine = state.draft[k] === state.confirmed[k]
    ;(confirmed as Record<string, unknown>)[k] = value
    if (pristine) (draft as Record<string, unknown>)[k] = value
    changed = true
  }
  // The same object back when nothing moved: the component reconciles during render and must be
  // able to tell "nothing to do" apart from "set state" without a second comparison.
  return changed ? { confirmed, draft } : state
}

export type MediaSavePlan = {
  changes: Partial<MediaSettingsSnapshot>
  resetRadiusOverrides: boolean
  resetFilterOverrides: boolean
}

/** What one save sends, or null when the draft and the confirmed values agree. */
export function planMediaSave(state: MediaDraftState): MediaSavePlan | null {
  const changes = diffMediaSettings(state.confirmed, state.draft)
  const resetRadiusOverrides = state.draft.media_radius !== state.confirmed.media_radius
  const resetFilterOverrides = state.draft.media_filter !== state.confirmed.media_filter
  if (Object.keys(changes).length === 0 && !resetRadiusOverrides && !resetFilterOverrides) return null
  return { changes, resetRadiusOverrides, resetFilterOverrides }
}

/**
 * The server applied these: they are confirmed now. The draft follows the server too -- it may
 * have clamped what was sent -- but only on a field the owner has not touched again since the
 * request left, so an edit made while the save was in flight is kept and goes out next.
 */
export function confirmMediaSaved(
  state: MediaDraftState,
  sent: Partial<MediaSettingsSnapshot>,
  applied: Partial<MediaSettingsSnapshot>,
): MediaDraftState {
  const draft = { ...state.draft }
  for (const k of KEYS) {
    if (!(k in applied)) continue
    if (state.draft[k] === sent[k]) (draft as Record<string, unknown>)[k] = applied[k]
  }
  return { confirmed: { ...state.confirmed, ...applied }, draft }
}

/**
 * The save failed: every field the attempt carried goes back to confirmed, so the grid shows the
 * truth and the owner's next try starts from it -- except a field the owner has already moved
 * again, which keeps its newer value (that edit scheduled its own save). `patch` is what the album
 * must be told, so the optimistic value leaves the page too. A failed save used to leave that
 * value in the album with the baseline already moved, so it was never sent again.
 */
export function revertMediaSave(
  state: MediaDraftState,
  sent: Partial<MediaSettingsSnapshot>,
): { state: MediaDraftState; patch: Partial<MediaSettingsSnapshot> } {
  const draft = { ...state.draft }
  const patch: Partial<MediaSettingsSnapshot> = {}
  for (const k of KEYS) {
    if (!(k in sent) || state.draft[k] !== sent[k]) continue
    ;(draft as Record<string, unknown>)[k] = state.confirmed[k]
    ;(patch as Record<string, unknown>)[k] = state.confirmed[k]
  }
  return { state: { confirmed: state.confirmed, draft }, patch }
}
