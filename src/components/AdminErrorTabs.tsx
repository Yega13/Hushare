'use client'

import { useMemo, useState } from 'react'

// Errors and warnings used to share one list, which made the list useless: on a normal day most
// rows say "You've reached this album's upload limit" — the free cap doing its job, logged at warn
// level — and the two or three rows that represent an actual guest failure were buried among them.
// Splitting them means the Errors count answers the only question worth asking at a glance: is
// anything broken right now?

export type ErrorRow = {
  created_at: string
  level: string
  source: string
  message: string
  album_id: string | null
  ua: string | null
  context?: unknown
}

const BRAND = '#630826'
const INK = '#2A2118'
const MUTED = '#8A7A68'
const CARD = '#FFFDF9'
const BORDER = '#E8E0D0'

const th: React.CSSProperties = {
  textAlign: 'left', fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase',
  letterSpacing: '0.06em', padding: '8px 12px', borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap',
}
const td: React.CSSProperties = {
  fontSize: 12.5, color: INK, padding: '8px 12px', borderBottom: `1px solid #F2ECE0`, whiteSpace: 'nowrap',
}

function fmt(iso: string): string {
  // Pinned to UTC for the same reason formatDate is: the Worker and the browser otherwise disagree
  // about which day a late-evening timestamp belongs to, which is a hydration mismatch.
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  })
}

function Badge({ n, active, tone }: { n: number; active: boolean; tone: 'error' | 'warn' }) {
  if (n === 0) return null
  const bg = tone === 'error' ? '#B3261E' : '#B8860B'
  return (
    <span
      style={{
        marginLeft: 7, minWidth: 19, height: 19, padding: '0 6px', borderRadius: 999,
        background: active ? bg : '#EFE7DA', color: active ? '#FFF' : MUTED,
        fontSize: 11, fontWeight: 700, lineHeight: '19px', display: 'inline-block', textAlign: 'center',
      }}
    >
      {n > 99 ? '99+' : n}
    </span>
  )
}

export default function AdminErrorTabs({ rows }: { rows: ErrorRow[] }) {
  const [tab, setTab] = useState<'error' | 'warn'>('error')
  const [busy, setBusy] = useState(false)

  const errors = useMemo(() => rows.filter(r => r.level === 'error'), [rows])
  // Anything not explicitly an error counts as a warning, so a row logged at some future third
  // level shows up somewhere rather than vanishing from both tabs.
  const warnings = useMemo(() => rows.filter(r => r.level !== 'error'), [rows])
  const shown = tab === 'error' ? errors : warnings

  const top = useMemo(() => {
    const tally = new Map<string, number>()
    for (const r of shown) tally.set(r.message, (tally.get(r.message) ?? 0) + 1)
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [shown])

  async function clearTab() {
    const label = tab === 'error' ? 'errors' : 'warnings'
    if (!confirm(`Clear ${shown.length} ${label}? They stay recoverable for 30 days, then auto-delete.`)) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/errors/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: tab }),
      })
      if (res.ok) { window.location.reload(); return }
      alert(`Could not clear ${label}.`)
    } catch {
      alert(`Could not clear ${label}.`)
    }
    setBusy(false)
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    fontSize: 13, fontWeight: 700, color: active ? BRAND : MUTED,
    background: active ? '#FBEEF0' : 'transparent',
    border: `1px solid ${active ? '#EAD3D8' : 'transparent'}`,
    borderRadius: 999, padding: '6px 14px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
  })

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', margin: '0 0 10px' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={() => setTab('error')} style={tabStyle(tab === 'error')}>
            Errors<Badge n={errors.length} active={tab === 'error'} tone="error" />
          </button>
          <button type="button" onClick={() => setTab('warn')} style={tabStyle(tab === 'warn')}>
            Warnings<Badge n={warnings.length} active={tab === 'warn'} tone="warn" />
          </button>
        </div>
        {shown.length > 0 && (
          <button
            type="button"
            onClick={clearTab}
            disabled={busy}
            style={{
              fontSize: 12, fontWeight: 600, color: BRAND, background: '#FBEEF0',
              border: '1px solid #EAD3D8', borderRadius: 999, padding: '5px 12px',
              cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1,
            }}
          >
            {busy ? 'Clearing…' : `Clear ${tab === 'error' ? 'errors' : 'warnings'}`}
          </button>
        )}
      </div>

      <p style={{ fontSize: 12, color: MUTED, margin: '0 0 10px' }}>
        {tab === 'error'
          ? 'Something actually failed for a guest — a lost upload, a crash on their device.'
          : 'Expected events worth knowing about, not failures. Hitting the free upload cap lands here.'}
      </p>

      {shown.length === 0 ? (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px', fontSize: 13, color: MUTED }}>
          {tab === 'error' ? 'No errors reported. 🎉' : 'No warnings.'}
        </div>
      ) : (
        <>
          {top.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {top.map(([msg, n]) => (
                <span key={msg} style={{ fontSize: 12, background: '#FBEEF0', color: BRAND, border: '1px solid #EAD3D8', borderRadius: 999, padding: '4px 10px' }}>
                  <strong>{n}×</strong> {msg.slice(0, 60)}{msg.length > 60 ? '…' : ''}
                </span>
              ))}
            </div>
          )}
          <div style={{ overflowX: 'auto', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 680 }}>
              <thead><tr><th style={th}>When</th><th style={th}>Source</th><th style={th}>Message</th><th style={th}>Device</th></tr></thead>
              <tbody>
                {shown.map((e, i) => (
                  <tr key={i}>
                    <td style={td}>{fmt(e.created_at)}</td>
                    <td style={td}>{e.source}</td>
                    <td style={{ ...td, whiteSpace: 'normal', maxWidth: 320 }}>
                      {e.message}
                      {/* Uploads report one row per REASON with the number of files it hit, so a
                          dropped connection is one line rather than ninety-eight. Without this the
                          row would understate the incident as a single failure. */}
                      {(() => {
                        const n = (e.context as { failedFiles?: number } | null)?.failedFiles
                        return typeof n === 'number' && n > 1
                          ? <span style={{ color: MUTED }}> · {n} files</span>
                          : null
                      })()}
                    </td>
                    <td style={{ ...td, whiteSpace: 'normal', maxWidth: 180, fontSize: 11, color: MUTED }}>
                      {(e.ua ?? '').replace(/Mozilla\/[\d.]+ /, '').slice(0, 60)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
