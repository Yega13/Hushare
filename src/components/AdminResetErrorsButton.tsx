'use client'

import { useState } from 'react'

// "Clear errors" — marks all current errors resolved (archived, not deleted). They drop off the
// admin view and auto-delete after 30 days, so new errors surface. Reloads to show the cleared view.
export default function AdminResetErrorsButton({ disabled }: { disabled?: boolean }) {
  const [busy, setBusy] = useState(false)

  async function reset() {
    if (!confirm('Clear all current errors? They stay recoverable for 30 days, then auto-delete.')) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/errors/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) { window.location.reload(); return }
      alert('Could not clear errors.')
    } catch {
      alert('Could not clear errors.')
    }
    setBusy(false)
  }

  return (
    <button
      type="button"
      onClick={reset}
      disabled={busy || disabled}
      style={{
        fontSize: 12, fontWeight: 600, color: '#630826',
        background: '#FBEEF0', border: '1px solid #EAD3D8', borderRadius: 999,
        padding: '5px 12px', cursor: busy || disabled ? 'not-allowed' : 'pointer',
        opacity: busy || disabled ? 0.5 : 1,
      }}
    >
      {busy ? 'Clearing…' : 'Clear errors'}
    </button>
  )
}
