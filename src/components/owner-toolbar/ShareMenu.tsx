'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Copy, Download, QrCode, Share2, SquareMenu, X } from 'lucide-react'
import { useIsNarrow } from '@/lib/useIsNarrow'
import { renderBrandedCard, renderBWCard } from './TableCardModal'

type CardStyle = 'branded' | 'bw'

type Props = {
  copied: 'share' | 'owner' | null
  ownerUrl: string | null
  shareUrl: string
  albumTitle: string
  onClose: () => void
  onCopy: (type: 'share' | 'owner') => void
}

async function downloadQr(shareUrl: string, albumTitle: string, format: 'png' | 'svg') {
  const QRCode = (await import('qrcode')).default
  const slug = (albumTitle || 'album').replace(/[^a-z0-9]/gi, '-').toLowerCase()

  if (format === 'svg') {
    const svgString = await QRCode.toString(shareUrl, {
      type: 'svg', width: 600, margin: 2,
      color: { dark: '#630826', light: '#FFFFFF' },
    })
    const blob = new Blob([svgString], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.download = `${slug}-qr.svg`
    link.href = url
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    return
  }

  const canvas = document.createElement('canvas')
  await QRCode.toCanvas(canvas, shareUrl, { width: 600, margin: 2, color: { dark: '#630826', light: '#FFFFFF' } })
  const link = document.createElement('a')
  link.download = `${slug}-qr.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}

// ─── Inline table card selector (no modal overlay) ────────────────────────────

function TableCardView({ shareUrl, albumTitle, onBack }: { shareUrl: string; albumTitle: string; onBack: () => void }) {
  const router = useRouter()
  const [style, setStyle] = useState<CardStyle>('branded')
  const [downloading, setDownloading] = useState(false)
  const [dlFormat, setDlFormat] = useState<'png' | 'pdf'>('png')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const heading = albumTitle || 'Capture the Moment'

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    void (style === 'branded' ? renderBrandedCard : renderBWCard)(c, heading, shareUrl, 240)
  }, [style, heading, shareUrl])

  async function handleDownload() {
    setDownloading(true)
    try {
      const off = document.createElement('canvas')
      await (style === 'branded' ? renderBrandedCard : renderBWCard)(off, heading, shareUrl, 1200)
      const slug = (albumTitle || 'album').replace(/[^a-z0-9]/gi, '-').toLowerCase()

      if (dlFormat === 'pdf') {
        const { jsPDF } = await import('jspdf')
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' })
        pdf.addImage(off.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 148, 210)
        pdf.save(`${slug}-table-card.pdf`)
      } else {
        const link = document.createElement('a')
        link.download = `${slug}-table-card.png`
        link.href = off.toDataURL('image/png')
        link.click()
      }
    } finally { setDownloading(false) }
  }

  function openEditor() {
    const p = new URLSearchParams({ url: shareUrl, title: albumTitle || '' })
    router.push(`/card-editor?${p}`)
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <button onClick={onBack} className="flex items-center gap-1 text-xs font-medium rounded-lg px-2 py-1 transition hover:opacity-70"
          style={{ color: '#7C5C3E', background: '#F5F0E8', border: '1px solid #DDD5C5' }}>
          <ArrowLeft className="w-3 h-3" /> Back
        </button>
        <span className="text-sm font-semibold" style={{ color: '#630826' }}>Table card</span>
      </div>

      <div className="flex gap-1.5 mb-3">
        {(['branded', 'bw'] as CardStyle[]).map(s => (
          <button key={s} onClick={() => setStyle(s)}
            className="flex-1 py-2 text-xs font-semibold rounded-xl transition"
            style={{ background: style === s ? '#630826' : '#F5F0E8', color: style === s ? '#FDFAF5' : '#5C3D2E', border: '1px solid ' + (style === s ? '#630826' : '#DDD5C5') }}>
            {s === 'branded' ? 'Hushare Branded' : 'B&W'}
          </button>
        ))}
        <button onClick={openEditor}
          className="flex-1 py-2 text-xs font-semibold rounded-xl transition hover:opacity-80"
          style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}>
          Custom
        </button>
      </div>

      <div className="flex gap-3 items-start">
        <canvas ref={canvasRef}
          style={{ width: 130, height: Math.round(130 * 1700 / 1200), flexShrink: 0, borderRadius: 8, border: '1px solid #E5E5E5', boxShadow: '0 2px 10px rgba(0,0,0,0.08)' }} />
        <div className="flex-1 space-y-2 pt-1">
          <p className="text-xs leading-relaxed" style={{ color: '#7C5C3E' }}>
            {style === 'branded' ? 'Hushare red & white, Playfair Display.' : 'Elegant B&W, double border.'}
            {' '}Print-ready 1200×1700 px.
          </p>
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid #DDD5C5' }}>
            {(['png', 'pdf'] as const).map(f => (
              <button key={f} onClick={() => setDlFormat(f)}
                className="flex-1 py-1 text-xs font-semibold transition"
                style={{ background: dlFormat === f ? '#630826' : '#F5F0E8', color: dlFormat === f ? '#FDFAF5' : '#5C3D2E' }}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
          <button onClick={handleDownload} disabled={downloading}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold rounded-xl py-2.5 transition hover:opacity-90 disabled:opacity-50"
            style={{ background: '#630826', color: '#FDFAF5' }}>
            <Download className="w-3.5 h-3.5" />
            {downloading ? 'Generating…' : `Download ${dlFormat.toUpperCase()}`}
          </button>
          <p className="text-xs" style={{ color: '#A89880' }}>A5 / 5×7&quot;</p>
        </div>
      </div>
    </div>
  )
}

// ─── Main share menu ──────────────────────────────────────────────────────────

export default function ShareMenu({ copied, ownerUrl, shareUrl, albumTitle, onClose, onCopy }: Props) {
  const [view, setView] = useState<'main' | 'tablecard'>('main')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [qrFormat, setQrFormat] = useState<'png' | 'svg'>('png')

  useEffect(() => {
    let cancelled = false
    import('qrcode').then(({ default: QRCode }) => {
      QRCode.toDataURL(shareUrl, { width: 300, margin: 2, color: { dark: '#630826', light: '#FFFFFF' } })
        .then((url) => { if (!cancelled) setQrDataUrl(url) })
    })
    return () => { cancelled = true }
  }, [shareUrl])

  async function handleShare() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ url: shareUrl, title: albumTitle, text: `Check out "${albumTitle}" on Hushare` }); return } catch { /* fall through */ }
    }
    try { await navigator.clipboard.writeText(shareUrl); onCopy('share') } catch { /* ignore */ }
  }

  const isNarrow = useIsNarrow()
  const menuStyle = { background: '#FFFFFF', border: '1px solid #DDD5C5', padding: 16 } as const
  const menuInner = (
    <>
      {view === 'tablecard' ? (
        <TableCardView shareUrl={shareUrl} albumTitle={albumTitle} onBack={() => setView('main')} />
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <span className="font-semibold text-sm" style={{ color: '#630826' }}>Send link</span>
            <button onClick={onClose} style={{ color: '#A89880', cursor: 'pointer' }} aria-label="Close share menu">
              <X className="w-4 h-4" />
            </button>
          </div>

          <button
            className="hush-hover-lift w-full flex items-center justify-between gap-3 rounded-xl px-3 py-3 mb-2 text-left transition hover:opacity-90"
            style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', cursor: 'pointer' }}
            onClick={handleShare}
          >
            <span>
              <span className="block text-sm font-semibold" style={{ color: '#630826' }}>Share album</span>
              <span className="block text-xs" style={{ color: '#8B6F4E' }}>Send via messages, apps or copy</span>
            </span>
            <Share2 className="w-4 h-4 flex-none" style={{ color: '#7C5C3E' }} />
          </button>

          <button
            className="hush-hover-lift w-full flex items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition hover:opacity-90"
            style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', cursor: 'pointer' }}
            onClick={() => onCopy('share')}
          >
            <span>
              <span className="block text-sm font-semibold" style={{ color: '#630826' }}>Guest share link</span>
              <span className="block text-xs truncate" style={{ color: '#8B6F4E', maxWidth: 220 }}>{shareUrl}</span>
            </span>
            {copied === 'share' ? <Check className="w-4 h-4 flex-none" style={{ color: '#630826' }} /> : <Copy className="w-4 h-4 flex-none" style={{ color: '#7C5C3E' }} />}
          </button>

          {ownerUrl && (
            <button
              className="hush-hover-lift w-full flex items-center justify-between gap-3 rounded-xl px-3 py-3 mt-2 text-left transition hover:opacity-90"
              style={{ background: '#E8F0FB', border: '1px solid #B8CCEE', cursor: 'pointer' }}
              onClick={() => onCopy('owner')}
            >
              <span>
                <span className="block text-sm font-semibold" style={{ color: '#1B3A6B' }}>Owner management link</span>
                <span className="block text-xs truncate" style={{ color: '#45628C', maxWidth: 220 }}>{ownerUrl}</span>
              </span>
              {copied === 'owner' ? <Check className="w-4 h-4" style={{ color: '#1B3A6B' }} /> : <Copy className="w-4 h-4" style={{ color: '#1B3A6B' }} />}
            </button>
          )}

          <div className="mt-3 rounded-xl p-3" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
            <div className="flex items-center gap-3">
              {qrDataUrl && <Image src={qrDataUrl} alt="QR Code" width={92} height={92} unoptimized />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold flex items-center gap-2" style={{ color: '#630826' }}>
                  <QrCode className="w-4 h-4" />
                  QR code
                </p>
                <p className="text-xs leading-relaxed" style={{ color: '#7C5C3E' }}>Guests scan this to open the album.</p>
                <div className="mt-2 flex gap-2 flex-wrap items-center">
                  <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid #DDD5C5' }}>
                    {(['png', 'svg'] as const).map(f => (
                      <button key={f} onClick={() => setQrFormat(f)}
                        className="px-2.5 py-1 text-xs font-semibold transition"
                        style={{ background: qrFormat === f ? '#630826' : '#F5F0E8', color: qrFormat === f ? '#FDFAF5' : '#5C3D2E' }}>
                        {f.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <button
                    className="flex items-center gap-1.5 text-xs font-semibold rounded-lg px-2.5 py-1.5 transition hover:opacity-80"
                    style={{ background: '#630826', color: '#FDFAF5' }}
                    onClick={() => downloadQr(shareUrl, albumTitle, qrFormat)}
                  >
                    <Download className="w-3 h-3" />
                    Download {qrFormat.toUpperCase()}
                  </button>
                  <button
                    className="flex items-center gap-1.5 text-xs font-semibold rounded-lg px-2.5 py-1.5 transition hover:opacity-80"
                    style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}
                    onClick={() => setView('tablecard')}
                  >
                    <SquareMenu className="w-3 h-3" />
                    Table card
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )

  // Desktop: a dropdown anchored under the Share button (the parent wrap is position:relative).
  if (!isNarrow) {
    return (
      <div
        className="hush-share-dropdown absolute left-0 top-full mt-2 z-50 rounded-2xl shadow-xl"
        style={{ ...menuStyle, width: 340 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {menuInner}
      </div>
    )
  }

  // Mobile: a centred panel over a backdrop, portaled to <body>.
  return createPortal(
    <>
      <div className="hush-share-backdrop" onClick={onClose} />
      <div
        className="hush-share-menu rounded-2xl shadow-xl"
        style={menuStyle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {menuInner}
      </div>
    </>,
    document.body,
  )
}
