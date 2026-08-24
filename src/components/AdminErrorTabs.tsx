'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'

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

// The album page pins dates to UTC because the Worker and the browser must agree on the markup, and
// a creation date there is a label rather than a clock. This table is the opposite case: it is an
// operator reading "did something break just now?", and a row stamped 06:59 when the wall clock says
// 11:00 is actively misleading — you cannot line it up against the event you are investigating. So
// these render in the READER'S timezone.
//
// The hydration constraint is still real, and the mismatch is resolved rather than ignored: the
// server has no idea what zone the reader is in, so it renders UTC, and the browser re-renders in
// local time immediately after hydrating. useSyncExternalStore is the mechanism React provides for
// exactly this server/client split — unlike a useState+useEffect flag, it does not set state from an
// effect, and React treats the two snapshots as intended rather than as a mismatch to warn about.
function useIsHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},   // never changes after hydration, so nothing to subscribe to
    () => true,       // client
    () => false,      // server
  )
}

function fmt(iso: string, local: boolean): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    ...(local ? {} : { timeZone: 'UTC' }),
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

// ─── Row marks ────────────────────────────────────────────────────────────────
//
// One glance should answer "does this need me?", which a wall of identical-looking rows never did.
//
// Every mark here is DERIVED, never typed in by hand. Hand-applied labels are correct the day they
// are set and quietly wrong a month later, and with a new message string appearing most weeks they
// would be a permanent chore that decays into noise. Anything that genuinely needs a human opinion
// (this one needs money rather than code) belongs on the message string itself, not on a row, so it
// applies to future occurrences without being re-applied.
type Mark = { label: string; bg: string; fg: string; border: string; title: string }

const MARKS = {
  design:    { label: 'by design',  bg: '#E9F3EC', fg: '#2E6B3E', border: '#C9E2D2', title: 'Not a fault. The product refused something on purpose, or a fallback engaged and worked.' },
  oldCode:   { label: 'old code',   bg: '#EFEAE1', fg: '#7A6A58', border: '#DED5C6', title: 'Reported by a browser running a bundle older than the live deploy — a stale tab, not a live bug.' },
  regressed: { label: 'regressed',  bg: '#FBE8E7', fg: '#B3261E', border: '#EFCFCC', title: 'This exact message was cleared before and has appeared again. Worth checking whether something believed fixed is not — though a transient failure (a timeout, a dropped connection) simply recurring will also land here.' },
  fresh:     { label: 'new',        bg: '#E7EFF8', fg: '#1B4F86', border: '#CBDBEE', title: 'This message has never been seen before — nobody has looked at it yet.' },
} satisfies Record<string, Mark>

// Order is the point. A refusal is not a fault whatever else is true of it, and code that is no
// longer deployed cannot be a live bug — so both of those outrank "it came back", which would
// otherwise raise an alarm about a browser nobody can reach any more.
function markFor(row: ErrorRow, seenBefore: Set<string>, liveBuild: string): Mark {
  if (
    row.source === 'album-full' ||
    row.source.endsWith('-relay') ||
    /^(File too large|Unsupported)/i.test(row.message)
  ) return MARKS.design

  const build = (row.context as { build?: unknown } | null)?.build
  // Only meaningful when BOTH are known: rows predating build stamping carry no build at all, and
  // marking those "old code" would be a guess dressed as a fact — the exact mistake stamping exists
  // to prevent.
  if (typeof build === 'string' && build && liveBuild && build !== liveBuild) return MARKS.oldCode

  return seenBefore.has(row.message) ? MARKS.regressed : MARKS.fresh
}

// WHERE in the system a report came from.
//
// Everything reports now — uploads, downloads, server routes, payments, and any uncaught error
// anywhere in the app — but `source` alone is a string like "server:presign" or "unhandledrejection"
// and you have to know the codebase to read it. One word per row answers "which part of the product
// is unhappy" before you read anything else.
//
// Derived from the source, never stored: a new source added tomorrow lands in the right bucket
// without anyone remembering to label it, and the worst case for something unrecognised is "App"
// rather than a blank.
const AREAS: { test: (source: string) => boolean; label: string; bg: string; fg: string }[] = [
  { test: s => s.startsWith('server:polar') || s.startsWith('server:checkout'), label: 'Payment', bg: '#F3EAF7', fg: '#5B2E70' },
  { test: s => s.startsWith('server:'), label: 'Server', bg: '#EDE9F6', fg: '#3F3A6B' },
  { test: s => s.startsWith('upload') || s === 'save' || s === 'album-full', label: 'Upload', bg: '#EAF1F8', fg: '#1B4F86' },
  { test: s => s.startsWith('download'), label: 'Download', bg: '#E9F3EC', fg: '#2E6B3E' },
]

function areaFor(source: string): { label: string; bg: string; fg: string } {
  const hit = AREAS.find(a => a.test(source))
  // Everything else is the app itself — window.onerror, unhandledrejection, the error boundaries.
  return hit ?? { label: 'App', bg: '#F3EEE4', fg: '#7A6A58' }
}

function AreaChip({ source }: { source: string }) {
  const a = areaFor(source)
  return (
    <span
      title={`Reported by: ${source}`}
      style={{
        display: 'inline-block', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.03em',
        background: a.bg, color: a.fg, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap',
      }}
    >
      {a.label}
    </span>
  )
}

function MarkChip({ mark }: { mark: Mark }) {
  return (
    <span
      title={mark.title}
      style={{
        display: 'inline-block', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.03em',
        background: mark.bg, color: mark.fg, border: `1px solid ${mark.border}`,
        borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap',
      }}
    >
      {mark.label}
    </span>
  )
}

export default function AdminErrorTabs(
  { rows, seenBefore = [], buildId = '' }:
  { rows: ErrorRow[]; seenBefore?: string[]; buildId?: string },
) {
  // Messages that have EVER been cleared. Membership is what separates "came back" from "new".
  const seen = useMemo(() => new Set(seenBefore), [seenBefore])
  const [tab, setTab] = useState<'error' | 'warn'>('error')
  const [busy, setBusy] = useState(false)
  const isHydrated = useIsHydrated()

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
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 860 }}>
              <thead><tr><th style={th}></th><th style={th}>Area</th><th style={th}>When</th><th style={th}>Source</th><th style={th}>Message</th><th style={th}>Device</th></tr></thead>
              <tbody>
                {shown.map((e, i) => (
                  <tr key={i}>
                    <td style={td}><MarkChip mark={markFor(e, seen, buildId)} /></td>
                    <td style={td}><AreaChip source={e.source} /></td>
                    <td style={td}>{fmt(e.created_at, isHydrated)}</td>
                    <td style={td}>{e.source}</td>
                    <td style={{ ...td, whiteSpace: 'normal', maxWidth: 320 }}>
                      {e.message}
                      {/* Uploads report one row per REASON with the number of files it hit, so a
                          dropped connection is one line rather than ninety-eight. Without this the
                          row would understate the incident as a single failure. */}
                      {(() => {
                        const ctx = e.context as { failedFiles?: number; parked?: boolean; repeats?: number } | null
                        const n = ctx?.failedFiles
                        return (
                          <>
                            {typeof n === 'number' && n > 1 ? <span style={{ color: MUTED }}> · {n} files</span> : null}
                            {/* The same text appears in BOTH tabs and looked like duplication. It is
                                one incident logged twice on purpose: a warning when the upload
                                parks and is about to retry itself, an error if that retry also
                                fails. Saying which is which is the whole difference between "being
                                handled" and "gave up". */}
                            {ctx?.parked ? <span style={{ color: MUTED }}> · retrying</span> : null}
                            {/* Repeats of the same incident are coalesced into this row rather than
                                written as new ones (see api/log/client-error). Showing the count is
                                what keeps that from hiding how often something happened. */}
                            {typeof ctx?.repeats === 'number' && ctx.repeats > 1
                              ? <strong style={{ color: BRAND }}> · ×{ctx.repeats}</strong>
                              : null}
                          </>
                        )
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
