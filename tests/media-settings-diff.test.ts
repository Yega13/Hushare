import { describe, it, expect } from 'vitest'
import { confirmedMediaSettings, diffMediaSettings } from '../src/lib/media-settings-diff'

const ALBUM = {
  media_radius: 16,
  video_autoplay: false,
  media_filter: 'none',
  mobile_grid_columns: 3,
  desktop_grid_columns: 6,
  slideshow_interval_ms: 4000,
  slideshow_animation: 'fade',
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
      ...confirmed, media_radius: 0, video_autoplay: true, slideshow_animation: 'slide',
    })
    expect(changes).toEqual({ media_radius: 0, video_autoplay: true, slideshow_animation: 'slide' })
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
