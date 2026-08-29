'use client'

import { useState } from 'react'

const BRAND = '#630826'
const INK = '#2A211C'
const MUTED = '#8A7A66'
const CARD = '#FFFFFF'
const BORDER = '#E4DAC9'

// R2 is $0.015 per GB per month and charges nothing for egress, so the photos themselves are not
// where a photo-sharing bill goes wrong — 100 GB is $1.50 a month. What goes wrong is paying that
// rate forever for objects nothing points at, because every deletion path works from database rows
// and an object with no row is unreachable by all of them.
const R2_USD_PER_GB_MONTH = 0.015

type Audit = {
  scannedObjects: number
  scannedBytes: number
  referencedObjects: number
  orphanObjects: number
  orphanBytes: number
  truncated: boolean
  byPrefix: { prefix: string; objects: number; bytes: number }[]
  sample: string[]
}

function gb(bytes: number): number { return bytes / 1024 / 1024 / 1024 }
function fmtSize(bytes: number): string {
  const g = gb(bytes)
  return g >= 1 ? `${g.toFixed(2)} GB` : `${(bytes / 1024 / 1024).toFixed(0)} MB`
}
function fmtMoney(bytes: number): string {
  const monthly = gb(bytes) * R2_USD_PER_GB_MONTH
  return monthly < 0.01 ? '<$0.01' : `$${monthly.toFixed(2)}`
}

// Run on demand, never on page load: it lists the whole bucket and reads every photo row, which is
// the most expensive thing on this page and pointless to repeat on every visit.
export default function AdminStorageAudit() {
  const [data, setData] = useState<Audit | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function scan() {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/admin/storage-audit', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      setData(await res.json() as Audit)
    } catch {
      setError('Scan failed — try again.')
    } finally {
      setLoading(false)
    }
  }

  const wastePct = data && data.scannedBytes > 0
    ? (data.orphanBytes / data.scannedBytes) * 100
    : 0

  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 18px', marginBottom: 28 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: INK }}>Storage</p>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: MUTED, maxWidth: 560 }}>
            Files in R2 that no album, photo or thumbnail points at. Nothing can ever find or delete
            those, so they are billed every month forever. This only counts them — it deletes nothing.
          </p>
        </div>
        <button
          onClick={() => void scan()}
          disabled={loading}
          style={{
            padding: '10px 20px', fontSize: 14, fontWeight: 700, color: '#FDFAF5',
            background: BRAND, border: 'none', borderRadius: 10,
            cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Scanning…' : data ? 'Scan again' : 'Scan bucket'}
        </button>
      </div>

      {error && <p style={{ margin: '12px 0 0', fontSize: 13, color: '#B0002A' }}>{error}</p>}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 12, marginTop: 16 }}>
            {[
              ['In the bucket', `${data.scannedObjects.toLocaleString('en-US')} files`, fmtSize(data.scannedBytes)],
              ['Accounted for', `${(data.scannedObjects - data.orphanObjects).toLocaleString('en-US')} files`, fmtSize(data.scannedBytes - data.orphanBytes)],
              ['Nothing points at', `${data.orphanObjects.toLocaleString('en-US')} files`, `${fmtSize(data.orphanBytes)} · ${fmtMoney(data.orphanBytes)}/mo`],
              ['Wasted', `${wastePct.toFixed(1)}%`, 'of what you pay for'],
            ].map(([label, big, sub]) => (
              <div key={label} style={{ background: '#FBF8F3', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: INK, marginTop: 4 }}>{big}</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{sub}</div>
              </div>
            ))}
          </div>

          {data.truncated && (
            <p style={{ margin: '12px 0 0', fontSize: 12.5, color: '#8A6D00' }}>
              The bucket is larger than one scan covers, so these are partial figures.
            </p>
          )}

          <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {data.byPrefix.map((p) => (
              <span key={p.prefix} style={{ fontSize: 12, background: '#FBF3F5', color: BRAND, border: '1px solid #EAD9DE', borderRadius: 999, padding: '4px 10px' }}>
                {p.prefix}/ <strong>{p.objects.toLocaleString('en-US')}</strong> · {fmtSize(p.bytes)}
              </span>
            ))}
          </div>

          {data.sample.length > 0 && (
            <details style={{ marginTop: 12 }}>
              {/* The keys themselves, so the number can be checked by hand before anyone acts on
                  it. A count nobody has spot-checked is not evidence for deleting anything. */}
              <summary style={{ fontSize: 12.5, color: MUTED, cursor: 'pointer' }}>
                Show {data.sample.length} example unreferenced keys
              </summary>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: INK, lineHeight: 1.7, wordBreak: 'break-all' }}>
                {data.sample.map((k) => <li key={k}>{k}</li>)}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  )
}
