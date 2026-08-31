import { describe, it, expect } from 'vitest'
import { mergeLiveRows } from '../src/lib/error-rows'

const row = (created_at: string, message: string, level = 'warn') => ({ created_at, message, level })

describe('mergeLiveRows', () => {
  it('keeps the server tail the live window does not cover — the 200→30 shrink', () => {
    const live = [row('2026-08-31T00:03:00.000Z', 'c'), row('2026-08-31T00:02:00.000Z', 'b')]
    const initial = [
      row('2026-08-31T00:03:00.000Z', 'c'),
      row('2026-08-31T00:02:00.000Z', 'b'),
      row('2026-08-31T00:01:00.000Z', 'a'),
    ]
    expect(mergeLiveRows(live, initial).map((r) => r.message)).toEqual(['c', 'b', 'a'])
  })

  it('a brand-new live row leads, without duplicating its server copy later', () => {
    const live = [row('2026-08-31T00:05:00.000Z', 'new'), row('2026-08-31T00:03:00.000Z', 'c')]
    const initial = [row('2026-08-31T00:03:00.000Z', 'c'), row('2026-08-31T00:01:00.000Z', 'a')]
    expect(mergeLiveRows(live, initial).map((r) => r.message)).toEqual(['new', 'c', 'a'])
  })

  it('identity is timestamp AND message — same second, different messages both survive', () => {
    const t = '2026-08-31T00:03:00.000Z'
    const live = [row(t, 'x')]
    const initial = [row(t, 'x'), row(t, 'y')]
    expect(mergeLiveRows(live, initial).map((r) => r.message)).toEqual(['x', 'y'])
  })

  it('live updates win for rows they cover (the live copy is the one kept)', () => {
    const live = [{ ...row('2026-08-31T00:03:00.000Z', 'c'), level: 'error' }]
    const initial = [row('2026-08-31T00:03:00.000Z', 'c', 'warn')]
    expect(mergeLiveRows(live, initial)[0].level).toBe('error')
  })

  it('empty live window changes nothing; empty server list passes live through', () => {
    const initial = [row('2026-08-31T00:01:00.000Z', 'a')]
    expect(mergeLiveRows([], initial)).toEqual(initial)
    expect(mergeLiveRows(initial, [])).toEqual(initial)
  })
})
