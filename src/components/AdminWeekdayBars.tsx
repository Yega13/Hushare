'use client'

import { useState } from 'react'

// Which day of the week the product is busy, rather than which date.
//
// The 14-day series next to this answers "is it growing". This answers "when do people use it",
// which is the operational question: when uploads spike is when a deploy is a bad idea and when
// support needs to be awake.
//
// Deliberately NOT built on the daily chart. Fourteen days gives two samples per weekday, which is
// noise — a single wedding would make Saturday look like a trend. This reads twelve weeks, so each
// bar is twelve real samples.

export type WeekdayPoint = { name: string; value: number }

export default function AdminWeekdayBars({
  label, days, color, unit,
}: { label: string; days: WeekdayPoint[]; color: string; unit?: string }) {
  const [hovered, setHovered] = useState<number | null>(null)

  const peak = Math.max(1, ...days.map((d) => d.value))
  const total = days.reduce((s, d) => s + d.value, 0)
  const busiest = days.reduce((best, d) => (d.value > best.value ? d : best), days[0] ?? { name: '—', value: 0 })
  const active = hovered != null ? days[hovered] : null

  // Locale is EXPLICIT on every number. toLocaleString() with no locale uses the RUNTIME's locale,
  // and the Worker's differs from a phone set to Armenian or Russian — the server would send "1,234"
  // and the client would render "1 234", which is a hydration mismatch. This page is English-only.
  const n = (v: number) => v.toLocaleString('en-US')

  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E4DAC9', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#2A211C' }}>{label}</div>
        {/* The header doubles as the readout — on hover it names the day, otherwise it names the
            busiest one, which is the whole point of the chart. */}
        <div style={{ fontSize: 12, color: active ? '#2A211C' : '#8A7A66', fontWeight: active ? 700 : 400, fontVariantNumeric: 'tabular-nums' }}>
          {active
            ? `${active.name}: ${n(active.value)} ${unit ?? ''}`
            : total === 0
              ? 'no data yet'
              : `${busiest.name} busiest · ${n(total)} ${unit ?? ''}`}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 84, marginTop: 12 }}>
        {days.map((d, i) => {
          const isPeak = d.value === busiest.value && d.value > 0
          return (
            <div
              key={d.name}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', cursor: 'default' }}
            >
              {/* A full-height column is the hit area, so a day with zero still responds to the
                  pointer — the empty days are usually the ones worth asking about. */}
              <div
                style={{
                  height: `${Math.max(2, (d.value / peak) * 100)}%`,
                  background: color,
                  // The busiest day is stated in full colour and the rest recede, so the shape is
                  // readable before any number is.
                  opacity: hovered === i ? 1 : isPeak ? 0.95 : 0.34,
                  borderRadius: 3,
                  transition: 'opacity 120ms ease-out',
                }}
              />
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        {days.map((d, i) => (
          <div
            key={d.name}
            style={{
              flex: 1,
              textAlign: 'center',
              fontSize: 10,
              color: hovered === i ? '#2A211C' : '#8A7A66',
              fontWeight: hovered === i ? 700 : 400,
            }}
          >
            {d.name.slice(0, 3)}
          </div>
        ))}
      </div>
    </div>
  )
}
