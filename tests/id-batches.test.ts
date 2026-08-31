import { describe, it, expect } from 'vitest'
import { idBatches, firstDuplicate, MAX_IDS_PER_QUERY } from '../src/lib/id-batches'

const UUID_CHARS = 37   // 36 for a uuid + 1 for the separating comma

describe('idBatches', () => {
  it('keeps every batch small enough that the URL cannot blow the limit', () => {
    // MEASURED against the live database on 2026-08-31: 300 ids was an 11 KB URL and returned 200;
    // 500 ids was 18 KB and the fetch THREW — no status, nothing to inspect. Reordering the
    // 4,565-photo race album sent ~500 and hit exactly that.
    const ids = Array.from({ length: 5000 }, (_, i) => String(i).padStart(36, '0'))
    for (const batch of idBatches(ids)) {
      expect(batch.length).toBeLessThanOrEqual(MAX_IDS_PER_QUERY)
      expect(batch.length * UUID_CHARS).toBeLessThan(10_000)
    }
  })

  it('has a batch size with real headroom under the cliff', () => {
    // 300 worked and 500 did not, so anything at or above 300 is betting on an untested edge.
    expect(MAX_IDS_PER_QUERY).toBeLessThanOrEqual(250)
    expect(MAX_IDS_PER_QUERY).toBeGreaterThan(1)
  })

  it('loses nothing and duplicates nothing', () => {
    // The batches feed a COUNT that is summed and compared against the input length. A batching
    // bug that dropped or repeated one id would turn into "your photos do not belong to this
    // album" for a perfectly good album.
    const ids = Array.from({ length: 1001 }, (_, i) => `id-${i}`)
    const flat = idBatches(ids).flat()
    expect(flat).toEqual(ids)
    expect(new Set(flat).size).toBe(ids.length)
  })

  it('handles the exact boundaries', () => {
    expect(idBatches([], 200)).toEqual([])
    expect(idBatches(['a'], 200)).toEqual([['a']])
    expect(idBatches(['a', 'b'], 2)).toEqual([['a', 'b']])
    expect(idBatches(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']])
  })

  it('refuses a size that would loop forever', () => {
    expect(() => idBatches(['a'], 0)).toThrow()
    expect(() => idBatches(['a'], -1)).toThrow()
  })
})

describe('firstDuplicate', () => {
  it('finds a repeat, so it never gets reported as a missing photo', () => {
    // The database matches a repeated id ONCE, so the count comes back short — identical to the
    // symptom of an id that does not exist. Without this the message sends you hunting for a photo
    // that was never missing.
    expect(firstDuplicate(['a', 'b', 'a'])).toBe('a')
    expect(firstDuplicate(['x', 'x'])).toBe('x')
  })

  it('returns the FIRST repeat, not just any', () => {
    expect(firstDuplicate(['a', 'b', 'c', 'b', 'a'])).toBe('b')
  })

  it('is null when every id is distinct', () => {
    expect(firstDuplicate([])).toBeNull()
    expect(firstDuplicate(['a'])).toBeNull()
    expect(firstDuplicate(['a', 'b', 'c'])).toBeNull()
  })
})
