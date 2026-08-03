import type { Locale } from '@/i18n/config'

// Inline SVG flags — NOT emoji. Windows' Segoe UI Emoji omits regional-indicator glyphs, so flag
// emoji render as "US/RU/AM" letters on every Windows desktop browser. SVG renders identically
// everywhere with no external requests (CSP-safe). English → the US flag.

const baseStyle: React.CSSProperties = {
  height: 16,
  width: 'auto',
  borderRadius: 3,
  display: 'block',
  boxShadow: '0 0 0 1px rgba(0,0,0,0.15)',
  flex: 'none',
}

export default function LocaleFlag({ locale, style }: { locale: Locale; style?: React.CSSProperties }) {
  const s = { ...baseStyle, ...style }

  if (locale === 'ru') {
    return (
      <svg viewBox="0 0 3 2" style={s} aria-hidden="true">
        <rect width="3" height="2" fill="#fff" />
        <rect y="0.667" width="3" height="0.667" fill="#0039A6" />
        <rect y="1.333" width="3" height="0.667" fill="#D52B1E" />
      </svg>
    )
  }

  if (locale === 'hy') {
    return (
      <svg viewBox="0 0 3 2" style={s} aria-hidden="true">
        <rect width="3" height="0.667" fill="#D90012" />
        <rect y="0.667" width="3" height="0.667" fill="#0033A0" />
        <rect y="1.333" width="3" height="0.667" fill="#F2A800" />
      </svg>
    )
  }

  // en → United States. 13 stripes + blue canton with a suggestion of stars (a 5×4 dot grid reads
  // as "US flag" at icon size; 50 real stars would be invisible).
  return (
    <svg viewBox="0 0 25 13" style={s} aria-hidden="true">
      <rect width="25" height="13" fill="#B22234" />
      {[1, 3, 5, 7, 9, 11].map((y) => (
        <rect key={y} y={y} width="25" height="1" fill="#fff" />
      ))}
      <rect width="10" height="7" fill="#3C3B6E" />
      {Array.from({ length: 4 }).flatMap((_, row) =>
        Array.from({ length: 5 }).map((_, col) => (
          <circle key={`${row}-${col}`} cx={1.2 + col * 1.9} cy={1.1 + row * 1.6} r={0.32} fill="#fff" />
        )),
      )}
    </svg>
  )
}
