import { describe, it, expect } from 'vitest'
import { withNonNull } from '@/lib/non-null'

// THE BODY OF A TYPE PREDICATE, TESTED -- because the compiler does not.
//
// A `.filter((a): a is T & { x: string } => a.x !== null)` narrows by its signature. Change the body
// to `=> true` and tsc stays green while `new Date(null)` runs at the call site. That mutation
// survived when this logic was inline in two crons, which is why it lives here with these tests:
// the signature is held by tsc at every call site, and the body is held by this file.

type Row = { id: string; expires: string | null; tier: string | null; note: string | null }
const rows: Row[] = [
  { id: 'a', expires: '2026-10-01', tier: 'pro', note: null },
  { id: 'b', expires: null, tier: 'pro', note: 'x' },
  { id: 'c', expires: '2026-10-02', tier: null, note: 'y' },
  { id: 'd', expires: '2026-10-03', tier: 'studio', note: 'z' },
]

describe('withNonNull keeps exactly the rows where every named key is present', () => {
  it('drops a row that is null in ANY named key', () => {
    expect(withNonNull(rows, 'expires', 'tier').map((r) => r.id)).toEqual(['a', 'd'])
  })

  it('only the NAMED keys count -- a null elsewhere is fine', () => {
    // `note` is null on row a and a is kept: the filter is about the columns the query guaranteed,
    // not about every nullable column on the row.
    expect(withNonNull(rows, 'expires').map((r) => r.id)).toEqual(['a', 'c', 'd'])
  })

  it('treats undefined like null', () => {
    const sparse = [{ id: 'u', expires: undefined as unknown as string | null, tier: 'pro', note: null }]
    expect(withNonNull(sparse, 'expires')).toEqual([])
  })

  it('with no keys named, keeps everything', () => {
    expect(withNonNull(rows).length).toBe(4)
  })

  it('NARROWS the type of the named keys and leaves the others alone', () => {
    const out = withNonNull(rows, 'expires', 'tier')
    // These three lines are the compile-time half of the guarantee. If the signature ever stopped
    // narrowing, the first two would not compile; if it over-narrowed, the third would not.
    const e: string = out[0].expires
    const t: string = out[0].tier
    const n: string | null = out[0].note
    expect([e, t, n]).toEqual(['2026-10-01', 'pro', null])
  })

  it('returns rows by identity, not copies', () => {
    // Nothing here needs a copy, and on a 5,000-row list a copy per row would be the only cost.
    const out = withNonNull(rows, 'expires')
    expect(out[0]).toBe(rows[0])
  })

  it('empty in, empty out', () => {
    expect(withNonNull([] as Row[], 'expires')).toEqual([])
  })
})
