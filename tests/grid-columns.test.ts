import { describe, it, expect } from 'vitest'
import {
  MOBILE_COLUMN_CHOICES, DESKTOP_COLUMN_CHOICES,
  MOBILE_COLUMNS_FALLBACK, DESKTOP_COLUMNS_FALLBACK,
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

describe('resolveGridColumns', () => {
  it('an album that has never chosen renders exactly as it did before the setting existed', () => {
    expect(resolveGridColumns({})).toEqual({ mobile: MOBILE_COLUMNS_FALLBACK, desktop: DESKTOP_COLUMNS_FALLBACK })
    expect(resolveGridColumns({ mobile_grid_columns: null, desktop_grid_columns: null }))
      .toEqual({ mobile: 3, desktop: 5 })
  })

  it('honours each device independently', () => {
    expect(resolveGridColumns({ mobile_grid_columns: 2, desktop_grid_columns: 8 }))
      .toEqual({ mobile: 2, desktop: 8 })
  })

  it('a stored value outside the offered range falls back instead of rendering slivers', () => {
    // A row hand-edited, or written by an older/newer version, must never put 12 photos across
    // a phone screen. The fallback is the guard.
    expect(resolveGridColumns({ mobile_grid_columns: 12, desktop_grid_columns: 99 }))
      .toEqual({ mobile: 3, desktop: 5 })
  })

  it('one device being unset does not drag the other to a default', () => {
    expect(resolveGridColumns({ mobile_grid_columns: 4 })).toEqual({ mobile: 4, desktop: 5 })
    expect(resolveGridColumns({ desktop_grid_columns: 7 })).toEqual({ mobile: 3, desktop: 7 })
  })
})
