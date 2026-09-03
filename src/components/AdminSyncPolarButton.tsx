'use client'

import { useState } from 'react'

type PackageResult = {
  scanned?: number; applied?: number; alreadyApplied?: number; skipped?: number
  notes?: string[]; error?: string
}
type SyncResult = {
  total: number; created: number; updated: number; skipped: number; notes?: string[]
  // Reported separately from the subscription numbers on purpose: two different things ran against
  // two different Polar permissions, and one combined count would hide either of them failing.
  packages?: PackageResult
}

// "Sync from Polar" — pulls every subscription from Polar and reconciles it into the DB
// (provisioning accounts by email when needed). Recovers payments the webhook missed; safe to
// re-run.
//
// IT USED TO RELOAD THE PAGE 1.5 SECONDS AFTER SUCCEEDING, and only when it had actually changed
// something — so the one run with something to report was the one whose report you could not read.
// A tool that destroys its own answer is worse than one that says nothing: the reader is left
// knowing a sync happened and not what it did, which is the entire reason for pressing the button.
//
// Now nothing reloads by itself. The result stays until it is read, and refreshing is a button the
// reader presses when they are done with it.
export default function AdminSyncPolarButton() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [error, setError] = useState('')

  async function sync() {
    setBusy(true); setError(''); setResult(null)
    try {
      const res = await fetch('/api/admin/sync-polar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json().catch(() => ({})) as SyncResult & { error?: string }
      if (!res.ok) { setError(data.error ?? `Failed (${res.status})`); setBusy(false); return }
      setResult(data)
      setBusy(false)
    } catch {
      setError('Request failed.')
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <button
        type="button"
        onClick={sync}
        disabled={busy}
        style={{
          fontSize: 13, fontWeight: 600, color: '#FDFAF5',
          background: '#630826', border: 'none', borderRadius: 999,
          padding: '8px 16px', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Syncing…' : 'Sync from Polar'}
      </button>
      {result && (
        <div style={{ fontSize: 13, color: '#2A211C' }}>
          ✓ {result.total} in Polar — <strong>{result.created}</strong> new, {result.updated} updated,
          {' '}{result.skipped} skipped.
          {result.packages && (
            <div style={{ marginTop: 10 }}>
              {result.packages.error ? (
                // THE FAILURE THAT MATTERS MOST HERE. Package orders are the $49/$99 one-time
                // payments, and this reconcile is their ONLY repair path when a webhook is lost.
                // A missing orders:read scope shows up exactly here.
                <p style={{ fontSize: 12, color: '#C0392B', fontWeight: 600 }}>
                  Package orders could NOT be checked — {result.packages.error}
                </p>
              ) : (
                <p style={{ fontSize: 12, color: '#5C4A3C' }}>
                  Package orders: {result.packages.scanned ?? 0} scanned,{' '}
                  <strong>{result.packages.applied ?? 0}</strong> repaired,{' '}
                  {result.packages.alreadyApplied ?? 0} already fine, {result.packages.skipped ?? 0} skipped.
                </p>
              )}
              {result.packages.notes && result.packages.notes.length > 0 && (
                <ul style={{ marginTop: 4 }}>
                  {result.packages.notes.map((n, i) => <li key={i} style={{ fontSize: 12 }}>{n}</li>)}
                </ul>
              )}
            </div>
          )}
          {result.notes && result.notes.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: '#8A6D00' }}>
              {result.notes.map((n, i) => <li key={i} style={{ fontSize: 12 }}>{n}</li>)}
            </ul>
          )}
          {/* Offered, never automatic. New rows only appear in the tables above after a refresh,
              and saying so beats reloading out from under whoever is still reading the numbers. */}
          {(result.created + result.updated) > 0 && (
            <div style={{ marginTop: 6 }}>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  fontSize: 12, fontWeight: 600, color: '#630826', background: 'transparent',
                  border: '1px solid rgba(99,8,38,0.3)', borderRadius: 999,
                  padding: '4px 12px', cursor: 'pointer',
                }}
              >
                Refresh the page to see them
              </button>
            </div>
          )}
        </div>
      )}
      {error && <span style={{ fontSize: 13, color: '#B3261E' }}>{error}</span>}
    </div>
  )
}
