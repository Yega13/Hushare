'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Hushare's own colour picker. Replaces <input type="color">, whose popup is drawn by the OS and
// looks like a different product on every machine (and on Windows is a full modal with RGB spin
// boxes). Deliberately minimal: a saturation/brightness area, a hue slider, and a hex field.
// No eyedropper, no swatch history, no alpha — a header colour needs none of it.

const BORDER = '#DDD5C5', MUTED = '#8A7A66', INK = '#2A211C'

type Props = {
  value: string                       // #rrggbb
  onChange: (hex: string) => void     // fires continuously while dragging; caller debounces saves
}

type HSV = { h: number; s: number; v: number }   // h 0-360, s/v 0-1

function clamp01(n: number) { return Math.min(1, Math.max(0, n)) }

export function hexToHsv(hex: string): HSV {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { h: 0, s: 0, v: 0 }
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvToHex({ h, s, v }: HSV): string {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x } else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x } else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c } else { r = c; b = x }
  const to255 = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0')
  return `#${to255(r)}${to255(g)}${to255(b)}`
}

// Shared pointer-drag behaviour for both the SV area and the hue slider: capture the pointer so a
// drag keeps tracking even when it leaves the element, and report position as 0-1 fractions.
function useDragArea(onMove: (fx: number, fy: number) => void) {
  const draggingRef = useRef(false)
  const apply = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onMove(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height))
  }, [onMove])
  return {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      draggingRef.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
      apply(e)
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => { if (draggingRef.current) apply(e) },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      draggingRef.current = false
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    },
  }
}

export default function HushColorPicker({ value, onChange }: Props) {
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(value))
  const [hexDraft, setHexDraft] = useState(value)

  // Follow external changes (a palette swatch tapped, or Reset) without fighting the user's drag:
  // only re-derive when the incoming colour differs from what this picker last emitted.
  const lastEmitted = useRef(value)
  useEffect(() => {
    if (value.toLowerCase() === lastEmitted.current.toLowerCase()) return
    setHsv(hexToHsv(value))
    setHexDraft(value)
    lastEmitted.current = value
  }, [value])

  const emit = useCallback((next: HSV) => {
    setHsv(next)
    const hex = hsvToHex(next)
    lastEmitted.current = hex
    setHexDraft(hex)
    onChange(hex)
  }, [onChange])

  const svDrag = useDragArea(useCallback((fx, fy) => emit({ h: hsv.h, s: fx, v: 1 - fy }), [emit, hsv.h]))
  const hueDrag = useDragArea(useCallback((fx) => emit({ h: fx * 360, s: hsv.s, v: hsv.v }), [emit, hsv.s, hsv.v]))

  const hueHex = hsvToHex({ h: hsv.h, s: 1, v: 1 })
  const current = hsvToHex(hsv)

  function commitHex(raw: string) {
    const t = raw.trim()
    const full = /^#?([0-9a-f]{6})$/i.exec(t)
    if (full) {
      const hex = `#${full[1].toLowerCase()}`
      lastEmitted.current = hex
      setHsv(hexToHsv(hex))
      setHexDraft(hex)
      onChange(hex)
    } else {
      setHexDraft(current)   // invalid → snap the field back to the real colour
    }
  }

  return (
    <div style={{ width: '100%' }}>
      {/* Saturation (x) × brightness (y) */}
      <div
        {...svDrag}
        onPointerCancel={svDrag.onPointerUp}
        style={{
          position: 'relative', width: '100%', height: 132, borderRadius: 10, cursor: 'crosshair',
          touchAction: 'none', border: `1px solid ${BORDER}`,
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), ${hueHex}`,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute', left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`,
            transform: 'translate(-50%, -50%)', width: 14, height: 14, borderRadius: '50%',
            border: '2px solid #FFFFFF', boxShadow: '0 0 0 1.5px rgba(0,0,0,0.45)', pointerEvents: 'none',
          }}
        />
      </div>

      {/* Hue */}
      <div
        {...hueDrag}
        onPointerCancel={hueDrag.onPointerUp}
        style={{
          position: 'relative', width: '100%', height: 14, borderRadius: 999, marginTop: 10,
          cursor: 'pointer', touchAction: 'none', border: `1px solid ${BORDER}`,
          background: 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute', left: `${(hsv.h / 360) * 100}%`, top: '50%',
            transform: 'translate(-50%, -50%)', width: 16, height: 16, borderRadius: '50%',
            background: hueHex, border: '2px solid #FFFFFF', boxShadow: '0 0 0 1.5px rgba(0,0,0,0.35)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Hex */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <span style={{ width: 26, height: 26, borderRadius: 7, background: current, border: `1px solid ${BORDER}`, flex: '0 0 auto' }} />
        <input
          value={hexDraft}
          onChange={(e) => setHexDraft(e.target.value)}
          onBlur={(e) => commitHex(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          spellCheck={false}
          aria-label="Hex colour"
          style={{
            flex: 1, minWidth: 0, padding: '5px 9px', fontSize: 13, fontFamily: 'ui-monospace, monospace',
            borderRadius: 7, border: `1px solid ${BORDER}`, background: '#FDFAF5', color: INK, textTransform: 'lowercase',
          }}
        />
      </div>
      <p style={{ fontSize: 10, color: MUTED, margin: '6px 0 0' }}>Drag to pick · type a hex code</p>
    </div>
  )
}
