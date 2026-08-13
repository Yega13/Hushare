'use client'

import { useState } from 'react'
import { showAppToast } from '@/components/AppToast'

const BRAND = '#630826', INK = '#2A211C', MUTED = '#8A7A66', CARD = '#FFFFFF', BORDER = '#E4DAC9'

type AlbumLite = { id: string; slug: string; title: string; created_at: string; last_activity_at: string | null; retired: boolean; img: number; vid: number }
type UserResult = { type: 'user'; user: { id: string; email: string | null; created_at: string | null }; effectiveTier: string; subscription: { tier: string; status: string; current_period_end: string | null; product: string | null } | null; albums: AlbumLite[] }
type AlbumResult = { type: 'album'; album: { id: string; slug: string; title: string; created_at: string; last_activity_at: string | null; retired: boolean; guestUploads: boolean; img: number; vid: number; ownerEmail: string | null; ownerType: string } }
type NoneResult = { type: 'none'; hint?: string }
type Result = UserResult | AlbumResult | NoneResult

const fmt = (ts: string | null): string => (ts ? ts.replace('T', ' ').slice(0, 16) : '—')

const inputStyle: React.CSSProperties = { padding: '7px 10px', fontSize: 13, borderRadius: 8, border: `1px solid ${BORDER}`, background: CARD, color: INK }
const btn: React.CSSProperties = { padding: '7px 12px', fontSize: 12.5, fontWeight: 700, borderRadius: 8, border: 'none', background: BRAND, color: '#FDFAF5', cursor: 'pointer' }
const btnAlt: React.CSSProperties = { padding: '7px 12px', fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: `1px solid ${BORDER}`, background: CARD, color: BRAND, cursor: 'pointer' }
const badge: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#8A6D00', background: '#FBF3DE', border: '1px solid #EADFBE', borderRadius: 999, padding: '1px 8px', marginLeft: 8 }

export default function AdminSupportLookup() {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [tier, setTier] = useState<'studio' | 'pro'>('studio')
  const [months, setMonths] = useState(12)

  async function lookup() {
    const term = q.trim()
    if (!term) return
    setLoading(true)
    try {
      const r = await fetch(`/api/admin/lookup?q=${encodeURIComponent(term)}`, { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      setResult((await r.json()) as Result)
    } catch {
      showAppToast('Lookup failed', 'error')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  async function runAction(payload: Record<string, unknown>, key: string) {
    if (busy) return
    setBusy(key)
    try {
      const r = await fetch('/api/admin/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const j = (await r.json()) as { ok?: boolean; message?: string; error?: string }
      if (!r.ok || !j.ok) { showAppToast(j.error ?? 'Action failed', 'error'); return }
      showAppToast(j.message ?? 'Done')
      await lookup() // refresh so the change is reflected
    } catch {
      showAppToast('Action failed', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void lookup() }}
          placeholder="Email address, or an album link / slug…"
          style={{ ...inputStyle, flex: '1 1 320px', minWidth: 240, padding: '10px 14px', fontSize: 14 }}
        />
        <button onClick={() => void lookup()} disabled={loading || !q.trim()} style={{ ...btn, padding: '10px 22px', fontSize: 14, opacity: loading || !q.trim() ? 0.6 : 1 }}>
          {loading ? 'Looking…' : 'Look up'}
        </button>
      </div>

      {result?.type === 'none' && (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px', fontSize: 13, color: MUTED }}>
          {result.hint ?? 'Nothing found for that.'}
        </div>
      )}

      {result?.type === 'user' && (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>{result.user.email}</div>
            <div style={{ fontSize: 12, color: MUTED }}>joined {fmt(result.user.created_at)}</div>
          </div>
          <div style={{ marginTop: 8, fontSize: 13, color: INK }}>
            Plan: <strong style={{ color: BRAND }}>{result.effectiveTier}</strong>
            {result.subscription ? (
              <span style={{ color: MUTED }}> · {result.subscription.status} · until {fmt(result.subscription.current_period_end)}{result.subscription.product?.startsWith('comp-') ? ' · comp' : ''}</span>
            ) : (
              result.effectiveTier !== 'free' && <span style={{ color: MUTED }}> · admin (no subscription)</span>
            )}
          </div>

          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 12px', background: '#FBF3F5', borderRadius: 10 }}>
            <span style={{ fontSize: 12, color: MUTED }}>Grant comp:</span>
            <select value={tier} onChange={(e) => setTier(e.target.value as 'studio' | 'pro')} style={inputStyle}>
              <option value="studio">studio</option>
              <option value="pro">pro</option>
            </select>
            <input type="number" min={1} max={120} value={months} onChange={(e) => setMonths(Number(e.target.value))} style={{ ...inputStyle, width: 64 }} />
            <span style={{ fontSize: 12, color: MUTED }}>months</span>
            <button onClick={() => void runAction({ action: 'comp_sub', userId: result.user.id, tier, months }, 'comp')} disabled={busy === 'comp'} style={{ ...btn, opacity: busy === 'comp' ? 0.6 : 1 }}>
              {busy === 'comp' ? '…' : 'Grant'}
            </button>
          </div>

          <div style={{ marginTop: 14, fontSize: 12, color: MUTED, fontWeight: 600 }}>Albums ({result.albums.length})</div>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {result.albums.length === 0 && <div style={{ fontSize: 13, color: MUTED }}>No albums.</div>}
            {result.albums.map((a) => <AlbumRow key={a.id} a={a} busy={busy} onAction={runAction} />)}
          </div>
        </div>
      )}

      {result?.type === 'album' && (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>{result.album.title}{result.album.retired && <span style={badge}>retired</span>}</div>
            <a href={`/${result.album.slug}`} target="_blank" rel="noreferrer" style={{ color: BRAND, fontSize: 13 }}>open ↗</a>
          </div>
          <div style={{ marginTop: 8, fontSize: 13, color: INK }}>
            Owner: <strong>{result.album.ownerEmail ?? (result.album.ownerType === 'anonymous' ? 'anonymous (no account)' : 'registered')}</strong>
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: MUTED }}>
            {result.album.img} photos · {result.album.vid} videos · created {fmt(result.album.created_at)} · active {fmt(result.album.last_activity_at)}{result.album.guestUploads ? ' · guest uploads on' : ''}
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => void runAction({ action: 'extend_retention', albumId: result.album.id }, 'ret')} disabled={busy === 'ret'} style={{ ...btn, opacity: busy === 'ret' ? 0.6 : 1 }}>
              {busy === 'ret' ? '…' : 'Extend retention +1yr'}
            </button>
            {result.album.ownerType === 'registered' && (
              <button onClick={() => void runAction({ action: 'resend_owner_link', albumId: result.album.id }, 'link')} disabled={busy === 'link'} style={{ ...btnAlt, opacity: busy === 'link' ? 0.6 : 1 }}>
                {busy === 'link' ? '…' : 'Email owner link'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AlbumRow({ a, busy, onAction }: { a: AlbumLite; busy: string | null; onAction: (payload: Record<string, unknown>, key: string) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', border: `1px solid ${BORDER}`, borderRadius: 10, background: '#FDFBF7' }}>
      <div style={{ minWidth: 0, flex: '1 1 220px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>
          {a.title}{a.retired && <span style={badge}>retired</span>}
        </div>
        <div style={{ fontSize: 11, color: MUTED }}>{a.img} photos · {a.vid} videos · active {fmt(a.last_activity_at)}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <a href={`/${a.slug}`} target="_blank" rel="noreferrer" style={{ ...btnAlt, textDecoration: 'none' }}>open ↗</a>
        <button onClick={() => onAction({ action: 'extend_retention', albumId: a.id }, `ret-${a.id}`)} disabled={busy === `ret-${a.id}`} style={{ ...btnAlt, opacity: busy === `ret-${a.id}` ? 0.6 : 1 }}>
          {busy === `ret-${a.id}` ? '…' : '+1yr'}
        </button>
        <button onClick={() => onAction({ action: 'resend_owner_link', albumId: a.id }, `link-${a.id}`)} disabled={busy === `link-${a.id}`} style={{ ...btnAlt, opacity: busy === `link-${a.id}` ? 0.6 : 1 }}>
          {busy === `link-${a.id}` ? '…' : 'email link'}
        </button>
      </div>
    </div>
  )
}
