'use client'

import { useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

// Daily trend chart for the admin dashboard, in the bklit.com visual language:
// a monotone curve, a gradient that fades to nothing at the baseline, dashed horizontal-only
// gridlines, no axis rules, and a vertical crosshair with a dot on the hovered point.
//
// Built directly on Recharts — which is what bklit is underneath — rather than through the shadcn
// registry. Two reasons, both about this codebase rather than that library:
//   1. `shadcn init` in v4 is a project scaffolder (it prompts for a preset and takes
//      --template=next). Pointing that at a live 262-commit app is not a trade worth making for
//      chart styling.
//   2. It rewrites globals.css, which EVERY page loads, and injects its own base layer plus
//      var(--chart-N) tokens. This site already has a deliberate palette (wine #630826 on cream),
//      and the two systems would spend the rest of their lives fighting.
// The visual result is the same; the colours are ours instead of shadcn's.
//
// Deliberately identical props to AdminGrowthChart so the two are interchangeable at the call site
// and neither has to be a rewrite of the page around it.
//
// Recharts is ~450KB. It reaches the browser ONLY through the dynamic import in admin/page.tsx
// (ssr:false), so it never enters the Worker bundle and no guest ever downloads a byte of it —
// the same treatment three.js gets for the about-page globe.

type Point = { day: string; value: number }

const AXIS = '#A89880'
const GRID = '#EFE7DA'

// Locale is pinned for the same reason it is everywhere else on this page: the server and the
// reader's phone format dates differently, and React throws a hydration error when they disagree.
function prettyDay(day: string): string {
  const d = new Date(day + 'T00:00:00Z')
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export default function AdminAreaChart({
  label, points, color, unit,
}: { label: string; points: Point[]; color: string; unit?: string }) {
  const [hovered, setHovered] = useState<Point | null>(null)

  const total = points.reduce((sum, p) => sum + p.value, 0)
  const peak = points.reduce((max, p) => Math.max(max, p.value), 0)
  // A flat-zero series would otherwise render its area along the top of the chart, which reads as
  // "everything at maximum" — the exact opposite of what it means.
  const yMax = peak === 0 ? 1 : Math.ceil(peak * 1.15)
  const gradientId = `grad-${label.replace(/[^a-z0-9]/gi, '')}`

  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E4DAC9', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#2A211C' }}>{label}</span>
        {/* The header doubles as the readout, so the hovered value has somewhere to go that does
            not move the chart or depend on a tooltip being visible. */}
        <span style={{ fontSize: 12, color: '#8A7A66', fontVariantNumeric: 'tabular-nums' }}>
          {hovered
            ? `${prettyDay(hovered.day)} · ${hovered.value.toLocaleString('en-US')}${unit ? ' ' + unit : ''}`
            : `${total.toLocaleString('en-US')}${unit ? ' ' + unit : ''} · 14d`}
        </span>
      </div>

      <div style={{ width: '100%', height: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={points}
            margin={{ top: 10, right: 4, bottom: 0, left: 4 }}
            // Recharts 3 hands back the active INDEX rather than the payload (activePayload was a
            // v2 shape), so the point is looked up from our own data — which is more honest anyway:
            // `points` is the source of truth, not whatever the chart chose to attach.
            onMouseMove={(state) => {
              const i = state?.activeTooltipIndex
              setHovered(typeof i === 'number' && points[i] ? points[i] : null)
            }}
            onMouseLeave={() => setHovered(null)}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.38} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>

            {/* Horizontal only. Vertical rules on a 14-point series add ink without adding an
                answer — the crosshair already says which day you are on. */}
            <CartesianGrid stroke={GRID} strokeDasharray="4 4" vertical={false} />

            <XAxis
              dataKey="day"
              tickFormatter={prettyDay}
              tick={{ fill: AXIS, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              minTickGap={18}
            />
            <YAxis
              domain={[0, yMax]}
              allowDecimals={false}
              width={26}
              tick={{ fill: AXIS, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />

            <Tooltip
              cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: '3 3' }}
              // The card is suppressed: the value is already in the header, and a floating card
              // over a 120px chart covers most of the data it is describing.
              content={() => null}
            />

            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              // Dots only on hover — 14 permanent dots on a sparkline-height chart is noise.
              dot={false}
              activeDot={{ r: 3.5, fill: color, stroke: '#FFFFFF', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
