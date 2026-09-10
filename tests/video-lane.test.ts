import { describe, it, expect } from 'vitest'
import { createVideoLane, videoOutcomeOf } from '@/lib/upload/video-lane'
import { Semaphore } from '@/lib/upload/semaphore'
import { VIDEO_SOLO_LANE_BYTES, VIDEO_WIDEN_AFTER_CLEAN } from '@/lib/constants'

// HOW MANY VIDEOS GO UP AT ONCE. The rule these tests hold: a guest CANCELLING an upload, or the
// product refusing one on purpose, must not collapse the lane to serial for the rest of the
// session on a phone whose connection is perfectly fine.
//
// That rule was already kept by the inline code this module replaced -- the move was made so it
// could be TESTED, not because it was broken. Saying so because a test name is read as evidence.

const clean = (lane: { note: (o: 'clean' | 'failed' | 'ignore') => void }, n: number) => {
  for (let i = 0; i < n; i++) lane.note('clean')
}

describe('videoOutcomeOf -- what a settled upload says about the NETWORK', () => {
  it('a thrown null is a FAILURE, not a clean upload', () => {
    // The only caller is a catch block, so "no error" cannot be true there. A null branch
    // answering 'clean' would widen the lane on a network that had just dropped a file, which is
    // the fail-safe pointing the wrong way (rule 19).
    expect(videoOutcomeOf(null)).toBe('failed')
    expect(videoOutcomeOf(undefined)).toBe('failed')
  })
  it('so is anything thrown that is not an Error at all', () => {
    expect(videoOutcomeOf({ message: 'File too large' })).toBe('failed')
    expect(videoOutcomeOf({ name: 'AbortError' })).toBe('failed')
  })
  it('a deliberate cancel says NOTHING about the network', () => {
    expect(videoOutcomeOf(new DOMException('cancelled', 'AbortError'))).toBe('ignore')
  })
  it('a refusal the product made on purpose says nothing either', () => {
    // "This album has reached its video minutes" and friends: the network was never involved.
    expect(videoOutcomeOf(new Error('File too large: 250 MB'))).toBe('ignore')
  })
  it('anything else is the connection', () => {
    expect(videoOutcomeOf(new Error('Failed to fetch'))).toBe('failed')
    expect(videoOutcomeOf(new Error('tus: request failed'))).toBe('failed')
    expect(videoOutcomeOf('a string')).toBe('failed')
  })
})

describe('the lane widens on proof and collapses on failure', () => {
  it('widens one step after a clean streak, and not before', () => {
    const sem = new Semaphore(1)
    const lane = createVideoLane(sem, 3)
    clean(lane, VIDEO_WIDEN_AFTER_CLEAN - 1)
    expect(sem.capacity).toBe(1)
    lane.note('clean')
    expect(sem.capacity).toBe(2)
  })
  it('never widens past the ceiling', () => {
    const sem = new Semaphore(1)
    const lane = createVideoLane(sem, 2)
    clean(lane, VIDEO_WIDEN_AFTER_CLEAN * 5)
    expect(sem.capacity).toBe(2)
  })
  it('the streak RESETS after a widen, so each step costs its own clean run', () => {
    const sem = new Semaphore(1)
    const lane = createVideoLane(sem, 4)
    clean(lane, VIDEO_WIDEN_AFTER_CLEAN)
    expect(sem.capacity).toBe(2)
    clean(lane, VIDEO_WIDEN_AFTER_CLEAN - 1)
    expect(sem.capacity, 'one short of another full streak').toBe(2)
    lane.note('clean')
    expect(sem.capacity).toBe(3)
  })
  it('a genuine failure collapses to serial AND stops probing for the session', () => {
    const sem = new Semaphore(1)
    const lane = createVideoLane(sem, 4)
    clean(lane, VIDEO_WIDEN_AFTER_CLEAN)
    expect(sem.capacity).toBe(2)
    lane.note('failed')
    expect(sem.capacity).toBe(1)
    expect(lane.ceiling).toBe(1)
    clean(lane, VIDEO_WIDEN_AFTER_CLEAN * 5)
    expect(sem.capacity, 'the ceiling is 1 now: no amount of success re-widens it').toBe(1)
  })
  it('a failure AT CAPACITY 1 does not pin the ceiling -- it says nothing about concurrency', () => {
    // The lane always starts at 1, so this is where most real failures land. A review found that
    // moving `cap = 1` above the `if (sem.capacity > 1)` guard left all 14 tests green: the FIRST
    // video of a session failing once would then hold every later video to serial, on a connection
    // that recovered a second later. Nothing could see it, because no test failed at capacity 1
    // and then asked whether the lane could still widen.
    const sem = new Semaphore(1)
    const lane = createVideoLane(sem, 3)
    lane.note('failed')
    expect(sem.capacity).toBe(1)
    expect(lane.ceiling, 'a failure with nothing to collapse must not stop the probing').toBe(3)
    clean(lane, VIDEO_WIDEN_AFTER_CLEAN)
    expect(sem.capacity, 'the lane can still earn its way up').toBe(2)
  })
  it('a failure also breaks a streak in progress', () => {
    const sem = new Semaphore(1)
    const lane = createVideoLane(sem, 3)
    clean(lane, VIDEO_WIDEN_AFTER_CLEAN - 1)
    lane.note('failed')
    lane.note('clean')
    expect(sem.capacity, 'the near-complete streak was discarded').toBe(1)
  })
  it('A CANCEL DOES NOT COLLAPSE THE LANE, and neither does a refusal', () => {
    // The rule the whole module exists for: one guest tapping cancel must not make every remaining
    // video in that session upload serially.
    const sem = new Semaphore(1)
    const lane = createVideoLane(sem, 3)
    clean(lane, VIDEO_WIDEN_AFTER_CLEAN)
    expect(sem.capacity).toBe(2)
    lane.note(videoOutcomeOf(new DOMException('cancelled', 'AbortError')))
    lane.note(videoOutcomeOf(new Error('File too large: 250 MB')))
    expect(sem.capacity).toBe(2)
    expect(lane.ceiling).toBe(3)
  })
  it('an ignored outcome does not break a streak either', () => {
    const sem = new Semaphore(1)
    const lane = createVideoLane(sem, 3)
    clean(lane, VIDEO_WIDEN_AFTER_CLEAN - 1)
    lane.note('ignore')
    lane.note('clean')
    expect(sem.capacity, 'the cancel was not a gap in the streak').toBe(2)
  })
})

describe('weightFor -- a big video takes the whole lane', () => {
  it('at or above the solo threshold it takes every slot, so nothing runs beside it', () => {
    const sem = new Semaphore(3)
    const lane = createVideoLane(sem, 3)
    expect(lane.weightFor(VIDEO_SOLO_LANE_BYTES)).toBe(3)
    expect(lane.weightFor(VIDEO_SOLO_LANE_BYTES * 4)).toBe(3)
  })
  it('below it, one slot', () => {
    const sem = new Semaphore(3)
    const lane = createVideoLane(sem, 3)
    expect(lane.weightFor(VIDEO_SOLO_LANE_BYTES - 1)).toBe(1)
    expect(lane.weightFor(0)).toBe(1)
  })
  it('the weight follows the CURRENT capacity, not the ceiling', () => {
    const sem = new Semaphore(1)
    const lane = createVideoLane(sem, 4)
    expect(lane.weightFor(VIDEO_SOLO_LANE_BYTES)).toBe(1)
    clean(lane, VIDEO_WIDEN_AFTER_CLEAN)
    expect(lane.weightFor(VIDEO_SOLO_LANE_BYTES)).toBe(2)
  })
})
