'use client'

import { useEffect, useState } from 'react'

type Option = { key: string; label: string; hint?: string; swatch?: string }
type Results = { question: string; note: string | null; options: Option[]; tallies: Record<string, number>; total: number }

function getVoterId(): string {
  try {
    let id = localStorage.getItem('hush_voter_id')
    if (!id) { id = (crypto.randomUUID?.() ?? String(Math.random()).slice(2) + Date.now()); localStorage.setItem('hush_voter_id', id) }
    return id
  } catch { return '' }
}

export default function StatementPoll({ pollKey }: { pollKey: string }) {
  const [data, setData] = useState<Results | null>(null)
  const [voted, setVoted] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    fetch(`/api/poll/${pollKey}`)
      .then((r) => r.json())
      .then((d) => { if (alive && d && !d.error) setData(d as Results) })
      .catch(() => {})
    try { setVoted(localStorage.getItem(`hush_poll_${pollKey}`)) } catch { /* no storage */ }
    return () => { alive = false }
  }, [pollKey])

  async function vote(optionKey: string) {
    if (busy || voted) return
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/poll/${pollKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option_key: optionKey, voter_id: getVoterId() }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(d.error ?? 'Could not record your vote.'); return }
      setData((prev) => (prev ? { ...prev, tallies: d.tallies, total: d.total } : prev))
      setVoted(optionKey)
      try { localStorage.setItem(`hush_poll_${pollKey}`, optionKey) } catch { /* no storage */ }
    } catch {
      setErr('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return null
  const showResults = !!voted

  return (
    <section aria-label="Poll" style={{ marginTop: '3rem', border: '1px solid #E7DDCC', background: '#FBF5EC', borderRadius: 16, padding: 'clamp(18px, 3vw, 26px)' }}>
      <style>{`
        .hush-poll-card { transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease; }
        .hush-poll-votable:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(99,8,38,0.14); border-color: #630826 !important; }
        .hush-poll-fill { transition: width 640ms cubic-bezier(0.16,1,0.3,1); }
        @media (prefers-reduced-motion: reduce) { .hush-poll-card, .hush-poll-fill { transition: none; } }
      `}</style>

      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#B98E4C', margin: 0 }}>
        {showResults ? 'Results' : 'Your turn'}
      </p>
      <h3 style={{ fontFamily: 'var(--font-serif)', color: '#630826', fontSize: 'clamp(1.2rem, 3vw, 1.5rem)', fontWeight: 700, margin: '.4rem 0 0' }}>
        {data.question}
      </h3>
      {data.note && <p style={{ fontSize: 13.5, color: '#8B6F4E', margin: '.4rem 0 0' }}>{data.note}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: '1.3rem' }}>
        {data.options.map((o) => {
          const count = data.tallies[o.key] ?? 0
          const pct = data.total ? Math.round((count / data.total) * 100) : 0
          const mine = voted === o.key
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => vote(o.key)}
              disabled={busy || showResults}
              className={`hush-poll-card ${showResults ? '' : 'hush-poll-votable'}`}
              style={{
                textAlign: 'left', padding: 0, overflow: 'hidden', borderRadius: 13,
                border: mine ? '2px solid #630826' : '1.5px solid #E4DBCC',
                background: '#FFFFFF', cursor: showResults ? 'default' : 'pointer',
                display: 'flex', flexDirection: 'column',
              }}
            >
              {o.swatch
                ? <div style={{ height: 54, background: o.swatch }} />
                : <div style={{ height: 4, background: mine ? '#630826' : '#C49A6C' }} />}
              <div style={{ padding: '11px 13px 13px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-serif)', fontSize: 16, color: '#2A211C' }}>
                  {o.label}{mine && <span style={{ color: '#630826', fontSize: 13 }}>✓ your pick</span>}
                </div>
                {o.hint && <div style={{ fontSize: 11.5, color: '#8B6F4E', marginTop: 2 }}>{o.hint}</div>}
                {showResults && (
                  <>
                    <div style={{ height: 7, background: '#EFE6D6', borderRadius: 99, marginTop: 10, overflow: 'hidden' }}>
                      <div className="hush-poll-fill" style={{ width: `${pct}%`, height: '100%', background: mine ? '#630826' : '#C49A6C', borderRadius: 99 }} />
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#630826', marginTop: 5, fontVariantNumeric: 'tabular-nums' }}>
                      {pct}% · {count} {count === 1 ? 'vote' : 'votes'}
                    </div>
                  </>
                )}
              </div>
            </button>
          )
        })}
      </div>

      <p style={{ fontSize: 12.5, color: '#8B6F4E', margin: '1.1rem 0 0' }}>
        {showResults ? `${data.total} ${data.total === 1 ? 'vote' : 'votes'} so far · thanks for weighing in.` : 'Tap a look to cast your vote — one per person.'}
      </p>
      {err && <p style={{ fontSize: 12.5, color: '#C0392B', margin: '.5rem 0 0' }}>{err}</p>}
    </section>
  )
}
