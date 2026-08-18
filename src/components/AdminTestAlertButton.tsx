'use client'

import { useState } from 'react'

// Pairs with /api/admin/test-alert. Shows the outcome inline, including the provider's error text,
// because the whole reason this exists is that a failed alert previously looked like nothing.
export default function AdminTestAlertButton() {
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'err'; msg?: string }>({ kind: 'idle' })

  async function send() {
    setState({ kind: 'busy' })
    try {
      const res = await fetch('/api/admin/test-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const body = await res.json().catch(() => ({})) as { ok?: boolean; to?: string; error?: string }
      if (res.ok && body.ok) {
        setState({ kind: 'ok', msg: `Sent to ${body.to}. If it is not in your inbox within a minute, check spam.` })
      } else {
        setState({ kind: 'err', msg: body.error ?? `Failed (${res.status})` })
      }
    } catch (e) {
      setState({ kind: 'err', msg: e instanceof Error ? e.message : 'Network error' })
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={send}
        disabled={state.kind === 'busy'}
        style={{
          fontSize: 13, fontWeight: 600, color: '#630826', background: '#FBEEF0',
          border: '1px solid #EAD3D8', borderRadius: 999, padding: '7px 14px',
          cursor: state.kind === 'busy' ? 'not-allowed' : 'pointer', opacity: state.kind === 'busy' ? 0.6 : 1,
        }}
      >
        {state.kind === 'busy' ? 'Sending…' : 'Send a test alert'}
      </button>
      {state.msg && (
        <p style={{ margin: '8px 0 0', fontSize: 12.5, color: state.kind === 'ok' ? '#1F5136' : '#B3261E' }}>
          {state.msg}
        </p>
      )}
    </div>
  )
}
