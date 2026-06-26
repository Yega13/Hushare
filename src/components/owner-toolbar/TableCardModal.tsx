'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, X } from 'lucide-react'
import QRCode from 'qrcode'

type CardStyle = 'branded' | 'bw'

type Props = {
  shareUrl: string
  albumTitle: string
  onClose: () => void
}

const BODY_TEXT = 'Scan the QR code with your camera to upload your photos and videos.'
const RED = '#630826'

async function ensureFonts() {
  if (typeof document === 'undefined' || !document.fonts) return
  try {
    await Promise.all([
      document.fonts.load("bold 72px 'Playfair Display'"),
      document.fonts.load("bold italic 72px 'Playfair Display'"),
      document.fonts.load("400 72px 'Playfair Display'"),
      document.fonts.load("italic 72px 'Playfair Display'"),
    ])
  } catch { /* fonts already loaded or unavailable */ }
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('load failed'))
    img.src = src
  })
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w }
    else line = test
  }
  if (line) lines.push(line)
  return lines
}

function drawCorners(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, arm: number) {
  ctx.beginPath()
  ctx.moveTo(x, y + arm); ctx.lineTo(x, y); ctx.lineTo(x + arm, y)
  ctx.moveTo(x + w - arm, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + arm)
  ctx.moveTo(x + w, y + h - arm); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - arm, y + h)
  ctx.moveTo(x + arm, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - arm)
  ctx.stroke()
}

function pf(size: number, bold = false, italic = false) {
  return `${bold ? 'bold ' : ''}${italic ? 'italic ' : ''}${size}px 'Playfair Display', Georgia, serif`
}

export async function renderBrandedCard(canvas: HTMLCanvasElement, title: string, shareUrl: string, W: number) {
  const H = Math.round(W * (1700 / 1200))
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const s = W / 1200

  await ensureFonts()

  ctx.fillStyle = '#FAFAFA'
  ctx.fillRect(0, 0, W, H)

  const hdrH = Math.round(250 * s)
  ctx.fillStyle = RED
  ctx.fillRect(0, 0, W, hdrH)

  try {
    const logo = await loadImg('/logo/logo-light-transparent.png')
    const mh = Math.round(118 * s), mw = Math.round(520 * s)
    const sc = Math.min(mh / logo.naturalHeight, mw / logo.naturalWidth)
    const lw = logo.naturalWidth * sc, lh = logo.naturalHeight * sc
    ctx.drawImage(logo, (W - lw) / 2, (hdrH - lh) / 2, lw, lh)
  } catch {
    ctx.fillStyle = '#FFFFFF'
    ctx.font = pf(Math.round(90 * s), true)
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('HUSHARE', W / 2, hdrH / 2)
  }

  ctx.fillStyle = '#9B1727'
  ctx.fillRect(0, hdrH, W, Math.round(5 * s))

  let y = hdrH + Math.round(76 * s)
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'

  const hsz = Math.round(76 * s)
  ctx.font = pf(hsz, true)
  ctx.fillStyle = '#1A1A1A'
  for (const l of wrap(ctx, (title || 'CAPTURE THE MOMENT').toUpperCase(), W * 0.80)) {
    ctx.fillText(l, W / 2, y); y += Math.round(hsz * 1.24)
  }
  y += Math.round(32 * s)

  ctx.strokeStyle = RED; ctx.lineWidth = Math.round(3 * s)
  const rw = Math.round(260 * s)
  ctx.beginPath(); ctx.moveTo((W - rw) / 2, y); ctx.lineTo((W + rw) / 2, y); ctx.stroke()
  y += Math.round(42 * s)

  const bsz = Math.round(39 * s)
  ctx.font = pf(bsz)
  ctx.fillStyle = '#555555'
  for (const l of wrap(ctx, BODY_TEXT, W * 0.70)) { ctx.fillText(l, W / 2, y); y += Math.round(bsz * 1.68) }
  y += Math.round(46 * s)

  const qrSz = Math.min(Math.round(430 * s), H - y - Math.round(100 * s))
  if (qrSz > 30) {
    const du = await QRCode.toDataURL(shareUrl, { width: qrSz, margin: 1, color: { dark: RED, light: '#FAFAFA' } })
    ctx.drawImage(await loadImg(du), (W - qrSz) / 2, y, qrSz, qrSz)
  }

  ctx.font = pf(Math.round(30 * s))
  ctx.fillStyle = '#BBBBBB'; ctx.textBaseline = 'alphabetic'
  ctx.fillText('hushare.space', W / 2, H - Math.round(46 * s))
}

export async function renderBWCard(canvas: HTMLCanvasElement, title: string, shareUrl: string, W: number) {
  const H = Math.round(W * (1700 / 1200))
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const s = W / 1200

  await ensureFonts()

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, W, H)

  const p1 = Math.round(26 * s)
  ctx.strokeStyle = '#111111'; ctx.lineWidth = Math.round(3 * s)
  ctx.strokeRect(p1, p1, W - p1 * 2, H - p1 * 2)
  const p2 = p1 + Math.round(13 * s)
  ctx.lineWidth = Math.round(1 * s)
  ctx.strokeRect(p2, p2, W - p2 * 2, H - p2 * 2)

  ctx.lineWidth = Math.round(2.5 * s)
  drawCorners(ctx, p2, p2, W - p2 * 2, H - p2 * 2, Math.round(52 * s))

  let y = p2 + Math.round(80 * s)
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'

  const brsz = Math.round(54 * s)
  ;(ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${Math.round(13 * s)}px`
  ctx.font = pf(brsz, true)
  ctx.fillStyle = '#111111'
  ctx.fillText('HUSHARE', W / 2, y)
  ;(ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px'
  y += Math.round(brsz * 1.2 + 24 * s)

  ctx.strokeStyle = '#111111'; ctx.lineWidth = Math.round(1.5 * s)
  const rl = Math.round(220 * s)
  ctx.beginPath(); ctx.moveTo((W - rl) / 2, y); ctx.lineTo((W + rl) / 2, y); ctx.stroke()
  y += Math.round(52 * s)

  const hsz = Math.round(72 * s)
  ctx.font = pf(hsz, true, true)
  ctx.fillStyle = '#111111'
  for (const l of wrap(ctx, title || 'Capture the Moment', W * 0.76)) {
    ctx.fillText(l, W / 2, y); y += Math.round(hsz * 1.25)
  }
  y += Math.round(34 * s)

  const bsz = Math.round(37 * s)
  ctx.font = pf(bsz)
  ctx.fillStyle = '#555555'
  for (const l of wrap(ctx, BODY_TEXT, W * 0.66)) { ctx.fillText(l, W / 2, y); y += Math.round(bsz * 1.72) }
  y += Math.round(48 * s)

  const qrSz = Math.min(Math.round(410 * s), H - y - Math.round(130 * s))
  if (qrSz > 30) {
    const du = await QRCode.toDataURL(shareUrl, { width: qrSz, margin: 1, color: { dark: '#111111', light: '#FFFFFF' } })
    ctx.drawImage(await loadImg(du), (W - qrSz) / 2, y, qrSz, qrSz)
  }

  ctx.font = pf(Math.round(30 * s), false, true)
  ctx.fillStyle = '#AAAAAA'; ctx.textBaseline = 'alphabetic'
  ctx.fillText('hushare.space', W / 2, H - p2 - Math.round(36 * s))
}

export default function TableCardModal({ shareUrl, albumTitle, onClose }: Props) {
  const router = useRouter()
  const [style, setStyle] = useState<CardStyle>('branded')
  const [downloading, setDownloading] = useState(false)
  const [dlFormat, setDlFormat] = useState<'png' | 'pdf'>('png')
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const heading = albumTitle || 'Capture the Moment'

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    void (style === 'branded' ? renderBrandedCard : renderBWCard)(c, heading, shareUrl, 260)
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
    } finally {
      setDownloading(false)
    }
  }

  function openEditor() {
    const p = new URLSearchParams({ url: shareUrl, title: albumTitle || '' })
    router.push(`/card-editor?${p}`)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="relative rounded-2xl shadow-2xl overflow-y-auto"
        style={{ background: '#FFFFFF', width: '100%', maxWidth: 520, maxHeight: '95dvh', padding: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="font-semibold text-sm" style={{ color: '#254F22' }}>Table card</span>
          <button onClick={onClose} style={{ color: '#A89880' }}><X className="w-4 h-4" /></button>
        </div>

        <div className="flex gap-2 mb-5">
          {(['branded', 'bw'] as CardStyle[]).map((s) => (
            <button
              key={s}
              onClick={() => setStyle(s)}
              className="flex-1 py-2.5 text-xs font-semibold rounded-xl transition"
              style={{
                background: style === s ? '#254F22' : '#F5F0E8',
                color: style === s ? '#FDFAF5' : '#5C3D2E',
                border: '1px solid ' + (style === s ? '#254F22' : '#DDD5C5'),
              }}
            >
              {s === 'branded' ? 'Hushare Branded' : 'B&W'}
            </button>
          ))}
          <button
            onClick={openEditor}
            className="flex-1 py-2.5 text-xs font-semibold rounded-xl transition hover:opacity-80"
            style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}
          >
            Custom
          </button>
        </div>

        <div className="flex gap-5 items-start">
          <canvas
            ref={canvasRef}
            style={{
              width: 152,
              height: Math.round(152 * 1700 / 1200),
              flexShrink: 0,
              borderRadius: 10,
              border: '1px solid #E5E5E5',
              boxShadow: '0 2px 14px rgba(0,0,0,0.10)',
            }}
          />
          <div className="flex-1 space-y-3 pt-1">
            <p className="text-xs leading-relaxed" style={{ color: '#7C5C3E' }}>
              {style === 'branded'
                ? 'Hushare red & white with logo — Playfair Display.'
                : 'Elegant B&W, double border, corner brackets — Playfair Display.'}
              {' '}1200×1700 px, print-ready.
            </p>
            <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid #DDD5C5' }}>
              {(['png', 'pdf'] as const).map(f => (
                <button key={f} onClick={() => setDlFormat(f)}
                  className="flex-1 py-1.5 text-xs font-semibold transition"
                  style={{ background: dlFormat === f ? '#254F22' : '#F5F0E8', color: dlFormat === f ? '#FDFAF5' : '#5C3D2E' }}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="w-full flex items-center justify-center gap-2 font-semibold rounded-xl py-3 transition hover:opacity-90 disabled:opacity-50 text-sm"
              style={{ background: '#254F22', color: '#FDFAF5' }}
            >
              <Download className="w-4 h-4" />
              {downloading ? 'Generating…' : `Download ${dlFormat.toUpperCase()}`}
            </button>
            <p className="text-xs" style={{ color: '#A89880' }}>
              A5 / 5×7&quot; — table cards, tent cards, signage
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
