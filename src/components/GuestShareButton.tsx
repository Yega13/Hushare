'use client'

import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import { Check, Copy, Download, QrCode, Share2, X } from 'lucide-react'
import { showAppToast } from '@/components/AppToast'

type Props = {
  shareUrl: string
  albumTitle: string
}

export default function GuestShareButton({ shareUrl, albumTitle }: Props) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    import('qrcode').then(({ default: QRCode }) => {
      QRCode.toDataURL(shareUrl, { width: 300, margin: 2, color: { dark: '#630826', light: '#FFFFFF' } })
        .then((url) => { if (!cancelled) setQrDataUrl(url) })
    })
    return () => { cancelled = true }
  }, [shareUrl])

  useEffect(() => {
    if (!open) return
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      showAppToast('Link copied.')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      showAppToast('Could not copy — please copy the link manually.', 'error')
    }
  }

  async function handleShare() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          url: shareUrl,
          title: albumTitle,
          text: `Check out "${albumTitle}" on Hushare`,
        })
        return
      } catch {
        // cancelled or unsupported — fall through to copy
      }
    }
    await copyLink()
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="hush-hover-lift flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition hover:opacity-90"
        style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#630826' }}
        onClick={() => setOpen((v) => !v)}
      >
        <Share2 className="w-4 h-4" />
        Share
      </button>

      {open && (
        <div
          className="hush-menu-pop absolute right-0 top-full mt-2 z-50 rounded-2xl shadow-xl"
          style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', width: 300, padding: 16 }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="font-semibold text-sm" style={{ color: '#630826' }}>Share album</span>
            <button type="button" onClick={() => setOpen(false)} style={{ color: '#A89880' }} aria-label="Close">
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
            onClick={copyLink}
          >
            <span>
              <span className="block text-sm font-semibold" style={{ color: '#630826' }}>Copy link</span>
              <span className="block text-xs truncate" style={{ color: '#8B6F4E', maxWidth: 200 }}>{shareUrl}</span>
            </span>
            {copied ? <Check className="w-4 h-4" style={{ color: '#630826' }} /> : <Copy className="w-4 h-4" style={{ color: '#7C5C3E' }} />}
          </button>

          <div className="mt-3 rounded-xl p-3" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
            <div className="flex items-center gap-3">
              {qrDataUrl && <Image src={qrDataUrl} alt="QR Code" width={80} height={80} unoptimized />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold flex items-center gap-2" style={{ color: '#630826' }}>
                  <QrCode className="w-4 h-4" />
                  QR code
                </p>
                <p className="text-xs leading-relaxed" style={{ color: '#7C5C3E' }}>Scan to open this album.</p>
                <button
                  type="button"
                  className="mt-2 flex items-center gap-1.5 text-xs font-semibold rounded-lg px-2.5 py-1.5 transition hover:opacity-80"
                  style={{ background: '#630826', color: '#FDFAF5' }}
                  onClick={async () => {
                    const QRCode = (await import('qrcode')).default
                    const canvas = document.createElement('canvas')
                    await QRCode.toCanvas(canvas, shareUrl, { width: 600, margin: 2, color: { dark: '#630826', light: '#FFFFFF' } })
                    const link = document.createElement('a')
                    link.download = `${(albumTitle || 'album').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-qr.png`
                    link.href = canvas.toDataURL('image/png')
                    link.click()
                  }}
                >
                  <Download className="w-3 h-3" />
                  Download PNG
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
