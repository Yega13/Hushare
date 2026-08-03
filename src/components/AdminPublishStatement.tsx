'use client'

import { useState } from 'react'

// Admin-only: compose and publish a statement to the public /statement archive.
// Body accepts HTML (headings, <p>, <table>, and the helper classes used on the statement page:
// .hush-callout, .hush-sign / .name / .role). Trusted admin content, rendered as-is.
export default function AdminPublishStatement() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [date, setDate] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState<{ url: string } | null>(null)

  async function publish() {
    setBusy(true); setError(''); setOk(null)
    try {
      const res = await fetch('/api/admin/statements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, summary, body_html: bodyHtml, published_at: date || undefined }),
      })
      const data = await res.json().catch(() => ({})) as { url?: string; error?: string }
      if (!res.ok) { setError(data.error ?? `Failed (${res.status})`); setBusy(false); return }
      setOk({ url: data.url ?? '/statement' })
      setBusy(false)
      setTitle(''); setSummary(''); setDate(''); setBodyHtml('')
    } catch {
      setError('Request failed.'); setBusy(false)
    }
  }

  const field: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #DDD5C5',
    background: '#FFFFFF', color: '#2A211C', fontSize: 13, marginTop: 4,
  }
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#2A211C', display: 'block', marginTop: 12 }

  return (
    <div>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{ fontSize: 13, fontWeight: 600, color: '#630826', background: 'transparent', border: '1px solid #630826', borderRadius: 999, padding: '8px 16px', cursor: 'pointer' }}
        >
          + New announcement
        </button>
      ) : (
        <div style={{ marginTop: 4 }}>
          <label style={label}>Title
            <input style={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A more capable Hushare…" />
          </label>
          <label style={label}>Summary <span style={{ fontWeight: 400, color: '#8B7355' }}>(one line, shown in the list)</span>
            <input style={field} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Live walls, moderation & clearer plans." />
          </label>
          <label style={label}>Date <span style={{ fontWeight: 400, color: '#8B7355' }}>(optional — defaults to now)</span>
            <input style={field} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label style={label}>Body <span style={{ fontWeight: 400, color: '#8B7355' }}>(HTML: &lt;p&gt;, &lt;h2&gt;, &lt;table&gt;, &lt;strong&gt;…)</span>
            <textarea style={{ ...field, minHeight: 220, fontFamily: 'monospace', lineHeight: 1.5 }} value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} placeholder="<p>…</p>" />
          </label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={publish}
              disabled={busy || !title.trim() || !bodyHtml.trim()}
              style={{ fontSize: 13, fontWeight: 600, color: '#FDFAF5', background: '#630826', border: 'none', borderRadius: 999, padding: '8px 18px', cursor: busy ? 'not-allowed' : 'pointer', opacity: (busy || !title.trim() || !bodyHtml.trim()) ? 0.5 : 1 }}
            >
              {busy ? 'Publishing…' : 'Publish'}
            </button>
            <button type="button" onClick={() => setOpen(false)} style={{ fontSize: 13, color: '#8B7355', background: 'transparent', border: 'none', cursor: 'pointer' }}>Cancel</button>
            {error && <span style={{ fontSize: 13, color: '#B3261E' }}>{error}</span>}
            {ok && <span style={{ fontSize: 13, color: '#2A211C' }}>✓ Published — <a href={ok.url} target="_blank" rel="noreferrer" style={{ color: '#630826', textDecoration: 'underline' }}>view</a></span>}
          </div>
        </div>
      )}
    </div>
  )
}
