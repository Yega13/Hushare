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

/** Last resort only — used when an album has NEITHER a desktop choice nor a usable mobile one. */
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
  const mobile = isMobileColumns(album.mobile_grid_columns) ? album.mobile_grid_columns : MOBILE_COLUMNS_FALLBACK
  if (isDesktopColumns(album.desktop_grid_columns)) return { mobile, desktop: album.desktop_grid_columns }
  // NO DESKTOP CHOICE YET: fall back to this album's OWN mobile number, because that is
  // literally what the grid rendered at every width before the split. A fixed default here
  // would silently re-lay-out every album on the platform the moment this shipped — measured:
  // 97 of 97 albums had no desktop value, and the live event album (6 across) would have
  // reflowed to 5 under guests mid-scroll, against a number its owner had chosen on purpose.
  // Clamped into the desktop range, so a 2-across phone album gets the nearest legal 3.
  const carried = Math.min(
    Math.max(mobile, Math.min(...DESKTOP_COLUMN_CHOICES)),
    Math.max(...DESKTOP_COLUMN_CHOICES),
  )
  return { mobile, desktop: isDesktopColumns(carried) ? carried : DESKTOP_COLUMNS_FALLBACK }
}
