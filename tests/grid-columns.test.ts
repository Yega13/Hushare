import { describe, it, expect } from 'vitest'
import {
  MOBILE_COLUMN_CHOICES, DESKTOP_COLUMN_CHOICES,
  MOBILE_COLUMNS_FALLBACK,
  isMobileColumns, isDesktopColumns, resolveGridColumns,
} from '../src/lib/grid-columns'

describe('column choices', () => {
  it('offers phones fewer columns than desktops at the top end', () => {
    // The whole reason this module exists: a phone cannot show 8 readable thumbnails.
    expect(Math.max(...MOBILE_COLUMN_CHOICES)).toBeLessThan(Math.max(...DESKTOP_COLUMN_CHOICES))
  })

  it('rejects everything outside the offered lists', () => {
    for (const bad of [0, 1, 7, 12, -3, 2.5, NaN, '4', null, undefined, {}]) {
      expect(isMobileColumns(bad)).toBe(false)
    }
    for (const bad of [0, 1, 2, 9, 100, '5', null, undefined]) {
      expect(isDesktopColumns(bad)).toBe(false)
    }
    for (const good of MOBILE_COLUMN_CHOICES) expect(isMobileColumns(good)).toBe(true)
    for (const good of DESKTOP_COLUMN_CHOICES) expect(isDesktopColumns(good)).toBe(true)
  })
})

describe('the toolbar buttons and the API agree', () => {
  it('MOBILE_GRID_COLUMN_OPTIONS is exactly the accepted set', async () => {
    // These were two hand-kept lists. If someone adds a phone option to the label list alone,
    // the toolbar offers a value the API rejects with a 400 the owner cannot explain.
    const { MOBILE_GRID_COLUMN_OPTIONS } = await import('../src/lib/media-display')
    expect(MOBILE_GRID_COLUMN_OPTIONS.map((o) => o.value)).toEqual([...MOBILE_COLUMN_CHOICES])
    for (const o of MOBILE_GRID_COLUMN_OPTIONS) expect(isMobileColumns(o.value)).toBe(true)
  })
})

describe('resolveGridColumns', () => {
  it('WITHOUT a desktop choice, desktop carries the album own mobile number', () => {
    // This is the whole safety property: before the split, one number rendered at every width.
    // A fixed desktop default would re-lay-out every existing album on deploy — the live event
    // album (6 across) would have dropped to 5 under guests mid-scroll. Each of these is a real
    // shape from the production table.
    expect(resolveGridColumns({ mobile_grid_columns: 6 }).desktop).toBe(6)
    expect(resolveGridColumns({ mobile_grid_columns: 4 }).desktop).toBe(4)
    expect(resolveGridColumns({ mobile_grid_columns: 3, desktop_grid_columns: null }).desktop).toBe(3)
  })

  it('a 2-across phone album clamps up to the smallest legal desktop count', () => {
    // 2 is offered on phones and not on desktops, so it cannot be carried across verbatim.
    expect(resolveGridColumns({ mobile_grid_columns: 2 })).toEqual({ mobile: 2, desktop: 3 })
  })

  it('falls back to the fixed defaults only when nothing usable is stored', () => {
    expect(resolveGridColumns({})).toEqual({ mobile: MOBILE_COLUMNS_FALLBACK, desktop: MOBILE_COLUMNS_FALLBACK })
    expect(resolveGridColumns({ mobile_grid_columns: null, desktop_grid_columns: null }))
      .toEqual({ mobile: 3, desktop: 3 })
  })

  it('honours each device independently', () => {
    expect(resolveGridColumns({ mobile_grid_columns: 2, desktop_grid_columns: 8 }))
      .toEqual({ mobile: 2, desktop: 8 })
  })

  it('a stored value outside the offered range falls back instead of rendering slivers', () => {
    // A row hand-edited, or written by an older/newer version, must never put 12 photos across
    // a phone screen. Mobile falls back to 3, and desktop then carries that 3.
    expect(resolveGridColumns({ mobile_grid_columns: 12, desktop_grid_columns: 99 }))
      .toEqual({ mobile: 3, desktop: 3 })
  })

  it('an explicit desktop choice wins over the carried mobile number', () => {
    expect(resolveGridColumns({ mobile_grid_columns: 6, desktop_grid_columns: 3 }))
      .toEqual({ mobile: 6, desktop: 3 })
    expect(resolveGridColumns({ desktop_grid_columns: 7 })).toEqual({ mobile: 3, desktop: 7 })
  })
})

describe('the phone and desktop settings must not drag each other', () => {
  it('while desktop is unset, it carries the phone number — which is the coupling', () => {
    // This is deliberate on DEPLOY: an album that had one number keeps looking the same. But it
    // means the two ARE the same value until desktop is chosen, so moving the phone setting moved
    // the desktop layout with it. An owner reported exactly that on the live event album.
    expect(resolveGridColumns({ mobile_grid_columns: 6 }).desktop).toBe(6)
    expect(resolveGridColumns({ mobile_grid_columns: 3 }).desktop).toBe(3)
  })

  it('once desktop is pinned, the phone moves alone', () => {
    // What api/album/media-settings now writes before changing the phone setting: the desktop
    // value the album was ALREADY displaying, so it stops following.
    const pinned = { mobile_grid_columns: 3, desktop_grid_columns: 6 }
    expect(resolveGridColumns(pinned)).toEqual({ mobile: 3, desktop: 6 })
    // And changing the phone again leaves desktop exactly where the owner pinned it.
    expect(resolveGridColumns({ ...pinned, mobile_grid_columns: 2 }).desktop).toBe(6)
  })

  it('a 2-across phone album pins desktop to a legal value, never to 2', () => {
    // 2 is a phone-only choice, so the carried value has to clamp — otherwise the pin would
    // write a desktop number no picker offers and nothing can render.
    const carried = resolveGridColumns({ mobile_grid_columns: 2 }).desktop
    expect(carried).toBe(3)
    expect(isDesktopColumns(carried)).toBe(true)
  })
})
