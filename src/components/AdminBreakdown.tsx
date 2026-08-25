// A ranked list with the bar drawn behind the label.
//
// Deliberately not a pie chart. The question these answer is "which is biggest, and by how much" —
// ranked bars answer that at a glance, and a pie with fifteen countries in it answers nothing.
//
// Server-rendered: there is no interaction here, so shipping JavaScript for it would be waste on a
// page that already carries several charts.

export type BreakdownRow = { label: string; count: number }

export default function AdminBreakdown({
  title, rows, color, empty = 'nothing recorded yet',
}: { title: string; rows: BreakdownRow[]; color: string; empty?: string }) {
  const total = rows.reduce((s, r) => s + r.count, 0)
  const peak = Math.max(1, ...rows.map((r) => r.count))

  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E4DAC9', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#2A211C' }}>{title}</div>
        <div style={{ fontSize: 12, color: '#8A7A66', fontVariantNumeric: 'tabular-nums' }}>
          {/* Locale is EXPLICIT on every number: the Worker and the viewer's browser can disagree
              about separators, which React reports as a hydration mismatch. */}
          {total.toLocaleString('en-US')}
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: '#A5977F', padding: '10px 0' }}>{empty}</div>
      ) : (
        <div style={{ display: 'grid', gap: 5 }}>
          {rows.map((r) => (
            <div key={r.label} style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '5px 8px', borderRadius: 6, overflow: 'hidden' }}>
              {/* The bar sits BEHIND the text rather than beside it, so the label always has the
                  full width to itself — city names get long, and a bar competing for that space
                  truncates exactly the rows worth reading. */}
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: `${(r.count / peak) * 100}%`,
                  background: color, opacity: 0.14, borderRadius: 6,
                }}
              />
              <span style={{ position: 'relative', fontSize: 12.5, color: '#2A211C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.label}
              </span>
              <span style={{ position: 'relative', fontSize: 12, fontWeight: 600, color: '#5C4A3C', fontVariantNumeric: 'tabular-nums' }}>
                {r.count.toLocaleString('en-US')}
                {total > 0 && (
                  <span style={{ color: '#A5977F', fontWeight: 400 }}> · {Math.round((r.count / total) * 100)}%</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
