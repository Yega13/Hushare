'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { Check, Copy, Download, Loader2, Play, QrCode, ScanFace, Share2, X } from 'lucide-react'
import { showAppToast } from '@/components/AppToast'
import { useT } from '@/i18n/LocaleProvider'
import { useIsNarrow } from '@/lib/useIsNarrow'
import { useZipDownload } from '@/components/photo-grid/useZipDownload'
import type { Album, Photo } from '@/types'
import SignInPrompt from '@/components/SignInPrompt'
import { createClient } from '@/lib/supabase/client'
import { qrForegroundColor } from '@/lib/album-design'

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
  color: '#630826',
  border: '1px solid #DDD5C5',
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
}

export default function GuestActionsBar({ album, photos, shareUrl, onOpenSlideshow, onOpenFaceFinder }: Props) {
  const { t } = useT()
  const { zipping, zipProgress, zipStatus, downloadZip } = useZipDownload(photos, album)

  // Face Finder button appears only when the owner enabled it and there are images to search.
  const hasFaceFinder = album.face_finder_enabled && photos.some((p) => p.media_type !== 'video')

  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const shareRef = useRef<HTMLDivElement>(null)
  const isNarrow = useIsNarrow()
  const [supabaseClient] = useState(() => createClient())
  const [downloadPromptOpen, setDownloadPromptOpen] = useState(false)

  async function handleDownloadAll() {
    downloadZip()
    // Offer sign-in so the guest can keep these photos — fires AFTER kicking off the download, so
    // it never blocks it. Skips silently for already-signed-in or already-dismissed guests.
    try {
      if (sessionStorage.getItem(`hushare.dlPrompt.${album.id}`)) return
      const { data: { session } } = await supabaseClient.auth.getSession()
      if (!session) setDownloadPromptOpen(true)
    } catch { /* ignore */ }
  }

  // Lock background scroll while the download sign-in prompt is open.
  useEffect(() => {
    if (!downloadPromptOpen) return
    document.documentElement.classList.add('hush-scroll-locked')
    document.body.classList.add('hush-scroll-locked')
    return () => {
      document.documentElement.classList.remove('hush-scroll-locked')
      document.body.classList.remove('hush-scroll-locked')
    }
  }, [downloadPromptOpen])

  // Pre-generate QR once
  useEffect(() => {
    let cancelled = false
    import('qrcode').then(({ default: QRCode }) => {
      QRCode.toDataURL(shareUrl, { width: 300, margin: 2, color: { dark: qrForegroundColor(album.accent_color), light: '#FFFFFF' } })
        .then((url) => { if (!cancelled) setQrDataUrl(url) })
    })
    return () => { cancelled = true }
  }, [shareUrl, album.accent_color])

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
      showAppToast(t('guest.linkCopied'))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      showAppToast(t('guest.copyFail'), 'error')
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
              showAppToast(t('guest.noPhotos'), 'error')
              return
            }
            onOpenSlideshow()
          }}
        >
          <Play className="w-3.5 h-3.5" />
          {t('guest.slideshow')}
        </button>

        {/* Find my photos — AI face finder (owner-enabled, Max) */}
        {hasFaceFinder && (
          <button
            className="hush-press"
            style={btnBase}
            onClick={onOpenFaceFinder}
          >
            <ScanFace className="w-3.5 h-3.5" />
            {t('guest.faceFinder')}
          </button>
        )}

        {/* Download All — only if owner allows it and there are downloadable items */}
        {album.allow_guest_downloads && (
          <button
            className="hush-press"
            style={btnBase}
            disabled={zipping || downloadableCount === 0}
            onClick={handleDownloadAll}
          >
            {zipping ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {zipStatus ? `${zipStatus} · ${zipProgress}%` : (zipProgress < 100 ? `${zipProgress}%` : t('guest.zipping'))}
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                {t('guest.downloadAll')}
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
            {t('guest.share')}
          </button>

          {shareOpen && (() => {
            const menuInner = (
              <>
              <div className="flex items-center justify-between mb-3">
                <span className="font-semibold text-sm" style={{ color: '#630826' }}>{t('guest.shareAlbum')}</span>
                <button type="button" onClick={() => setShareOpen(false)} style={{ color: '#A89880' }} aria-label={t('guest.close')}>
                  <X className="w-4 h-4" />
                </button>
              </div>

              <button
                className="hush-hover-lift w-full flex items-center justify-between gap-3 rounded-xl px-3 py-3 mb-2 text-left transition hover:opacity-90"
                style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', cursor: 'pointer' }}
                onClick={handleNativeShare}
              >
                <span>
                  <span className="block text-sm font-semibold" style={{ color: '#630826' }}>{t('guest.shareAlbum')}</span>
                  <span className="block text-xs" style={{ color: '#8B6F4E' }}>{t('guest.shareVia')}</span>
                </span>
                <Share2 className="w-4 h-4 flex-none" style={{ color: '#7C5C3E' }} />
              </button>

              <button
                className="hush-hover-lift w-full flex items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition hover:opacity-90"
                style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', cursor: 'pointer' }}
                onClick={copyLink}
              >
                <span>
                  <span className="block text-sm font-semibold" style={{ color: '#630826' }}>{t('guest.copyLink')}</span>
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
                      {t('guest.qr')}
                    </p>
                    <p className="text-xs leading-relaxed" style={{ color: '#7C5C3E' }}>{t('guest.qrScan')}</p>
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

      {downloadPromptOpen && createPortal(
        <>
          <div className="hush-share-backdrop" onClick={() => setDownloadPromptOpen(false)} />
          <div style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 210, width: 'min(92vw, 420px)' }}>
            <SignInPrompt
              title="Keep these photos"
              subtitle="Sign in so you can find them again anytime."
              next={`/${album.custom_slug ?? album.slug}`}
              storageKey={`hushare.dlPrompt.${album.id}`}
              onDismiss={() => setDownloadPromptOpen(false)}
            />
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
