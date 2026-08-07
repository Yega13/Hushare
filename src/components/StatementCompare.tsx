'use client'

import { useCallback, useRef, useState } from 'react'

// Draggable before/after reveal (the Aceternity "Compare" pattern) contrasting today's thin header
// bar with the proposed cover banner. Self-contained — no external deps, works on touch + mouse.

const TILES = ['#c9b7a6', '#9fb0a2', '#d8c4b0', '#b9a48f', '#a7b8b0', '#cbb9a4', '#b0a595', '#c4b2a0']

const tileGrid: React.CSSProperties = { flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridTemplateRows: 'repeat(2, 1fr)', gap: 5, padding: 8, background: '#FDFAF5' }
const tag: React.CSSProperties = { position: 'absolute', top: 10, fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', padding: '3px 8px', borderRadius: 999, zIndex: 2 }

function Tiles() {
  return <div style={tileGrid}>{TILES.map((c, i) => <span key={i} style={{ background: c, borderRadius: 5 }} />)}</div>
}

export default function StatementCompare() {
  const [pos, setPos] = useState(50)
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const moveTo = useCallback((clientX: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos(Math.max(3, Math.min(97, ((clientX - r.left) / r.width) * 100)))
  }, [])

  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Drag to compare the current header with the proposed cover banner"
      aria-valuenow={Math.round(pos)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      onPointerDown={(e) => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); moveTo(e.clientX) }}
      onPointerMove={(e) => { if (dragging.current) moveTo(e.clientX) }}
      onPointerUp={(e) => { dragging.current = false; try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* ignore */ } }}
      onPointerCancel={() => { dragging.current = false }}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') setPos((p) => Math.max(3, p - 4)); if (e.key === 'ArrowRight') setPos((p) => Math.min(97, p + 4)) }}
      style={{ position: 'relative', width: '100%', maxWidth: 430, aspectRatio: '16 / 12', borderRadius: 14, overflow: 'hidden', border: '1px solid #E7DDCC', boxShadow: '0 10px 28px rgba(60,40,20,0.14)', cursor: 'ew-resize', userSelect: 'none', touchAction: 'none', margin: '1.5rem auto' }}
    >
      {/* Base layer — PROPOSED (cover banner) */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: '0 0 62%', position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: 16, background: 'linear-gradient(135deg, #e9c6b3, #d98c93 55%, #a85c6e)' }}>
          <img src="/logo/logo-light-transparent.png" alt="" aria-hidden="true" style={{ position: 'absolute', top: 12, left: 14, height: 14, width: 'auto', zIndex: 2 }} />
          <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(20,10,14,0) 42%, rgba(20,10,14,0.62) 100%)' }} />
          <span style={{ ...tag, right: 10, background: 'rgba(255,255,255,0.9)', color: '#2D7A4F' }}>PROPOSED</span>
          <div style={{ position: 'relative', zIndex: 1, color: '#FDFAF5' }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 'clamp(18px, 3.6vw, 30px)', lineHeight: 1 }}>Aram &amp; Ani</div>
            <div style={{ fontSize: 'clamp(10px, 1.6vw, 13px)', opacity: 0.9, marginTop: 6 }}>Yerevan · 12 September 2026</div>
          </div>
        </div>
        <Tiles />
      </div>

      {/* Overlay layer — NOW (thin bar), clipped to the left of the divider */}
      <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 ${100 - pos}% 0 0)`, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: '0 0 62%', position: 'relative', display: 'flex', flexDirection: 'column', background: '#FDFAF5' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid #E7DDCC' }}>
            <img src="/logo/logo-dark-transparent.png" alt="" aria-hidden="true" style={{ height: 14, width: 'auto' }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 15, fontWeight: 700, color: '#630826' }}>Aram &amp; Ani</div>
              <div style={{ fontSize: 10, color: '#8B6F4E' }}>212 photos · 12 Sep 2026</div>
            </div>
            <span style={{ width: 26 }} />
          </div>
          <span style={{ ...tag, left: 10, background: '#630826', color: '#FDFAF5' }}>NOW</span>
        </div>
        <Tiles />
      </div>

      {/* Divider + handle */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${pos}%`, transform: 'translateX(-50%)', width: 2, background: 'rgba(255,255,255,0.92)', boxShadow: '0 0 0 1px rgba(0,0,0,0.06)', zIndex: 3, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 36, height: 36, borderRadius: '50%', background: '#FDFAF5', boxShadow: '0 2px 10px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#630826" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 6 3 12l6 6" /><path d="M15 6l6 6-6 6" />
          </svg>
        </div>
      </div>
    </div>
  )
}
