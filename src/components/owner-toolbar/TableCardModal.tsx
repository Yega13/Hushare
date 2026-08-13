import QRCode from 'qrcode'
import { qrForegroundColor } from '@/lib/album-design'

// Canvas renderers for the printable table card — the only two exports actually used (by
// ShareMenu.tsx's inline TableCardView). This file used to also export a standalone modal
// component wrapping these, but it was superseded by that inline view and never deleted; it had
// no remaining importers anywhere in the app.

const BODY_TEXT = 'Scan the QR code with your camera to upload your photos and videos.'

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

export async function renderBrandedCard(canvas: HTMLCanvasElement, title: string, shareUrl: string, W: number, accentColor?: string | null) {
  const brand = qrForegroundColor(accentColor)
  const H = Math.round(W * (1700 / 1200))
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const s = W / 1200

  await ensureFonts()

  ctx.fillStyle = '#FAFAFA'
  ctx.fillRect(0, 0, W, H)

  const hdrH = Math.round(255 * s)
  ctx.fillStyle = brand
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

  let y = hdrH + Math.round(76 * s)
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'

  const hsz = Math.round(76 * s)
  ctx.font = pf(hsz, true)
  ctx.fillStyle = '#1A1A1A'
  for (const l of wrap(ctx, (title || 'CAPTURE THE MOMENT').toUpperCase(), W * 0.80)) {
    ctx.fillText(l, W / 2, y); y += Math.round(hsz * 1.24)
  }
  y += Math.round(32 * s)

  ctx.strokeStyle = brand; ctx.lineWidth = Math.round(3 * s)
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
    const du = await QRCode.toDataURL(shareUrl, { width: qrSz, margin: 1, color: { dark: brand, light: '#FAFAFA' } })
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
