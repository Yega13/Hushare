'use client'

import { useState } from 'react'

type SyncResult = { total: number; created: number; updated: number; skipped: number; notes?: string[] }

// "Sync from Polar" — pulls every subscription from Polar and reconciles it into the DB
// (provisioning accounts by email when needed). Recovers payments the webhook missed; safe to
// re-run. Reloads on success so the new users/subscriptions show immediately.
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
      // Only reload when something actually changed — otherwise keep the skip reasons on screen.
      if ((data.created ?? 0) + (data.updated ?? 0) > 0) {
        setTimeout(() => window.location.reload(), 1500)
      }
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
          {' '}{result.skipped} skipped{(result.created + result.updated) > 0 ? '. Reloading…' : '.'}
          {result.notes && result.notes.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: '#8A6D00' }}>
              {result.notes.map((n, i) => <li key={i} style={{ fontSize: 12 }}>{n}</li>)}
            </ul>
          )}
        </div>
      )}
      {error && <span style={{ fontSize: 13, color: '#B3261E' }}>{error}</span>}
    </div>
  )
}
