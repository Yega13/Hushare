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

// Shared pointer-drag behaviour for both the SV area and the hue slider.
//
// This used to rely on setPointerCapture + React's own onPointerMove on the element. It worked with
// a mouse and not with a finger, for two reasons that only exist on a phone:
//   1. The picker sits inside the Designer's scrolling body. A touch that the browser decides is a
//      scroll fires pointercancel, which implicitly drops the capture mid-drag.
//   2. Picking a colour clears the header photo, and on a phone the preview is stacked ABOVE the
//      controls — so the hero band collapsing moves the picker itself several hundred pixels up,
//      out from under the finger, on the very first touch.
// Listening on the window instead survives (1), and re-reading the element's box on every move
// survives (2): the drag keeps tracking the control wherever the page has moved it to.
function useDragArea(onMove: (fx: number, fy: number) => void) {
  // Read through a ref so the listeners installed on pointerdown always call the CURRENT onMove,
  // without needing to be torn down and reinstalled on every re-render mid-drag.
  const onMoveRef = useRef(onMove)
  useEffect(() => { onMoveRef.current = onMove })

  // Teardowns for every drag currently holding window listeners. A Set, not a single function,
  // because multi-touch can open several at once. Cleared on unmount so closing the Designer
  // mid-drag cannot leave a listener behind.
  const teardowns = useRef(new Set<() => void>())
  useEffect(() => () => {
    for (const t of teardowns.current) t()
    teardowns.current.clear()
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const pointerId = e.pointerId
    const track = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return
      onMoveRef.current(clamp01((clientX - r.left) / r.width), clamp01((clientY - r.top) / r.height))
    }
    track(e.clientX, e.clientY)

    const teardown = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('blur', teardown)
      teardowns.current.delete(teardown)
    }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      // Deliberately no setPointerCapture (it dies to pointercancel when the Designer's own
      // scroll claims the gesture). The price is that a mouse released OUTSIDE the window never
      // sends us a pointerup, so the drag would stick: the colour would then follow the bare
      // cursor and every movement would schedule a real save to the album. `buttons === 0` is
      // proof the button is already up, and ends the drag the moment the pointer comes back.
      if (ev.pointerType === 'mouse' && ev.buttons === 0) { teardown(); return }
      track(ev.clientX, ev.clientY)
    }
    const end = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) teardown()
    }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    // Alt-tab or an OS overlay mid-drag never delivers a pointerup either.
    window.addEventListener('blur', teardown)
    teardowns.current.add(teardown)
  }, [])

  return { onPointerDown }
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
