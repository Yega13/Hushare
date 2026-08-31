import { describe, it, expect } from 'vitest'
import {
  streamQuotaUsed, streamQuotaLevel, streamUnitsNeeded, STREAM_UNIT_MINUTES,
} from '../src/lib/stream-quota'

describe('streamQuotaLevel', () => {
  it('is quiet at the level we are at today', () => {
    // 49.69 of 1000 when this was written.
    expect(streamQuotaLevel(50, 1000)).toBe('ok')
  })

  it('warns WELL before the ceiling, because reaching it is an outage not a bill', () => {
    // Running out does not cost more — it makes every video upload fail, for every album. Being
    // told early costs a line on a page; being told late costs video during somebody's wedding.
    expect(streamQuotaLevel(599, 1000)).toBe('ok')
    expect(streamQuotaLevel(600, 1000)).toBe('watch')
    expect(streamQuotaLevel(849, 1000)).toBe('watch')
    expect(streamQuotaLevel(850, 1000)).toBe('critical')
    expect(streamQuotaLevel(1000, 1000)).toBe('critical')
    expect(streamQuotaLevel(1200, 1000)).toBe('critical')
  })

  it('does NOT cry wolf when the limit is unknown', () => {
    // Cloudflare reports 0 on accounts where this does not apply. An alarm on a number we do not
    // understand is how a warning card becomes something people scroll past.
    expect(streamQuotaLevel(50, 0)).toBe('ok')
    expect(streamQuotaLevel(50, -1)).toBe('ok')
    expect(streamQuotaLevel(50, NaN)).toBe('ok')
    expect(streamQuotaUsed(50, 0)).toBeNull()
  })

  it('reports the fraction in use', () => {
    expect(streamQuotaUsed(500, 1000)).toBe(0.5)
    expect(streamQuotaUsed(49.69, 1000)).toBeCloseTo(0.0497, 4)
  })
})

describe('streamUnitsNeeded', () => {
  it('buys enough to hold what is there with room to grow', () => {
    // Units are 1,000 minutes for $5. Sizing to exactly current usage means being back at the
    // ceiling immediately, so it asks for half again.
    expect(streamUnitsNeeded(50)).toBe(1)
    expect(streamUnitsNeeded(700)).toBe(2)     // 1,050 needed
    expect(streamUnitsNeeded(1131)).toBe(2)    // the 2,900-album projection
    expect(streamUnitsNeeded(5000)).toBe(8)
  })

  it('never suggests buying nothing', () => {
    expect(streamUnitsNeeded(0)).toBe(1)
    expect(streamUnitsNeeded(-5)).toBe(1)
  })

  it('the unit is the one Cloudflare actually sells', () => {
    expect(STREAM_UNIT_MINUTES).toBe(1000)
  })
})
