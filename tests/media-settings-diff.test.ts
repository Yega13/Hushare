import { describe, it, expect } from 'vitest'
import { confirmedMediaSettings, diffMediaSettings } from '../src/lib/media-settings-diff'

// Typed as the Album's own aliases: the test used to pass 'slide' as an animation, which is a
// slideshow MOVE, not an animation, and a loose `string` in the snapshot let it through.
const ALBUM = {
  media_radius: 16,
  video_autoplay: false,
  media_filter: 'none' as const,
  mobile_grid_columns: 3 as const,
  desktop_grid_columns: 6,
  slideshow_interval_ms: 4000,
  slideshow_animation: 'fade' as const,
}
const INTERVAL_DEFAULT = 4000

describe('diffMediaSettings — the fix for the grid "merge"', () => {
  it('an untouched grid NEVER goes on the wire', () => {
    // THE BUG: every save posted all seven fields from local state, so a stale tab re-wrote the
    // phone grid whenever the owner dragged the radius. Desktop 6 + phone 3 became 6/6 "after
    // time". A radius-only change must produce a radius-only payload.
    const confirmed = confirmedMediaSettings(ALBUM, INTERVAL_DEFAULT)
    const changes = diffMediaSettings(confirmed, { ...confirmed, media_radius: 24 })
    expect(changes).toEqual({ media_radius: 24 })
    expect('mobile_grid_columns' in changes).toBe(false)
  })

  it('a real grid change does go on the wire, alone', () => {
    const confirmed = confirmedMediaSettings(ALBUM, INTERVAL_DEFAULT)
    expect(diffMediaSettings(confirmed, { ...confirmed, mobile_grid_columns: 5 }))
      .toEqual({ mobile_grid_columns: 5 })
  })

  it('nothing changed means an EMPTY object — the caller must then send nothing', () => {
    const confirmed = confirmedMediaSettings(ALBUM, INTERVAL_DEFAULT)
    expect(diffMediaSettings(confirmed, { ...confirmed })).toEqual({})
  })

  it('several real changes all travel', () => {
    const confirmed = confirmedMediaSettings(ALBUM, INTERVAL_DEFAULT)
    const changes = diffMediaSettings(confirmed, {
      ...confirmed, media_radius: 0, video_autoplay: true, slideshow_animation: 'rise',
    })
    expect(changes).toEqual({ media_radius: 0, video_autoplay: true, slideshow_animation: 'rise' })
  })
})

describe('confirmedMediaSettings — must normalise exactly the way the UI initialises', () => {
  it('applies the same defaults the controls start from', () => {
    // If these ever diverge from the useState initialisers, an untouched control reads as a
    // change and gets written — the same stale-write bug through a different door.
    const c = confirmedMediaSettings({}, INTERVAL_DEFAULT)
    expect(c.media_radius).toBe(16)
    expect(c.video_autoplay).toBe(false)
    expect(c.media_filter).toBe('none')
    expect(c.mobile_grid_columns).toBe(3)      // MOBILE_COLUMNS_FALLBACK
    expect(c.slideshow_interval_ms).toBe(INTERVAL_DEFAULT)
    expect(c.slideshow_animation).toBe('fade')
  })

  it('reads the mobile grid through the same resolver the grid renders with', () => {
    expect(confirmedMediaSettings({ mobile_grid_columns: 5 }, INTERVAL_DEFAULT).mobile_grid_columns).toBe(5)
    // An out-of-range stored value resolves to the fallback, exactly as the grid renders it —
    // so the diff compares against what the owner actually SEES, not a raw stored number.
    expect(confirmedMediaSettings({ mobile_grid_columns: 12 }, INTERVAL_DEFAULT).mobile_grid_columns).toBe(3)
  })
})

// THE CONFIRMED / DRAFT MACHINE. A rendered-component review traced the baseline bug: the panel
// diffed against an album it had ALREADY patched optimistically, so a radius drag followed by an
// autoplay flip inside the debounce window sent the flip and dropped the radius -- while still
// resetting every per-photo radius override for a value the server never got.
import {
  adoptIncomingMedia, confirmMediaSaved, editMediaDraft, initialMediaDraft, planMediaSave, revertMediaSave,
} from '../src/lib/media-settings-diff'

const CONFIRMED = confirmedMediaSettings(ALBUM, INTERVAL_DEFAULT)

describe('the media draft machine -- what a save sends is the draft against what the SERVER said', () => {
  it('starts with nothing to save', () => {
    expect(planMediaSave(initialMediaDraft(CONFIRMED))).toBeNull()
  })

  it('THE TRACE: drag the radius, see it echo back through the album, flip autoplay -- both travel', () => {
    let s = initialMediaDraft(CONFIRMED)
    s = editMediaDraft(s, { media_radius: 40 })
    // The panel patches the album so the grid redraws live; the prop comes back with 40 in it.
    s = adoptIncomingMedia(s, { ...CONFIRMED, media_radius: 40 })
    s = editMediaDraft(s, { video_autoplay: true })
    s = adoptIncomingMedia(s, { ...CONFIRMED, media_radius: 40, video_autoplay: true })
    expect(planMediaSave(s)).toEqual({
      changes: { media_radius: 40, video_autoplay: true },
      resetRadiusOverrides: true,
      resetFilterOverrides: false,
    })
  })

  it('an optimistic echo is NOT a confirmation: confirmed stays where the server left it', () => {
    let s = initialMediaDraft(CONFIRMED)
    s = editMediaDraft(s, { media_filter: 'mono' })
    s = adoptIncomingMedia(s, { ...CONFIRMED, media_filter: 'mono' })
    expect(s.confirmed.media_filter).toBe('none')
    expect(planMediaSave(s)).toEqual({ changes: { media_filter: 'mono' }, resetRadiusOverrides: false, resetFilterOverrides: true })
  })

  it('a change from ELSEWHERE becomes confirmed and, on a pristine field, shows in the draft', () => {
    let s = initialMediaDraft(CONFIRMED)
    s = adoptIncomingMedia(s, { ...CONFIRMED, mobile_grid_columns: 5 })
    expect(s.confirmed.mobile_grid_columns).toBe(5)
    expect(s.draft.mobile_grid_columns).toBe(5)
    // ...and nothing goes back on the wire for it: that was the "stale tab re-writes the phone grid" bug.
    expect(planMediaSave(s)).toBeNull()
  })

  it('a change from elsewhere does NOT wipe an edit in progress on the same field', () => {
    let s = initialMediaDraft(CONFIRMED)
    s = editMediaDraft(s, { slideshow_interval_ms: 6000 })
    s = adoptIncomingMedia(s, { ...CONFIRMED, slideshow_interval_ms: 9000 })
    expect(s.confirmed.slideshow_interval_ms).toBe(9000)
    expect(s.draft.slideshow_interval_ms).toBe(6000)
    // The owner's intent still goes out, diffed against the NEW truth.
    expect(planMediaSave(s)?.changes).toEqual({ slideshow_interval_ms: 6000 })
  })

  it('a change from elsewhere on one field leaves the others alone', () => {
    let s = initialMediaDraft(CONFIRMED)
    s = editMediaDraft(s, { media_radius: 22 })
    s = adoptIncomingMedia(s, { ...CONFIRMED, media_radius: 22, video_autoplay: true })
    expect(s.confirmed).toEqual({ ...CONFIRMED, video_autoplay: true })
    expect(s.draft).toEqual({ ...CONFIRMED, media_radius: 22, video_autoplay: true })
    expect(planMediaSave(s)).toEqual({ changes: { media_radius: 22 }, resetRadiusOverrides: true, resetFilterOverrides: false })
  })

  it('a successful save confirms what was applied, and then there is nothing left to send', () => {
    let s = initialMediaDraft(CONFIRMED)
    s = editMediaDraft(s, { media_radius: 40, video_autoplay: true })
    const plan = planMediaSave(s)!
    s = confirmMediaSaved(s, plan.changes, plan.changes)
    expect(s.confirmed).toEqual({ ...CONFIRMED, media_radius: 40, video_autoplay: true })
    expect(planMediaSave(s)).toBeNull()
  })

  it('a save confirms only what it carried: an edit made DURING the request is still pending after it', () => {
    let s = initialMediaDraft(CONFIRMED)
    s = editMediaDraft(s, { media_radius: 40 })
    const plan = planMediaSave(s)!
    s = editMediaDraft(s, { video_autoplay: true })     // flipped while the request was in flight
    s = confirmMediaSaved(s, plan.changes, plan.changes)
    expect(planMediaSave(s)).toEqual({ changes: { video_autoplay: true }, resetRadiusOverrides: false, resetFilterOverrides: false })
  })

  it('the server may apply something other than what was asked (a clamp): the draft follows the server', () => {
    let s = initialMediaDraft(CONFIRMED)
    s = editMediaDraft(s, { media_radius: 999 })
    const plan = planMediaSave(s)!
    s = confirmMediaSaved(s, plan.changes, { media_radius: 64 })
    expect(s.confirmed.media_radius).toBe(64)
    expect(s.draft.media_radius).toBe(64)
    expect(planMediaSave(s)).toBeNull()      // and 999 is NOT silently re-sent forever
  })

  it('a clamp from the server does not overwrite a field the owner moved again in flight', () => {
    let s = initialMediaDraft(CONFIRMED)
    s = editMediaDraft(s, { media_radius: 999 })
    const plan = planMediaSave(s)!
    s = editMediaDraft(s, { media_radius: 30 })         // dragged again before the answer came
    s = confirmMediaSaved(s, plan.changes, { media_radius: 64 })
    expect(s.confirmed.media_radius).toBe(64)
    expect(s.draft.media_radius).toBe(30)
    expect(planMediaSave(s)?.changes).toEqual({ media_radius: 30 })
  })

  it('a FAILED save puts every field it carried back to the truth, and says what the album must be told', () => {
    let s = initialMediaDraft(CONFIRMED)
    s = editMediaDraft(s, { video_autoplay: true })
    const plan = planMediaSave(s)!
    const r = revertMediaSave(s, plan.changes)
    expect(r.state.draft.video_autoplay).toBe(false)
    expect(r.patch).toEqual({ video_autoplay: false })
    expect(planMediaSave(r.state)).toBeNull()
  })

  it('a failed save reverts ONLY the fields it carried', () => {
    let s = initialMediaDraft(CONFIRMED)
    s = editMediaDraft(s, { video_autoplay: true })
    const plan = planMediaSave(s)!
    s = editMediaDraft(s, { media_radius: 30 })          // a later edit, not part of the failed request
    const r = revertMediaSave(s, plan.changes)
    expect(r.state.draft).toEqual({ ...CONFIRMED, media_radius: 30 })
    expect(r.patch).toEqual({ video_autoplay: false })
  })

  it('a failed save leaves alone a field the owner moved AGAIN while it was in flight', () => {
    let s = initialMediaDraft(CONFIRMED)
    s = editMediaDraft(s, { media_radius: 40 })
    const plan = planMediaSave(s)!
    s = editMediaDraft(s, { media_radius: 24 })          // that edit scheduled its own save
    const r = revertMediaSave(s, plan.changes)
    expect(r.state.draft.media_radius).toBe(24)
    expect(r.patch).toEqual({})
  })

  it('adopting an album that says nothing new returns the SAME state object (the render reconcile relies on it)', () => {
    const s0 = initialMediaDraft(CONFIRMED)
    expect(adoptIncomingMedia(s0, { ...CONFIRMED })).toBe(s0)
    const s1 = editMediaDraft(s0, { media_radius: 40 })
    expect(adoptIncomingMedia(s1, { ...CONFIRMED, media_radius: 40 })).toBe(s1)
    expect(adoptIncomingMedia(s1, { ...CONFIRMED, media_radius: 41 })).not.toBe(s1)
  })

  it('a radius put BACK to the confirmed value has nothing to save and resets no overrides', () => {
    let s = initialMediaDraft(CONFIRMED)
    s = editMediaDraft(s, { media_radius: 40 })
    s = editMediaDraft(s, { media_radius: 16 })
    expect(planMediaSave(s)).toBeNull()
  })

  it('editing never moves confirmed; confirming never moves the draft', () => {
    const s0 = initialMediaDraft(CONFIRMED)
    const s1 = editMediaDraft(s0, { media_filter: 'mono' })
    expect(s1.confirmed).toBe(s0.confirmed)
    const s2 = confirmMediaSaved(s1, { media_filter: 'mono' }, { media_filter: 'mono' })
    expect(s2.draft).toEqual(s1.draft)
    expect(s2.confirmed.media_filter).toBe('mono')
  })
})
