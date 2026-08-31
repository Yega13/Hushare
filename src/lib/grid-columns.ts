// How many photos sit across the grid, per device.
//
// One number used to serve both screens: `mobile_grid_columns` was applied at every width. An
// owner picking 5 for their laptop gave phone visitors five ~70px thumbnails; one picking 3 for
// phones gave desktops three enormous tiles. The two screens genuinely want different answers,
// so they get two settings — and this module is the only place either is validated or defaulted.
//
// Imported by the API route that writes them, the toolbar that offers them, and the grid that
// renders them, so a change here cannot leave one of the three disagreeing (rule 13).

export const MOBILE_COLUMN_CHOICES = [2, 3, 4, 5, 6] as const
export const DESKTOP_COLUMN_CHOICES = [3, 4, 5, 6, 7, 8] as const

export type MobileColumns = (typeof MOBILE_COLUMN_CHOICES)[number]
export type DesktopColumns = (typeof DESKTOP_COLUMN_CHOICES)[number]

/** The desktop default for an album whose owner has never chosen one: what the grid rendered
 *  before this setting existed, so nothing changes appearance until somebody picks. */
export const DESKTOP_COLUMNS_FALLBACK = 5
export const MOBILE_COLUMNS_FALLBACK = 3

export function isMobileColumns(n: unknown): n is MobileColumns {
  return typeof n === 'number' && (MOBILE_COLUMN_CHOICES as readonly number[]).includes(n)
}

export function isDesktopColumns(n: unknown): n is DesktopColumns {
  return typeof n === 'number' && (DESKTOP_COLUMN_CHOICES as readonly number[]).includes(n)
}

/** What the grid should actually use, given whatever is stored (including null, undefined, or a
 *  value written before the current choices existed). Never returns something outside the
 *  offered range — a stored 12 from a future or hand-edited row would otherwise render 12
 *  unreadable slivers on a phone. */
export function resolveGridColumns(album: {
  mobile_grid_columns?: number | null
  desktop_grid_columns?: number | null
}): { mobile: number; desktop: number } {
  return {
    mobile: isMobileColumns(album.mobile_grid_columns) ? album.mobile_grid_columns : MOBILE_COLUMNS_FALLBACK,
    desktop: isDesktopColumns(album.desktop_grid_columns) ? album.desktop_grid_columns : DESKTOP_COLUMNS_FALLBACK,
  }
}
