import { describe, it, expect } from 'vitest'
import { createVideoLane, videoOutcomeOf } from '@/lib/upload/video-lane'
import { Semaphore } from '@/lib/upload/semaphore'
import { VIDEO_SOLO_LANE_BYTES, VIDEO_WIDEN_AFTER_CLEAN } from '@/lib/constants'

// HOW MANY VIDEOS GO UP AT ONCE. The shipped defect was that a guest CANCELLING an upload, or the
// product refusing one on purpose, collapsed the lane to serial for the rest of the session on a
// phone whose connection was perfectly fine.

const clean = (lane: { note: (o: 'clean' | 'failed' | 'ignore') => void }, n: number) => {
  for (let i = 0; i < n; i++) lane.note('clean')
}

describe('videoOutcomeOf -- what a settled upload says about the NETWORK', () => {
  it('no error is a clean upload', () => {
    expect(videoOutcomeOf(null)).toBe('clean')
    expect(videoOutcomeOf(undefined)).toBe('clean')
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
  it('a failure also breaks a streak in progress', () => {
    const sem = new Semaphore(1)
    const lane = createVideoLane(sem, 3)
    clean(lane, VIDEO_WIDEN_AFTER_CLEAN - 1)
    lane.note('failed')
    lane.note('clean')
    expect(sem.capacity, 'the near-complete streak was discarded').toBe(1)
  })
  it('A CANCEL DOES NOT COLLAPSE THE LANE, and neither does a refusal', () => {
    // The defect. One guest tapping cancel used to make every remaining video upload serially.
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
