// Presentational daily bar chart (server-rendered SVG — no client JS, no libraries). Each bar carries
// a native <title> tooltip with its day + value. Used on the admin dashboard for growth trends.
type Point = { day: string; value: number }

export default function AdminGrowthChart({
  label, points, color, unit,
}: { label: string; points: Point[]; color: string; unit?: string }) {
  const W = 300, H = 84
  const peak = Math.max(1, ...points.map((p) => p.value))
  const total = points.reduce((s, p) => s + p.value, 0)
  const n = points.length
  const gap = 3
  const bw = n > 0 ? Math.max(1, (W - gap * (n - 1)) / n) : 0

  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E4DAC9', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#2A211C' }}>{label}</div>
        <div style={{ fontSize: 12, color: '#8A7A66' }}>{total.toLocaleString()} {unit ?? ''} · 14d</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 84, display: 'block', marginTop: 8 }}>
        {points.map((p, i) => {
          const h = (p.value / peak) * (H - 3)
          const x = i * (bw + gap)
          return (
            <rect key={i} x={x} y={H - Math.max(h, p.value > 0 ? 1.5 : 0)} width={bw} height={Math.max(h, p.value > 0 ? 1.5 : 0)} fill={color} fillOpacity={i === n - 1 ? 1 : 0.82}>
              <title>{p.day}: {p.value}</title>
            </rect>
          )
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#8A7A66', marginTop: 4 }}>
        <span>{points[0]?.day.slice(5) ?? ''}</span>
        <span>peak {peak}</span>
        <span>{points[n - 1]?.day.slice(5) ?? 'today'}</span>
      </div>
    </div>
  )
}
