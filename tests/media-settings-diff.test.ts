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
// resetting every per-photo radius override for a value the server never got. A second review
// broke the first machine inside one round trip (ON then OFF; a failed request reverting a field a
// later one carried), which is why there is now exactly one request in flight.
import {
  adoptIncomingMedia, beginMediaSave, confirmMediaSaved, editMediaDraft, initialMediaDraft, planMediaSave, revertMediaSave,
} from '../src/lib/media-settings-diff'

const CONFIRMED = confirmedMediaSettings(ALBUM, INTERVAL_DEFAULT)
const NO_RESET = { resetRadiusOverrides: false, resetFilterOverrides: false }

describe('the media draft machine -- what a save sends is the draft against what the SERVER said', () => {
  it('starts with nothing to save and nothing on the wire', () => {
    const s = initialMediaDraft(CONFIRMED)
    expect(planMediaSave(s)).toBeNull()
    expect(s.inFlight).toBeNull()
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

  it('editing never moves confirmed; confirming never moves confirmed away from what was sent', () => {
    const s0 = initialMediaDraft(CONFIRMED)
    const s1 = editMediaDraft(s0, { media_filter: 'mono' })
    expect(s1.confirmed).toBe(s0.confirmed)
    const b = beginMediaSave(s1)!
    const r = confirmMediaSaved(b.state, { media_filter: 'mono' })
    expect(r.state.draft).toEqual(s1.draft)
    expect(r.state.confirmed.media_filter).toBe('mono')
  })
})

describe('one request at a time', () => {
  it('beginning a save records what is on the wire, and nothing else is planned until it lands', () => {
    let s = editMediaDraft(initialMediaDraft(CONFIRMED), { video_autoplay: true })
    const b = beginMediaSave(s)!
    expect(b.plan.changes).toEqual({ video_autoplay: true })
    expect(b.state.inFlight).toEqual({ video_autoplay: true })
    s = editMediaDraft(b.state, { video_autoplay: false })
    expect(planMediaSave(s)).toBeNull()
    expect(beginMediaSave(s)).toBeNull()
    expect(s.inFlight).toEqual({ video_autoplay: true })
  })

  it('ON then OFF inside one round trip: the OFF is what goes next, and the album is told OFF, not ON', () => {
    // The first machine planned the OFF as "no change" (draft equalled confirmed) and never
    // re-planned when the ON landed: server ON, grid autoplaying, switch saying OFF.
    let s = editMediaDraft(initialMediaDraft(CONFIRMED), { video_autoplay: true })
    const b = beginMediaSave(s)!
    s = editMediaDraft(b.state, { video_autoplay: false })
    const r = confirmMediaSaved(s, { video_autoplay: true })
    expect(r.state.confirmed.video_autoplay).toBe(true)
    expect(r.state.draft.video_autoplay).toBe(false)
    expect(r.patch).toEqual({ video_autoplay: false })
    expect(planMediaSave(r.state)).toEqual({ changes: { video_autoplay: false }, ...NO_RESET })
  })

  it('the slider dragged 16 -> 40 and back to 16 inside one round trip: 16 goes out, with the override reset', () => {
    let s = editMediaDraft(initialMediaDraft(CONFIRMED), { media_radius: 40 })
    const b = beginMediaSave(s)!
    s = editMediaDraft(b.state, { media_radius: 16 })
    const r = confirmMediaSaved(s, { media_radius: 40 })
    expect(r.patch).toEqual({ media_radius: 16 })
    expect(planMediaSave(r.state)).toEqual({ changes: { media_radius: 16 }, resetRadiusOverrides: true, resetFilterOverrides: false })
  })

  it('the only request fails: the radius reverts, and the flip made in flight goes next, alone', () => {
    // With two requests out, a failed first one reverted a field the second carried and the
    // server had accepted. There is no second one now.
    let s = editMediaDraft(initialMediaDraft(CONFIRMED), { media_radius: 40 })
    const b = beginMediaSave(s)!
    s = editMediaDraft(b.state, { video_autoplay: true })
    expect(beginMediaSave(s)).toBeNull()
    const r = revertMediaSave(s)
    expect(r.state.draft).toEqual({ ...CONFIRMED, video_autoplay: true })
    expect(r.patch).toEqual({ media_radius: 16 })
    expect(r.state.inFlight).toBeNull()
    expect(planMediaSave(r.state)).toEqual({ changes: { video_autoplay: true }, ...NO_RESET })
  })

  it("the album's copy of our own in-flight value is an echo, not a change from elsewhere", () => {
    let s = editMediaDraft(initialMediaDraft(CONFIRMED), { media_radius: 40 })
    const b = beginMediaSave(s)!
    s = editMediaDraft(b.state, { media_radius: 16 })
    // A broadcast refetch brings the 40 the server already wrote, before our own answer.
    expect(adoptIncomingMedia(s, { ...CONFIRMED, media_radius: 40 })).toBe(s)
    const r = confirmMediaSaved(s, { media_radius: 40 })
    expect(planMediaSave(r.state)?.changes).toEqual({ media_radius: 16 })
  })

  it('a change from elsewhere during a request neither opens a second request nor forgets the first', () => {
    const b = beginMediaSave(editMediaDraft(initialMediaDraft(CONFIRMED), { media_radius: 40 }))!
    const s = adoptIncomingMedia(b.state, { ...CONFIRMED, mobile_grid_columns: 5 })
    expect(s.confirmed.mobile_grid_columns).toBe(5)
    expect(s.draft.mobile_grid_columns).toBe(5)
    expect(s.inFlight).toEqual({ media_radius: 40 })
    expect(planMediaSave(s)).toBeNull()
    expect(confirmMediaSaved(s, { media_radius: 40 }).state.draft.media_radius).toBe(40)
  })

  it('a 200 whose echo omits what was sent confirms what was sent -- it is not re-sent forever', () => {
    const b = beginMediaSave(editMediaDraft(initialMediaDraft(CONFIRMED), { media_radius: 40 }))!
    const r = confirmMediaSaved(b.state, {})
    expect(r.state.confirmed.media_radius).toBe(40)
    expect(r.state.draft.media_radius).toBe(40)
    expect(r.patch).toEqual({})
    expect(planMediaSave(r.state)).toBeNull()
  })

  it('a field the route echoes that this machine does not own (the desktop pin) never enters confirmed', () => {
    const b = beginMediaSave(editMediaDraft(initialMediaDraft(CONFIRMED), { mobile_grid_columns: 2 }))!
    const r = confirmMediaSaved(b.state, { mobile_grid_columns: 2, desktop_grid_columns: 6 } as Parameters<typeof confirmMediaSaved>[1])
    expect(Object.keys(r.state.confirmed).sort()).toEqual(Object.keys(CONFIRMED).sort())
    expect(r.state.confirmed.mobile_grid_columns).toBe(2)
    expect(r.patch).toEqual({ mobile_grid_columns: 2 })
  })

  it('a successful save confirms what was applied and tells the album, and then there is nothing left to send', () => {
    const b = beginMediaSave(editMediaDraft(initialMediaDraft(CONFIRMED), { media_radius: 40, video_autoplay: true }))!
    const r = confirmMediaSaved(b.state, b.plan.changes)
    expect(r.state.confirmed).toEqual({ ...CONFIRMED, media_radius: 40, video_autoplay: true })
    expect(r.patch).toEqual({ media_radius: 40, video_autoplay: true })
    expect(r.state.inFlight).toBeNull()
    expect(planMediaSave(r.state)).toBeNull()
  })

  it('a save confirms only what it carried: an edit made DURING the request is still pending after it', () => {
    const b = beginMediaSave(editMediaDraft(initialMediaDraft(CONFIRMED), { media_radius: 40 }))!
    const s = editMediaDraft(b.state, { video_autoplay: true })     // flipped while the request was in flight
    const r = confirmMediaSaved(s, b.plan.changes)
    expect(planMediaSave(r.state)).toEqual({ changes: { video_autoplay: true }, ...NO_RESET })
  })

  it('the server may apply something other than what was asked (a clamp): the draft follows the server', () => {
    const b = beginMediaSave(editMediaDraft(initialMediaDraft(CONFIRMED), { media_radius: 999 }))!
    const r = confirmMediaSaved(b.state, { media_radius: 64 })
    expect(r.state.confirmed.media_radius).toBe(64)
    expect(r.state.draft.media_radius).toBe(64)
    expect(r.patch).toEqual({ media_radius: 64 })
    expect(planMediaSave(r.state)).toBeNull()      // and 999 is NOT silently re-sent forever
  })

  it('a clamp on a field the owner moved again in flight settles in exactly one more request', () => {
    let b = beginMediaSave(editMediaDraft(initialMediaDraft(CONFIRMED), { media_radius: 999 }))!
    const s = editMediaDraft(b.state, { media_radius: 30 })      // dragged again before the answer came
    let r = confirmMediaSaved(s, { media_radius: 64 })
    expect(r.state.confirmed.media_radius).toBe(64)
    expect(r.state.draft.media_radius).toBe(30)
    expect(r.patch).toEqual({ media_radius: 30 })              // the album is told the OWNER's value
    expect(planMediaSave(r.state)?.changes).toEqual({ media_radius: 30 })
    b = beginMediaSave(r.state)!
    r = confirmMediaSaved(b.state, { media_radius: 64 })
    expect(r.state.draft.media_radius).toBe(64)
    expect(planMediaSave(r.state)).toBeNull()
  })

  it('a FAILED save puts every field it carried back to the truth, and says what the album must be told', () => {
    const b = beginMediaSave(editMediaDraft(initialMediaDraft(CONFIRMED), { video_autoplay: true }))!
    const r = revertMediaSave(b.state)
    expect(r.state.draft.video_autoplay).toBe(false)
    expect(r.patch).toEqual({ video_autoplay: false })
    expect(planMediaSave(r.state)).toBeNull()
  })

  it('a failed save reverts ONLY the fields it carried', () => {
    const b = beginMediaSave(editMediaDraft(initialMediaDraft(CONFIRMED), { video_autoplay: true }))!
    const s = editMediaDraft(b.state, { media_radius: 30 })          // a later edit, not part of the failed request
    const r = revertMediaSave(s)
    expect(r.state.draft).toEqual({ ...CONFIRMED, media_radius: 30 })
    expect(r.patch).toEqual({ video_autoplay: false })
  })

  it('a failed save leaves alone a field the owner moved AGAIN while it was in flight, and that value goes next', () => {
    const b = beginMediaSave(editMediaDraft(initialMediaDraft(CONFIRMED), { media_radius: 40 }))!
    const s = editMediaDraft(b.state, { media_radius: 24 })
    const r = revertMediaSave(s)
    expect(r.state.draft.media_radius).toBe(24)
    expect(r.patch).toEqual({})
    expect(planMediaSave(r.state)?.changes).toEqual({ media_radius: 24 })
  })
})
