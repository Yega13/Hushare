import { describe, it, expect } from 'vitest'
import { onSettingsBroadcast, shouldCommitSettings } from '@/lib/settings-sync'

// THE FLICKER: "control moves to the new value, snaps back to the old one, then settles."
//
// Every owner mutation broadcasts, and the owner's own tab listens to that broadcast. So each edit
// made the tab refetch and merge the whole album row back over its own optimistic state. Two edits
// inside one round trip — or one debounced slider firing twice — and the first response lands after
// the second edit and overwrites it with the pre-edit row.
//
// It only ever showed up on a phone, because the race window is exactly one network round trip
// wide. Which is also why nobody could reproduce it deliberately, and why these rules had to leave
// the component to be worth anything.
const QUIET = 2500
const NOW = 1_000_000

describe('a broadcast that is really my own edit coming back', () => {
  it('is not acted on immediately', () => {
    // The bug itself. A broadcast 100ms after this tab's own edit is that edit echoing; refetching
    // now races the owner's next keystroke and can overwrite it.
    const a = onSettingsBroadcast({ designerOpen: false, now: NOW, lastLocalEditAt: NOW - 100, quietMs: QUIET })
    expect(a.kind).toBe('schedule')
  })

  it('is deferred, NOT dropped', () => {
    // The distinction that keeps a second device working. If the echo were simply ignored, a real
    // change made from another phone during the quiet window would be lost until a reload.
    const a = onSettingsBroadcast({ designerOpen: false, now: NOW, lastLocalEditAt: NOW - 100, quietMs: QUIET })
    if (a.kind !== 'schedule') throw new Error('expected schedule')
    expect(a.delayMs, 'waits out the remainder of the quiet window, then fetches once').toBe(QUIET - 100)
  })

  it('pushes the wait out as the owner keeps editing', () => {
    // A dragged slider fires repeatedly. Each broadcast should reset the wait so exactly one fetch
    // happens after they stop, not one per broadcast.
    const early = onSettingsBroadcast({ designerOpen: false, now: NOW, lastLocalEditAt: NOW - 2400, quietMs: QUIET })
    const late = onSettingsBroadcast({ designerOpen: false, now: NOW, lastLocalEditAt: NOW - 10, quietMs: QUIET })
    if (early.kind !== 'schedule' || late.kind !== 'schedule') throw new Error('expected schedule')
    expect(late.delayMs).toBeGreaterThan(early.delayMs)
  })
})

describe('a broadcast that is genuine news', () => {
  it('is fetched straight away', () => {
    expect(onSettingsBroadcast({ designerOpen: false, now: NOW, lastLocalEditAt: NOW - QUIET, quietMs: QUIET }).kind).toBe('refetch')
    expect(onSettingsBroadcast({ designerOpen: false, now: NOW, lastLocalEditAt: 0, quietMs: QUIET }).kind).toBe('refetch')
  })

  it('holds at the edge of the quiet window', () => {
    // Exactly quietMs after the edit is no longer an echo. An off-by-one here means either a
    // permanent extra delay on every change, or the flicker coming back.
    expect(onSettingsBroadcast({ designerOpen: false, now: NOW, lastLocalEditAt: NOW - QUIET, quietMs: QUIET }).kind).toBe('refetch')
    expect(onSettingsBroadcast({ designerOpen: false, now: NOW, lastLocalEditAt: NOW - QUIET + 1, quietMs: QUIET }).kind).toBe('schedule')
  })
})

describe('the Album Designer is never overwritten while it is open', () => {
  it('owes the refetch instead of doing it, whatever else is true', () => {
    // The Designer shows a live optimistic preview. A refetch landing under it replaces what the
    // owner is looking at with the saved row — the same glitch, but while they are watching.
    for (const lastLocalEditAt of [0, NOW - 10, NOW - 999_999]) {
      expect(onSettingsBroadcast({ designerOpen: true, now: NOW, lastLocalEditAt, quietMs: QUIET }).kind)
        .toBe('owe')
    }
  })
})

describe('a response that arrived too late is not applied', () => {
  const base = { disposed: false, hasValidData: true, requestStartedAt: NOW, lastLocalEditAt: NOW - 5000 }

  it('commits a response that nothing has superseded', () => {
    expect(shouldCommitSettings(base)).toBe(true)
  })

  it('drops a response overtaken by the owner\'s own edit', () => {
    // The actual overwrite. The edit happened after the request went out, so the response cannot
    // contain it — applying it puts the pre-edit value back on screen.
    expect(shouldCommitSettings({ ...base, lastLocalEditAt: NOW + 1 })).toBe(false)
  })

  it('commits when the edit and the request are simultaneous', () => {
    // Same millisecond means the edit came first and the response already contains it. Treating
    // this as "too late" would drop a perfectly good response on every fast edit.
    expect(shouldCommitSettings({ ...base, lastLocalEditAt: NOW })).toBe(true)
  })

  it('drops anything once the component is gone, or the data is unusable', () => {
    expect(shouldCommitSettings({ ...base, disposed: true })).toBe(false)
    expect(shouldCommitSettings({ ...base, hasValidData: false })).toBe(false)
  })
})
