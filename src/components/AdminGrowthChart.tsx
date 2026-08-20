'use client'

import { useState } from 'react'

// Daily bar chart for the admin dashboard.
//
// Previously this was server-rendered with a native SVG <title> per bar. That "worked" but was
// unusable in practice: native tooltips wait about a second before appearing, and a day with a
// value of zero draws no rect at all, so the days you most want to ask about were exactly the ones
// with nothing to hover. Now every column has a full-height transparent hit area, so all 14 days
// respond instantly — including the empty ones.
type Point = { day: string; value: number }

export default function AdminGrowthChart({
  label, points, color, unit,
}: { label: string; points: Point[]; color: string; unit?: string }) {
  const [hovered, setHovered] = useState<number | null>(null)

  const W = 300, H = 84
  const peak = Math.max(1, ...points.map((p) => p.value))
  const total = points.reduce((s, p) => s + p.value, 0)
  const n = points.length
  const gap = 3
  const bw = n > 0 ? Math.max(1, (W - gap * (n - 1)) / n) : 0

  const active = hovered != null ? points[hovered] : null

  // Formats 2026-08-14 as "Aug 14" — the raw ISO day is noise once you're reading a 14-day trend.
  const prettyDay = (day: string) => {
    const d = new Date(`${day}T00:00:00Z`)
    return Number.isNaN(d.getTime())
  // Locale must be EXPLICIT on every server-rendered number and date.
  // toLocaleString() with no locale uses the RUNTIME's locale, and the runtimes differ: the Worker
  // formats 1234 as "1,234" while a phone set to Armenian or Russian formats it "1 234". React then
  // hydrates against text that does not match what the server sent and throws #418, which is what
  // was arriving from an Android device on /admin. This page is English-only anyway, so 'en-US' is
  // both correct and stable across both sides.
      ? day
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  }

  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E4DAC9', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#2A211C' }}>{label}</div>
        {/* The header doubles as the readout: on hover it shows the hovered day instead of the
            14-day total, so the number appears where the eye already is. */}
        <div style={{ fontSize: 12, color: active ? '#2A211C' : '#8A7A66', fontWeight: active ? 700 : 400, fontVariantNumeric: 'tabular-nums' }}>
          {active
            ? `${prettyDay(active.day)}: ${active.value.toLocaleString('en-US')} ${unit ?? ''}`
            : `${total.toLocaleString('en-US')} ${unit ?? ''} · 14d`}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: 84, display: 'block', marginTop: 8, touchAction: 'none' }}
        onPointerLeave={() => setHovered(null)}
      >
        {points.map((p, i) => {
          const h = Math.max((p.value / peak) * (H - 3), p.value > 0 ? 1.5 : 0)
          const x = i * (bw + gap)
          const isOn = hovered === i
          return (
            <g key={i}>
              <rect
                x={x} y={H - h} width={bw} height={h}
                fill={color} fillOpacity={isOn ? 1 : i === n - 1 ? 0.95 : 0.8}
              />
              {/* Transparent full-height column: the actual hover target. Sized to span the gap as
                  well so there is no dead space between bars, and present even at value 0. */}
              <rect
                x={x - gap / 2} y={0} width={bw + gap} height={H}
                fill={isOn ? color : 'transparent'} fillOpacity={isOn ? 0.1 : 0}
                onPointerEnter={() => setHovered(i)}
                onPointerDown={() => setHovered(i)}
                style={{ cursor: 'crosshair' }}
              >
                {/* Kept as a fallback for touch devices and screen readers, where a hover state
                    alone conveys nothing. */}
                <title>{`${prettyDay(p.day)}: ${p.value} ${unit ?? ''}`}</title>
              </rect>
            </g>
          )
        })}
      </svg>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#8A7A66', marginTop: 4 }}>
        <span>{points[0] ? prettyDay(points[0].day) : ''}</span>
        <span>peak {peak.toLocaleString('en-US')}</span>
        <span>{points[n - 1] ? prettyDay(points[n - 1].day) : 'today'}</span>
      </div>
    </div>
  )
}
