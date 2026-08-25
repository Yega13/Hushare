import { Fragment } from 'react'
import type { ClockPoint } from '@/lib/cf-analytics'

// When people actually open albums — 7 rows × 24 columns, on the VISITOR'S clock.
//
// The visitor's clock is the entire point. Cloudflare resolves each request's timezone at the edge,
// so an album opened at 9pm reads as 9pm whether the guest is in Yerevan or Los Angeles. Bucketing
// the same data by UTC would smear every evening across two columns and get worse the more countries
// the product reaches — the answer would degrade precisely as the thing being measured grew.
//
// A grid rather than two separate charts: "Saturday evening" is a single fact, and splitting it into
// a weekday chart and an hour chart loses it. A weeknight lunchtime spike and a Sunday night spike
// can produce identical totals in both of those charts and mean completely different things.

const DAYS = [
  { dow: 1, label: 'Mon' }, { dow: 2, label: 'Tue' }, { dow: 3, label: 'Wed' },
  { dow: 4, label: 'Thu' }, { dow: 5, label: 'Fri' }, { dow: 6, label: 'Sat' },
  { dow: 0, label: 'Sun' },
]

export default function AdminClockHeatmap({ points, color }: { points: ClockPoint[]; color: string }) {
  const grid = new Map<string, number>()
  for (const p of points) grid.set(`${p.weekday}:${p.hour}`, (grid.get(`${p.weekday}:${p.hour}`) ?? 0) + p.count)
  const peak = Math.max(1, ...grid.values())
  const total = points.reduce((s, p) => s + p.count, 0)

  let busiest = { label: '—', hour: 0, count: 0 }
  for (const d of DAYS) {
    for (let h = 0; h < 24; h++) {
      const n = grid.get(`${d.dow}:${h}`) ?? 0
      if (n > busiest.count) busiest = { label: d.label, hour: h, count: n }
    }
  }

  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E4DAC9', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#2A211C' }}>When albums are opened</div>
        <div style={{ fontSize: 12, color: '#8A7A66', fontVariantNumeric: 'tabular-nums' }}>
          {total === 0
            ? 'nothing recorded yet'
            : `busiest ${busiest.label} ${String(busiest.hour).padStart(2, '0')}:00 · ${total.toLocaleString('en-US')} views`}
        </div>
      </div>
      <p style={{ fontSize: 11, color: '#A5977F', margin: '0 0 10px' }}>
        Last 30 days, in each visitor&apos;s own local time.
      </p>

      {/* Scrolls inside itself on a narrow screen rather than widening the page. */}
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 460 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '30px repeat(24, 1fr)', gap: 2, alignItems: 'center' }}>
            {DAYS.map((d) => (
              <Fragment key={d.dow}>
                <div style={{ fontSize: 10, color: '#8A7A66', textAlign: 'right', paddingRight: 4 }}>{d.label}</div>
                {Array.from({ length: 24 }, (_, h) => {
                  const n = grid.get(`${d.dow}:${h}`) ?? 0
                  return (
                    <div
                      key={`${d.dow}-${h}`}
                      title={`${d.label} ${String(h).padStart(2, '0')}:00 — ${n.toLocaleString('en-US')}`}
                      style={{
                        aspectRatio: '1 / 1',
                        borderRadius: 2,
                        // A floor of 0.06 keeps every empty cell visible as part of the grid; without
                        // it the shape of the week reads as holes rather than as quiet hours.
                        background: color,
                        opacity: n === 0 ? 0.06 : 0.18 + (n / peak) * 0.82,
                      }}
                    />
                  )
                })}
              </Fragment>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '30px repeat(24, 1fr)', gap: 2, marginTop: 4 }}>
            <div />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={`h-${h}`} style={{ fontSize: 8.5, color: '#A5977F', textAlign: 'center' }}>
                {h % 3 === 0 ? h : ''}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
