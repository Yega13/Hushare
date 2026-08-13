'use client'

import { useEffect, useRef, useState } from 'react'

type Presence = { total: number; pages: { label: string; count: number }[]; at: number }

const BRAND = '#630826'
const INK = '#2A211C'
const MUTED = '#8A7A66'
const CARD = '#FFFFFF'
const BORDER = '#E4DAC9'

// Live active-user panel. Polls /api/admin/presence every 5s and keeps a rolling history so it can
// draw a real-time sparkline. "Active" = a heartbeat in the last ~70s.
export default function AdminLiveUsers() {
  const [data, setData] = useState<Presence | null>(null)
  const [stale, setStale] = useState(false)
  const historyRef = useRef<number[]>([])
  const [, force] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch('/api/admin/presence', { cache: 'no-store' })
        if (!r.ok) throw new Error(String(r.status))
        const j = (await r.json()) as Presence
        if (cancelled) return
        setData(j)
        setStale(false)
        historyRef.current = [...historyRef.current.slice(-71), j.total]
        force((n) => n + 1)
      } catch {
        if (!cancelled) setStale(true)
      }
    }
    load()
    const iv = setInterval(load, 5000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  const total = data?.total ?? 0
  const history = historyRef.current
  const peak = Math.max(1, ...history)

  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 18px', marginBottom: 28 }}>
      <style>{`@keyframes hushLivePulse{0%{transform:scale(.7);opacity:.9}70%{transform:scale(2.4);opacity:0}100%{opacity:0}}`}</style>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* pulsing live dot */}
          <span style={{ position: 'relative', width: 12, height: 12, display: 'inline-block' }}>
            <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: stale ? '#C9A227' : '#1Dae61' }} />
            {!stale && <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#1Dae61', animation: 'hushLivePulse 1.8s ease-out infinite' }} />}
          </span>
          <div>
            <div style={{ fontSize: 34, fontWeight: 800, color: INK, lineHeight: 1 }}>{total}</div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
              active right now {stale ? '· reconnecting…' : '· live'}
            </div>
          </div>
        </div>

        {/* sparkline of the last few minutes */}
        <div style={{ flex: '1 1 260px', minWidth: 220 }}>
          <Sparkline values={history} peak={peak} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: MUTED, marginTop: 4 }}>
            <span>~6 min ago</span><span>peak {peak}</span><span>now</span>
          </div>
        </div>
      </div>

      {/* where they are */}
      {data && data.pages.length > 0 && (
        <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {data.pages.map((p) => (
            <span key={p.label} style={{ fontSize: 12, background: '#FBF3F5', color: BRAND, border: `1px solid #EAD9DE`, borderRadius: 999, padding: '4px 10px' }}>
              {p.label} <strong>{p.count}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function Sparkline({ values, peak }: { values: number[]; peak: number }) {
  const W = 100, H = 32
  if (values.length < 2) {
    return <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 40, display: 'block' }} />
  }
  const step = W / (values.length - 1)
  const y = (v: number) => H - (v / peak) * (H - 3) - 1.5
  const pts = values.map((v, i) => `${(i * step).toFixed(2)},${y(v).toFixed(2)}`)
  const line = `M${pts.join(' L')}`
  const area = `${line} L${W},${H} L0,${H} Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 40, display: 'block' }}>
      <path d={area} fill="#630826" fillOpacity={0.08} />
      <path d={line} fill="none" stroke="#630826" strokeWidth={1.4} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
