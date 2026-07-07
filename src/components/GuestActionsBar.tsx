'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { Check, Copy, Download, Loader2, Play, QrCode, ScanFace, Share2, X } from 'lucide-react'
import { showAppToast } from '@/components/AppToast'
import { useIsNarrow } from '@/lib/useIsNarrow'
import { useZipDownload } from '@/components/photo-grid/useZipDownload'
import type { Album, Photo } from '@/types'

type Props = {
  album: Album
  photos: Photo[]
  shareUrl: string
  onOpenSlideshow: () => void
  onOpenFaceFinder: () => void
}

const btnBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.375rem',
  padding: '0.375rem 0.875rem',
  borderRadius: '0.625rem',
  fontSize: '0.8125rem',
  fontWeight: 600,
  background: '#FDFAF5',
  color: '#254F22',
  border: '1px solid #DDD5C5',
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
}

export default function GuestActionsBar({ album, photos, shareUrl, onOpenSlideshow, onOpenFaceFinder }: Props) {
  const { zipping, zipProgress, downloadZip } = useZipDownload(photos, album.title ?? '')

  // Face Finder button appears only when the owner enabled it and there are images to search.
  const hasFaceFinder = album.face_finder_enabled && photos.some((p) => p.media_type !== 'video')

  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const shareRef = useRef<HTMLDivElement>(null)
  const isNarrow = useIsNarrow()

  // Pre-generate QR once
  useEffect(() => {
    let cancelled = false
    import('qrcode').then(({ default: QRCode }) => {
      QRCode.toDataURL(shareUrl, { width: 300, margin: 2, color: { dark: '#254F22', light: '#FFFFFF' } })
        .then((url) => { if (!cancelled) setQrDataUrl(url) })
    })
    return () => { cancelled = true }
  }, [shareUrl])

  // Desktop dropdown closes on outside-click (it lives inside shareRef). The mobile panel is
  // portaled to <body> and closes via its backdrop, so the shareRef listener is desktop-only.
  useEffect(() => {
    if (!shareOpen || isNarrow) return
    function onOutside(e: MouseEvent) {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) setShareOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [shareOpen, isNarrow])

  async function handleNativeShare() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ url: shareUrl, title: album.title, text: `Check out "${album.title}" on Hushare` })
        setShareOpen(false)
        return
      } catch { /* fall through */ }
    }
    await copyLink()
  }

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

  // Stream-only videos cannot be downloaded; only R2-backed photos can be zipped
  const downloadableCount = useMemo(
    () => photos.filter((p) => p.storage_backend === 'r2').length,
    [photos],
  )

  return (
    <div style={{ background: '#F5F0E8', borderBottom: '1px solid #DDD5C5' }}>
      <div className="hush-container py-3 flex flex-wrap items-center justify-center sm:justify-start gap-2" style={{ paddingInline: 'clamp(14px, 4vw, 20px)' }}>

        {/* Slideshow */}
        <button
          className="hush-press"
          style={btnBase}
          onClick={() => {
            if (photos.length === 0) {
              showAppToast('No photos to show yet.', 'error')
              return
            }
            onOpenSlideshow()
          }}
        >
          <Play className="w-3.5 h-3.5" />
          Slideshow
        </button>

        {/* Find my photos — AI face finder (owner-enabled, Studio) */}
        {hasFaceFinder && (
          <button
            className="hush-press"
            style={{ ...btnBase, background: '#630826', color: '#FFFFFF', border: '1px solid #630826' }}
            onClick={onOpenFaceFinder}
          >
            <ScanFace className="w-3.5 h-3.5" />
            Face Finder
          </button>
        )}

        {/* Download All — only if owner allows it and there are downloadable items */}
        {album.allow_guest_downloads && (
          <button
            className="hush-press"
            style={btnBase}
            disabled={zipping || downloadableCount === 0}
            onClick={downloadZip}
          >
            {zipping ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {zipProgress < 100 ? `${zipProgress}%` : 'Zipping…'}
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                Download all
              </>
            )}
          </button>
        )}

        {/* Share — with popup */}
        <div ref={shareRef} className="relative">
          <button
            className="hush-press"
            style={btnBase}
            onClick={() => setShareOpen((v) => !v)}
          >
            <Share2 className="w-3.5 h-3.5" />
            Share
          </button>

          {shareOpen && (() => {
            const menuInner = (
              <>
              <div className="flex items-center justify-between mb-3">
                <span className="font-semibold text-sm" style={{ color: '#254F22' }}>Share album</span>
                <button type="button" onClick={() => setShareOpen(false)} style={{ color: '#A89880' }} aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <button
                className="hush-hover-lift w-full flex items-center justify-between gap-3 rounded-xl px-3 py-3 mb-2 text-left transition hover:opacity-90"
                style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', cursor: 'pointer' }}
                onClick={handleNativeShare}
              >
                <span>
                  <span className="block text-sm font-semibold" style={{ color: '#254F22' }}>Share album</span>
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
                  <span className="block text-sm font-semibold" style={{ color: '#254F22' }}>Copy link</span>
                  <span className="block text-xs truncate" style={{ color: '#8B6F4E', maxWidth: 200 }}>{shareUrl}</span>
                </span>
                {copied ? <Check className="w-4 h-4" style={{ color: '#254F22' }} /> : <Copy className="w-4 h-4" style={{ color: '#7C5C3E' }} />}
              </button>

              <div className="mt-3 rounded-xl p-3" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
                <div className="flex items-center gap-3">
                  {qrDataUrl && <Image src={qrDataUrl} alt="QR Code" width={80} height={80} unoptimized />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold flex items-center gap-2" style={{ color: '#254F22' }}>
                      <QrCode className="w-4 h-4" />
                      QR code
                    </p>
                    <p className="text-xs leading-relaxed" style={{ color: '#7C5C3E' }}>Scan to open this album.</p>
                  </div>
                </div>
              </div>
              </>
            )
            const menuStyle = { background: '#FFFFFF', border: '1px solid #DDD5C5', padding: 16 } as const
            return isNarrow
              ? createPortal(
                  <>
                    <div className="hush-share-backdrop" onClick={() => setShareOpen(false)} />
                    <div className="hush-share-menu rounded-2xl shadow-xl" style={menuStyle}>{menuInner}</div>
                  </>,
                  document.body,
                )
              : (
                  <div
                    className="hush-share-dropdown absolute left-0 top-full mt-2 z-50 rounded-2xl shadow-xl"
                    style={{ ...menuStyle, width: 300 }}
                  >
                    {menuInner}
                  </div>
                )
          })()}
        </div>

      </div>
    </div>
  )
}
