// Shared album "accent color" config — used by BOTH the design API route (server validation) and
// the OwnerToolbar UI (swatches), so the palette can never drift between them.
//
// The accent colors the album HEADER band. Text/logo on the band auto-contrast (see contrastText),
// so ANY color works — dark, light, even white — and stays readable. That's why the palette can mix
// rich darks and soft lights, and why custom hex has no darkness restriction.

export const ACCENT_PALETTE: string[] = [
  // Rich / dark
  '#630826', // Hushare maroon — the default
  '#7a1533', '#9b1b30', '#a63a1e', '#b4531f',
  '#1f5136', '#12664b', '#0f5e63', '#1e3a5f',
  '#21458c', '#33307a', '#5b2a86', '#6a2a5b',
  '#8a1e5c', '#3a4750', '#2b2b2e', '#4a2c1a', '#4b5320',
  // Soft / light (dark text auto-applies)
  '#fdfaf5', '#f3d9de', '#f6e7c6', '#dceadf', '#d7e3f2', '#e7ddf1',
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

// Returns the readable text/ink color to place ON TOP of the given accent: cream on dark accents,
// dark ink on light accents. WCAG relative luminance with a mid threshold. Used for the header band.
export function contrastText(hex: string): string {
  const m = HEX_RE.exec(hex)
  if (!m) return '#FDFAF5'
  const n = parseInt(hex.slice(1), 16)
  const chan = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  const L = 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255)
  return L > 0.42 ? '#241a15' : '#FDFAF5'
}
