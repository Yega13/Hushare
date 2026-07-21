'use client'

import { useState } from 'react'

// Admin-only "delete" action per album row. Confirms (this is destructive + irreversible — full
// R2/Stream/DB cleanup), then reloads the admin page so the row disappears.
export default function AdminDeleteAlbumButton({ albumId, title }: { albumId: string; title: string }) {
  const [busy, setBusy] = useState(false)

  async function del() {
    if (!confirm(`Permanently delete "${title || 'Untitled'}" and ALL its photos and videos?\n\nThis cannot be undone.`)) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/album/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ albumId }),
      })
      if (res.ok) { window.location.reload(); return }
      const j = await res.json().catch(() => ({})) as { error?: string }
      alert(`Delete failed: ${j.error ?? res.status}`)
    } catch {
      alert('Delete failed.')
    }
    setBusy(false)
  }

  return (
    <button
      type="button"
      onClick={del}
      disabled={busy}
      style={{
        color: '#C0392B', fontWeight: 600, fontSize: 13,
        background: 'none', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', padding: 0,
        opacity: busy ? 0.5 : 1,
      }}
    >
      {busy ? 'deleting…' : 'delete'}
    </button>
  )
}
