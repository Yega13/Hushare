'use client'

import { useState } from 'react'

// Remove one subscription ROW from the dashboard's ledger.
//
// The confirmation says which row and what it is, because a person can hold several: a cancelled
// real subscription and a comped grant sit side by side, and they are not interchangeable. Removing
// the wrong one either restores access somebody lost or strips access somebody is paying for.
//
// It does NOT cancel anything at Polar. For a live paid row the confirmation says so out loud
// rather than letting an admin discover it when the next reconcile puts the row back.

type Props = {
  subscriptionId: string
  email: string
  tier: string
  status: string
  comped: boolean
}

export default function AdminDeleteSubButton({ subscriptionId, email, tier, status, comped }: Props) {
  const [busy, setBusy] = useState(false)

  async function del() {
    const what = comped ? 'comped' : status === 'active' ? 'ACTIVE PAID' : status
    const warning = !comped && status === 'active'
      ? '\n\nThis does NOT cancel their Polar subscription. They keep being billed, and the next reconcile will bring this row back. Cancel in Polar first.'
      : ''
    if (!confirm(`Remove the ${what} ${tier} row for ${email}?${warning}`)) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_sub', subscriptionId }),
      })
      const j = await res.json().catch(() => ({})) as { error?: string; message?: string }
      if (res.ok) {
        if (j.message) alert(j.message)
        window.location.reload()
        return
      }
      alert(`Remove failed: ${j.error ?? res.status}`)
    } catch {
      alert('Remove failed.')
    }
    setBusy(false)
  }

  return (
    <button
      type="button"
      onClick={del}
      disabled={busy}
      title={`Remove this ${tier} row`}
      style={{
        color: '#C0392B', fontWeight: 600, fontSize: 12,
        background: 'none', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', padding: 0,
        opacity: busy ? 0.5 : 1,
      }}
    >
      {busy ? '…' : 'remove'}
    </button>
  )
}
