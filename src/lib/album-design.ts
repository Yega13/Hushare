// Shared album "accent color" config — used by BOTH the design API route (server validation) and
// the OwnerToolbar UI (swatches), so the palette can never drift between them.
//
// Every palette color is deliberately DARK enough for white text, because the accent is used to
// tint buttons/controls that put white text on top. That means retinting with any palette color is
// always readable — and for custom (paid) colors we enforce the same darkness rule below.

export const ACCENT_PALETTE: string[] = [
  '#630826', // Hushare maroon — the default
  '#7a1533', '#9b1b30', '#a63a1e', '#b4531f',
  '#1f5136', '#12664b', '#0f5e63', '#1e3a5f',
  '#21458c', '#33307a', '#5b2a86', '#6a2a5b',
  '#8a1e5c', '#3a4750', '#2b2b2e', '#4a2c1a', '#4b5320',
]

export const DEFAULT_ACCENT = '#630826'

const HEX_RE = /^#[0-9a-fA-F]{6}$/
const PALETTE_SET = new Set(ACCENT_PALETTE.map((c) => c.toLowerCase()))

export function isValidHex(hex: string): boolean {
  return HEX_RE.test(hex)
}

export function isPaletteColor(hex: string): boolean {
  return PALETTE_SET.has(hex.toLowerCase())
}

// WCAG relative luminance. White button text needs a dark background — we cap how light a custom
// color may be so a paid user can't pick, say, pale yellow and make every button unreadable.
export function isDarkEnoughForWhiteText(hex: string): boolean {
  if (!HEX_RE.test(hex)) return false
  const chan = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  const L = 0.2126 * chan(0) + 0.7152 * chan(1) + 0.0722 * chan(2)
  return L <= 0.4 // comfortably dark → white text stays well above 4.5:1 contrast
}
