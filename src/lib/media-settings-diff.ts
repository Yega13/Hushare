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
// so the baseline moved before the save did: drag the radius to 40, flip autoplay inside the
// debounce window, and the immediate save diffed {40, true} against an album that already said 40
// -- the flip went out, the radius did not, and the per-photo override reset fired for a value the
// server never received. A review traced it with a rendered component. This is the baseline done
// right: `confirmed` is what the server last acknowledged and nothing else moves it.
//
// ONE REQUEST AT A TIME. The first version of this machine let a second request go out while one
// was on the wire, and a review broke it two ways inside a single round trip: ON then OFF left the
// server ON with the switch saying OFF (the OFF planned as "no change" and nothing re-planned when
// the ON landed), and a failed first request reverted a field a later successful one carried. With
// two requests out, their answers can land in either order and the database can apply them in
// either order, and no client-side reconciliation can see which. So `inFlight` records the one
// request that is out, nothing is planned while it is, and the component re-plans when it lands.

export type MediaDraftState = {
  /** What the server last acknowledged. Moves only on a successful save or a change from elsewhere. */
  confirmed: MediaSettingsSnapshot
  /** What the owner sees and is about to have saved. */
  draft: MediaSettingsSnapshot
  /**
   * The ONE request on the wire (what it carried), or null. planMediaSave is null while it is set.
   * Whatever the owner does meanwhile waits in the draft; the settle step after the answer picks
   * it up.
   */
  inFlight: Partial<MediaSettingsSnapshot> | null
}

const KEYS = ['media_radius', 'video_autoplay', 'media_filter', 'mobile_grid_columns', 'slideshow_interval_ms', 'slideshow_animation'] as const

export function initialMediaDraft(confirmed: MediaSettingsSnapshot): MediaDraftState {
  return { confirmed, draft: { ...confirmed }, inFlight: null }
}

/** The owner changed something: only the draft moves. */
export function editMediaDraft(state: MediaDraftState, patch: Partial<MediaSettingsSnapshot>): MediaDraftState {
  return { confirmed: state.confirmed, draft: { ...state.draft, ...patch }, inFlight: state.inFlight }
}

/**
 * The album prop changed. Per field, four cases:
 *   - equals confirmed: nothing happened.
 *   - equals the draft (and not confirmed): our own optimistic patch echoed back. NOT a confirmation
 *     -- the server has not spoken -- so confirmed stays put and the save still goes out.
 *   - equals what is in flight: our own request's value, arriving through a side channel (a
 *     broadcast refetch) before our own answer, after the owner already moved the draft on. Also
 *     an echo: treating it as remote would call the draft "pristine" and wipe the owner's newer
 *     value. Our own answer, seconds away, is what confirms it.
 *   - none of those: a change from elsewhere (another device, a refetch). It becomes confirmed; the
 *     draft follows only if it was pristine, so an edit in progress is never wiped -- and the next
 *     save will diff the edit against the new truth and send it, last writer wins WITH intent.
 */
export function adoptIncomingMedia(state: MediaDraftState, incoming: MediaSettingsSnapshot): MediaDraftState {
  const confirmed = { ...state.confirmed }
  const draft = { ...state.draft }
  let changed = false
  for (const k of KEYS) {
    const value = incoming[k]
    if (value === state.confirmed[k] || value === state.draft[k] || value === state.inFlight?.[k]) continue
    const pristine = state.draft[k] === state.confirmed[k]
    ;(confirmed as Record<string, unknown>)[k] = value
    if (pristine) (draft as Record<string, unknown>)[k] = value
    changed = true
  }
  // The same object back when nothing moved: the component reconciles during render and must be
  // able to tell "nothing to do" apart from "set state" without a second comparison.
  return changed ? { confirmed, draft, inFlight: state.inFlight } : state
}

export type MediaSavePlan = {
  changes: Partial<MediaSettingsSnapshot>
  resetRadiusOverrides: boolean
  resetFilterOverrides: boolean
}

/** What one save sends: null while a request is out, or when the draft and confirmed agree. */
export function planMediaSave(state: MediaDraftState): MediaSavePlan | null {
  if (state.inFlight !== null) return null
  const changes = diffMediaSettings(state.confirmed, state.draft)
  const resetRadiusOverrides = state.draft.media_radius !== state.confirmed.media_radius
  const resetFilterOverrides = state.draft.media_filter !== state.confirmed.media_filter
  if (Object.keys(changes).length === 0 && !resetRadiusOverrides && !resetFilterOverrides) return null
  return { changes, resetRadiusOverrides, resetFilterOverrides }
}

/** Plan AND mark it on the wire in one step, so the component cannot send without recording. */
export function beginMediaSave(state: MediaDraftState): { state: MediaDraftState; plan: MediaSavePlan } | null {
  const plan = planMediaSave(state)
  if (!plan) return null
  return { state: { confirmed: state.confirmed, draft: state.draft, inFlight: plan.changes }, plan }
}

/**
 * The request landed with a 200. Everything it carried is confirmed (this route writes every field
 * in the body or refuses the whole request; a key missing from its echo is a gap in the echo, not a
 * refusal, and treating it as unconfirmed would re-send it forever), refined by what the server says
 * it applied -- it may have clamped. The draft follows the server only on a field the owner has not
 * touched again since the request left, so an edit made in flight is kept and goes out next.
 * `patch` is what the album must be told: the draft's value of every applied field, so the grid
 * never jumps back to the server's value for one round trip on a field the owner already moved on.
 */
export function confirmMediaSaved(
  state: MediaDraftState,
  applied: Partial<MediaSettingsSnapshot>,
): { state: MediaDraftState; patch: Partial<MediaSettingsSnapshot> } {
  const sent = state.inFlight ?? {}
  const draft = { ...state.draft }
  const patch: Partial<MediaSettingsSnapshot> = {}
  for (const k of KEYS) {
    if (!(k in applied)) continue
    if (state.draft[k] === sent[k]) (draft as Record<string, unknown>)[k] = applied[k]
    ;(patch as Record<string, unknown>)[k] = draft[k]
  }
  return { state: { confirmed: { ...state.confirmed, ...sent, ...applied }, draft, inFlight: null }, patch }
}

/**
 * The request failed: every field it carried goes back to confirmed, so the grid shows the truth
 * and the owner's next try starts from it -- except a field the owner has already moved again,
 * which keeps its newer value (the settle step sends it). `patch` is what the album must be told,
 * so the optimistic value leaves the page too. A failed save used to leave that value in the album
 * with the baseline already moved, so it was never sent again.
 */
export function revertMediaSave(
  state: MediaDraftState,
): { state: MediaDraftState; patch: Partial<MediaSettingsSnapshot> } {
  const carried = state.inFlight ?? {}
  const draft = { ...state.draft }
  const patch: Partial<MediaSettingsSnapshot> = {}
  for (const k of KEYS) {
    if (!(k in carried) || state.draft[k] !== carried[k]) continue
    ;(draft as Record<string, unknown>)[k] = state.confirmed[k]
    ;(patch as Record<string, unknown>)[k] = state.confirmed[k]
  }
  return { state: { confirmed: state.confirmed, draft, inFlight: null }, patch }
}
