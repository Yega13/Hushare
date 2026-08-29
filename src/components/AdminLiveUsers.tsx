'use client'

import { useEffect, useRef, useState } from 'react'

type Presence = { total: number; pages: { label: string; count: number }[]; at: number }

const BRAND = '#630826'
const INK = '#2A211C'
const MUTED = '#8A7A66'
const CARD = '#FFFFFF'
const BORDER = '#E4DAC9'
// How often presence is polled. Named because the sparkline turns it into "how long ago" — with a
// literal in one place and the arithmetic in another, the readout drifts the moment either moves.
const POLL_MS = 5000

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
    const iv = setInterval(load, POLL_MS)
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
          <Sparkline values={history} peak={peak} everyMs={POLL_MS} />
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

// The sparkline drew the shape and never told you the numbers behind it: you could see that the
// count moved at some point in the last six minutes and not what it moved to. Now pointing at it
// reads out the exact value and how long ago it was.
//
// POINTER EVENTS, not mouse events. The admin panel gets opened on a phone, where "hover" does not
// exist — pointer covers mouse, touch and pen with one handler, and touchAction: 'none' stops a
// drag along the chart from scrolling the page instead of scrubbing it.
function Sparkline({ values, peak, everyMs }: { values: number[]; peak: number; everyMs: number }) {
  const W = 100, H = 32
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  if (values.length < 2) {
    return <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 40, display: 'block' }} />
  }
  const step = W / (values.length - 1)
  const y = (v: number) => H - (v / peak) * (H - 3) - 1.5
  const pts = values.map((v, i) => `${(i * step).toFixed(2)},${y(v).toFixed(2)}`)
  const line = `M${pts.join(' L')}`
  const area = `${line} L${W},${H} L0,${H} Z`

  // Clamped, because a pointer can sit a pixel outside the box and round to an index that is not
  // there — which reads out `undefined` rather than a number.
  const idx = hoverIdx == null ? null : Math.max(0, Math.min(values.length - 1, hoverIdx))
  const trackPointer = (clientX: number) => {
    const box = wrapRef.current?.getBoundingClientRect()
    if (!box || box.width === 0) return
    setHoverIdx(Math.round(((clientX - box.left) / box.width) * (values.length - 1)))
  }
  const agoSeconds = idx == null ? 0 : Math.round(((values.length - 1 - idx) * everyMs) / 1000)

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative', touchAction: 'none', cursor: 'crosshair' }}
      onPointerDown={(e) => trackPointer(e.clientX)}
      onPointerMove={(e) => trackPointer(e.clientX)}
      onPointerLeave={() => setHoverIdx(null)}
      onPointerCancel={() => setHoverIdx(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 40, display: 'block' }}>
        <path d={area} fill="#630826" fillOpacity={0.08} />
        <path d={line} fill="none" stroke="#630826" strokeWidth={1.4} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {idx != null && (
          <>
            <line x1={idx * step} y1={0} x2={idx * step} y2={H} stroke="#630826" strokeOpacity={0.35} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {/* preserveAspectRatio="none" stretches the viewBox horizontally, so a circle would be
                drawn as an ellipse. The marker is sized in the stretched space to come out round. */}
            <ellipse cx={idx * step} cy={y(values[idx])} rx={W / 260} ry={1.6} fill="#630826" />
          </>
        )}
      </svg>
      {idx != null && (
        <div
          style={{
            position: 'absolute', top: -6, left: `${(idx / (values.length - 1)) * 100}%`,
            // Pinned inside the box at the ends so the readout is never clipped off the edge.
            transform: `translateX(${idx === 0 ? '0' : idx === values.length - 1 ? '-100%' : '-50%'})`,
            background: INK, color: '#FFFFFF', fontSize: 11, fontWeight: 700,
            borderRadius: 6, padding: '3px 7px', whiteSpace: 'nowrap', pointerEvents: 'none',
          }}
        >
          {values[idx]} · {agoSeconds < 5 ? 'now' : `${agoSeconds}s ago`}
        </div>
      )}
    </div>
  )
}
