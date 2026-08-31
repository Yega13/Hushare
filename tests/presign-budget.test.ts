import { describe, it, expect } from 'vitest'
import { presignBudget, PRESIGN_FLOOR, PRESIGN_CEILING, PRESIGN_SLACK } from '../src/lib/presign-budget'

describe('presignBudget', () => {
  it('a full album still gets enough slots to retry, and no more', () => {
    // The abuse case: an album that can accept nothing new must not be worth a terabyte an hour.
    expect(presignBudget(1000, 1000)).toBe(PRESIGN_FLOOR)
    expect(presignBudget(5000, 1000)).toBe(PRESIGN_FLOOR)
  })

  it('an empty large album gets enough for a real event', () => {
    // A photographer filling a 10,000-item album in a day must never meet this.
    expect(presignBudget(0, 10000)).toBe(PRESIGN_CEILING)
  })

  it('scales with what is actually left to upload', () => {
    expect(presignBudget(900, 1000)).toBe(Math.max(PRESIGN_FLOOR, 100 * PRESIGN_SLACK))
    expect(presignBudget(0, 1000)).toBe(1000 * PRESIGN_SLACK)
  })

  it('never returns less than the floor or more than the ceiling', () => {
    for (const [count, cap] of [[0, 0], [0, 1], [999999, 10], [0, 999999], [500, 250]] as const) {
      const b = presignBudget(count, cap)
      expect(b).toBeGreaterThanOrEqual(PRESIGN_FLOOR)
      expect(b).toBeLessThanOrEqual(PRESIGN_CEILING)
    }
  })

  it('a FAILED count opens up rather than locking the event out', () => {
    // Same direction as the row cap's own failure mode. Refusing every guest at an event because
    // one COUNT query failed is a worse outcome than one generous hour.
    expect(presignBudget(null, 1000)).toBe(PRESIGN_CEILING)
    expect(presignBudget(NaN, 1000)).toBe(PRESIGN_CEILING)
  })

  it('is far below the old flat ceiling, which was the whole problem', () => {
    // 40,000/hour at the free-tier file size is roughly a terabyte an hour, permanently stored,
    // for anyone who knows one album id.
    expect(PRESIGN_CEILING).toBeLessThan(40000)
  })
})
