import { describe, it, expect } from 'vitest'
import { batchThroughputKbps, lostCount, MIN_MEASURABLE_MS } from '@/lib/upload/throughput'

// THE ONE NUMBER THAT TELLS THREE PROBLEMS APART.
//
// "Uploads feel slow" fits a slow connection, a slow phone and a slow server equally well. The
// measured kB/s on the admin dashboard is what separates them, so a wrong value is worse than no
// value: a missing data point leaves the median where it was, and a wrong one moves it with nothing
// downstream able to tell afterwards which it was.
//
// This was computed from `Date.now() - batchStartedAt` inside UploadZone. Rule 22: a duration from
// two wall-clock readings is not a duration. The caller reads the monotonic clock now, and these
// are the rules that decide whether the result is worth reporting at all.

describe('a batch is only measured when there is something honest to measure', () => {
  it('reports kilobytes per second for a real batch', () => {
    // 10 MB in 10 seconds is 1,024 kB/s.
    expect(batchThroughputKbps(10 * 1024 * 1024, 10_000, 5)).toBe(1024)
    // 1 MB in 2 seconds is 512 kB/s.
    expect(batchThroughputKbps(1024 * 1024, 2_000, 1)).toBe(512)
  })

  it('says NOTHING when nothing landed', () => {
    // A batch that failed has no throughput, only a failure. Reporting the bytes it pushed before
    // dying as a success rate is the dashboard telling the opposite of the truth.
    expect(batchThroughputKbps(10 * 1024 * 1024, 10_000, 0)).toBeUndefined()
    expect(batchThroughputKbps(10 * 1024 * 1024, 10_000, -1)).toBeUndefined()
  })

  it('the measurable floor is HALF A SECOND, pinned', () => {
    // Every boundary case below is written against the symbol, so nothing pinned its value: a
    // mutation run on 2026-09-11 found the whole suite stays green for any floor between 200 ms and
    // 2 s. At 1999 the dashboard silently stops seeing its fastest batches, which is the opposite
    // of what a throughput metric is for.
    expect(MIN_MEASURABLE_MS).toBe(500)
  })

  it('rounds to the nearest kB/s, not upward', () => {
    // Math.ceil passes every other case in this file, because four of the five asserted rates are
    // exactly divisible. A rate that is not is what tells them apart: 1,500 bytes in 1 second is
    // 1.46 kB/s, which rounds to 1 and ceils to 2.
    expect(batchThroughputKbps(1500, 1000, 1)).toBe(1)
    expect(batchThroughputKbps(1024 * 3 + 900, 1000, 1), '3.88 kB/s rounds up to 4').toBe(4)
  })

  it('a real but very slow batch reports 1, never 0', () => {
    // 0 is not a third answer. The analytics route turns an ABSENT kbps into 0 as well, and both
    // the fold and the query drop zeros -- so "we did not measure" and "this was the worst upload
    // of the night" would land in the same bucket and neither would reach the median. One 200 KB
    // photo over seven minutes is a real event on venue Wi-Fi, and the one worth seeing.
    expect(batchThroughputKbps(200 * 1024, 7 * 60 * 1000, 1)).toBe(1)
    expect(batchThroughputKbps(1024, 60 * 60 * 1000, 1), 'a rate that rounds to zero still reports 1').toBe(1)
  })

  it('says nothing for a batch too short to divide by', () => {
    // One cached thumbnail settling in 200 ms would report a throughput no network can reach.
    expect(batchThroughputKbps(1024 * 1024, 200, 1)).toBeUndefined()
    expect(batchThroughputKbps(1024 * 1024, MIN_MEASURABLE_MS, 1), 'the boundary is exclusive').toBeUndefined()
    expect(batchThroughputKbps(1024 * 1024, MIN_MEASURABLE_MS + 1, 1)).toBeDefined()
  })

  it('says nothing for a NEGATIVE duration, which is what a clock jump used to produce', () => {
    // The clamp is the belt to the monotonic clock's braces. If a duration ever arrives negative,
    // the honest answer is silence -- the alternative is a throughput with a minus sign in it, or
    // an absurdly large one once it is rounded.
    expect(batchThroughputKbps(10 * 1024 * 1024, -3_600_000, 5)).toBeUndefined()
    expect(batchThroughputKbps(10 * 1024 * 1024, 0, 5)).toBeUndefined()
  })

  it('says nothing when the numbers are not numbers', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(batchThroughputKbps(bad, 10_000, 5), `bytes ${bad}`).toBeUndefined()
      expect(batchThroughputKbps(1024, bad, 5), `elapsed ${bad}`).toBeUndefined()
      expect(batchThroughputKbps(1024 * 1024, 10_000, bad), `saved ${bad}`).toBeUndefined()
    }
  })

  it('says nothing for a batch with no bytes', () => {
    expect(batchThroughputKbps(0, 10_000, 5)).toBeUndefined()
  })

  it('an hour-long clock jump would have reported a few bytes a second -- now it cannot', () => {
    // The concrete shape of the defect, kept as a test because the number is the whole point: a
    // 10 MB batch that really took 8 seconds, reported against an elapsed hour, is 2 kB/s. That is
    // a working venue connection filed as the worst upload of the night.
    expect(batchThroughputKbps(10 * 1024 * 1024, 3_600_000, 5), 'what the wall clock would have said').toBe(3)
    expect(batchThroughputKbps(10 * 1024 * 1024, 8_000, 5), 'what actually happened').toBe(1280)
  })
})

describe('how many files never landed', () => {
  it('counts the difference', () => {
    expect(lostCount(10, 7)).toBe(3)
    expect(lostCount(10, 10)).toBe(0)
  })

  it('is NEVER negative', () => {
    // A retry can save a row the original attempt also counted, so saved can exceed attempted. A
    // negative "lost" on the dashboard is a number somebody has to explain rather than act on.
    expect(lostCount(5, 8)).toBe(0)
  })

  it('reports nothing lost when the counts are not numbers', () => {
    expect(lostCount(NaN, 3)).toBe(0)
    expect(lostCount(5, NaN)).toBe(0)
    expect(lostCount(Infinity, 3)).toBe(0)
  })
})
