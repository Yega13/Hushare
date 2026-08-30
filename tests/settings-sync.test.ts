import { describe, it, expect } from 'vitest'
import { onSettingsBroadcast, shouldCommitSettings, createSettingsSync, type Timers } from '@/lib/settings-sync'

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
  const DATA = { id: 'album-1' }
  const base = { disposed: false, requestStartedAt: NOW, lastLocalEditAt: NOW - 5000 }

  it('commits a response that nothing has superseded', () => {
    expect(shouldCommitSettings(DATA, base)).toBe(true)
  })

  it('drops a response overtaken by the owner\'s own edit', () => {
    // The actual overwrite. The edit happened after the request went out, so the response cannot
    // contain it — applying it puts the pre-edit value back on screen.
    expect(shouldCommitSettings(DATA, { ...base, lastLocalEditAt: NOW + 1 })).toBe(false)
  })

  it('commits when the edit and the request are simultaneous', () => {
    // Same millisecond means the edit came first and the response already contains it. Treating
    // this as "too late" would drop a perfectly good response on every fast edit.
    expect(shouldCommitSettings(DATA, { ...base, lastLocalEditAt: NOW })).toBe(true)
  })

  it('drops anything once the component is gone, or the data is unusable', () => {
    expect(shouldCommitSettings(DATA, { ...base, disposed: true })).toBe(false)
    expect(shouldCommitSettings(null, base)).toBe(false)
    expect(shouldCommitSettings(undefined, base)).toBe(false)
    expect(shouldCommitSettings({ id: 42 }, base), 'an id that is not a string is not an album').toBe(false)
  })
})

// A CLOCK THAT GOES BACKWARDS.
//
// Date.now() is wall-clock: a phone waking to an NTP correction, or a timezone change, can move it
// backwards between an edit and the next broadcast. sinceLocalEdit then goes negative, and the raw
// arithmetic would schedule the refresh (quietMs + the size of the jump) into the future — an
// hour-long jump defers it an hour, and every later broadcast re-defers it by another hour, so a
// setting changed on another device never arrives again for the rest of that session.
describe('a backwards clock cannot postpone the refresh forever', () => {
  it('never waits longer than the quiet window, whatever the clock says', () => {
    for (const jumpMs of [1, 5_000, 3_600_000, 86_400_000]) {
      const a = onSettingsBroadcast({ designerOpen: false, now: NOW, lastLocalEditAt: NOW + jumpMs, quietMs: QUIET })
      if (a.kind !== 'schedule') throw new Error('expected schedule')
      expect(a.delayMs, jumpMs + 'ms backwards must not defer beyond the quiet window').toBeLessThanOrEqual(QUIET)
      expect(a.delayMs).toBeGreaterThanOrEqual(0)
    }
  })
})

// EXACTLY ONE FETCH AFTER THE OWNER STOPS — the claim this file used to make in a comment and never
// check.
//
// The decision said "schedule in 1,400ms". The CANCELLATION that makes it one fetch rather than one
// per broadcast lived in the component, so deleting that single line broke the product and passed
// every test here. The scheduler owns the timer now, which is what makes this assertable at all.
describe('a dragged slider produces one refetch, not one per broadcast', () => {
  function fakeTimers() {
    let seq = 0
    const live = new Map<number, () => void>()
    const timers: Timers = {
      set(fn) { const id = ++seq; live.set(id, fn); return id },
      clear(id) { live.delete(id) },
    }
    const runAll = () => { const fns = [...live.values()]; live.clear(); fns.forEach((f) => f()) }
    return { timers, runAll, pending: () => live.size }
  }

  it('collapses a burst of broadcasts into a single trailing fetch', () => {
    const { timers, runAll, pending } = fakeTimers()
    let fetches = 0
    const sync = createSettingsSync({ quietMs: QUIET, refetch: () => { fetches++ }, markOwed: () => {}, timers })
    for (let i = 0; i < 10; i++) sync.onBroadcast({ designerOpen: false, now: NOW + i, lastLocalEditAt: NOW + i })
    expect(fetches, 'nothing fetches while the owner is still editing').toBe(0)
    expect(pending(), 'and ONE fetch is queued, not ten').toBe(1)
    runAll()
    expect(fetches).toBe(1)
  })

  it('a genuine broadcast supersedes a queued echo instead of stacking', () => {
    const { timers, runAll, pending } = fakeTimers()
    let fetches = 0
    const sync = createSettingsSync({ quietMs: QUIET, refetch: () => { fetches++ }, markOwed: () => {}, timers })
    sync.onBroadcast({ designerOpen: false, now: NOW, lastLocalEditAt: NOW })
    sync.onBroadcast({ designerOpen: false, now: NOW, lastLocalEditAt: NOW - 999_999 })
    expect(fetches, 'the real one fetches immediately').toBe(1)
    expect(pending(), 'and the queued echo is dropped, not left to fire again').toBe(0)
    runAll()
    expect(fetches).toBe(1)
  })

  it('drops a queued fetch when the page goes away', () => {
    const { timers, runAll, pending } = fakeTimers()
    let fetches = 0
    const sync = createSettingsSync({ quietMs: QUIET, refetch: () => { fetches++ }, markOwed: () => {}, timers })
    sync.onBroadcast({ designerOpen: false, now: NOW, lastLocalEditAt: NOW })
    sync.dispose()
    expect(pending()).toBe(0)
    runAll()
    expect(fetches, 'a fetch must not fire into an unmounted page').toBe(0)
  })

  it('owes rather than queues while the Designer is open', () => {
    const { timers, pending } = fakeTimers()
    let owed = 0, fetches = 0
    const sync = createSettingsSync({ quietMs: QUIET, refetch: () => { fetches++ }, markOwed: () => { owed++ }, timers })
    sync.onBroadcast({ designerOpen: true, now: NOW, lastLocalEditAt: NOW })
    expect(owed).toBe(1)
    expect(fetches).toBe(0)
    expect(pending()).toBe(0)
  })
})
