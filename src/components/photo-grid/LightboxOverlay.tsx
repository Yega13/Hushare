'use client'

import React from 'react'
import { X, ChevronLeft, ChevronRight, Play, Pause, Download, Settings, Star, Trash2 } from 'lucide-react'
import type { Photo } from '@/types'
import { unmuteStreamVideo } from '@/lib/cloudflare/stream-player'

function streamFrameSrc(photo: Photo, autoplay: boolean): string {
  const base = photo.stream_iframe_url || (photo.stream_uid ? `https://iframe.videodelivery.net/${photo.stream_uid}` : '')
  if (!base) return ''
  const url = new URL(base)
  if (autoplay) {
    url.searchParams.set('autoplay', 'true')
    url.searchParams.set('muted', 'true')
  }
  return url.toString()
}

type Props = {
  // Core data
  current: Photo
  lightboxIndex: number
  viewerPhotos: Photo[]

  // Display state
  slideshowMode: boolean
  slideshowActive: boolean
  slideshowPaused: boolean
  slideshowIntervalMs: number
  slideshowFrameClass: string

  // Interaction state
  swipeOffset: number
  swipeAnimating: boolean
  lightboxFlipped: boolean
  lightboxOriginalLoadedIds: Set<string>
  broken: Set<string>

  // Owner state
  isOwner: boolean
  settingCover: boolean
  coverPhotoId: string | null
  deleting: string | null
  videoAutoplay: boolean

  // Zoom state
  zoomPan: { x: number; y: number }

  // Computed style / display functions
  previewRadiusFor: (photo: Photo) => number
  mediaZoomStyle: (photo: Photo) => React.CSSProperties

  // Swipe callbacks
  onSwipeStart: (e: React.TouchEvent<HTMLDivElement>) => void
  onSwipeMove: (e: React.TouchEvent<HTMLDivElement>) => void
  onSwipeEnd: (e: React.TouchEvent<HTMLDivElement>) => void
  onSwipeCancel: () => void

  // Media interaction callbacks
  onMediaMouseDown: (e: React.MouseEvent<HTMLElement>) => void
  onMediaMouseMove: (e: React.MouseEvent<HTMLElement>) => void
  onMediaMouseUp: (e: React.MouseEvent<HTMLElement>) => void
  onMediaTouchStart: (e: React.TouchEvent<HTMLElement>) => void
  onMediaTouchMove: (e: React.TouchEvent<HTMLElement>) => void
  onMediaTouchEnd: (e: React.TouchEvent<HTMLElement>) => void
  onToggleZoom: (e: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>) => void
  onMediaNodeChange: (node: HTMLElement | null) => void
  onMarkBroken: (id: string) => void

  // Lightbox state callbacks
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  onSetLightboxFlipped: (v: boolean) => void
  onSetOriginalLoaded: (update: (prev: Set<string>) => Set<string>) => void
  onThumbnailClick: (index: number) => void

  // Owner action callbacks
  onDownload: (photo: Photo) => void
  onSetCover: (photo: Photo) => void
  onOpenSettings: (photo: Photo) => void
  onRemoveFromSlideshow: (id: string) => void
  onDelete: (photo: Photo) => void
  onToggleSlideshowPause: () => void
}

export default function LightboxOverlay({
  current,
  lightboxIndex,
  viewerPhotos,
  slideshowMode,
  slideshowActive,
  slideshowPaused,
  slideshowIntervalMs,
  slideshowFrameClass,
  swipeOffset,
  swipeAnimating,
  lightboxFlipped,
  lightboxOriginalLoadedIds,
  broken,
  isOwner,
  settingCover,
  coverPhotoId,
  deleting,
  videoAutoplay,
  zoomPan,
  previewRadiusFor,
  mediaZoomStyle,
  onSwipeStart,
  onSwipeMove,
  onSwipeEnd,
  onSwipeCancel,
  onMediaMouseDown,
  onMediaMouseMove,
  onMediaMouseUp,
  onMediaTouchStart,
  onMediaTouchMove,
  onMediaTouchEnd,
  onToggleZoom,
  onMediaNodeChange,
  onMarkBroken,
  onClose,
  onPrev,
  onNext,
  onSetLightboxFlipped,
  onSetOriginalLoaded,
  onThumbnailClick,
  onDownload,
  onSetCover,
  onOpenSettings,
  onRemoveFromSlideshow,
  onDelete,
  onToggleSlideshowPause,
}: Props) {
  // Video aspect ratio drives the player box so it fills with no black bars. Prefer the exact
  // dimensions captured at upload (instant, reliable); fall back to measuring the poster for
  // legacy rows that predate the width/height columns.
  const hasStoredDims = current.width != null && current.height != null && current.width > 0 && current.height > 0
  const [videoAspect, setVideoAspect] = React.useState<number | null>(null)
  // Whether the current video's player has been mounted. Starts as the album's autoplay setting
  // (always on in slideshow); otherwise the poster + a small custom play button shows until tapped.
  // Resetting per video means each new video starts on its poster (unless autoplay), which also
  // keeps it swipeable (it's our <img>, not the touch-swallowing iframe).
  const [videoStarted, setVideoStarted] = React.useState(false)
  React.useEffect(() => {
    setVideoStarted(slideshowMode ? !slideshowPaused : videoAutoplay)
  }, [current.id, videoAutoplay, slideshowMode, slideshowPaused])
  React.useEffect(() => {
    setVideoAspect(null)
    if (current.media_type !== 'video' || hasStoredDims) return
    const posterSrc = current.poster_url || current.stream_thumbnail_url
    if (!posterSrc) return
    const img = new window.Image()
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) setVideoAspect(img.naturalWidth / img.naturalHeight)
    }
    img.src = posterSrc
    return () => { img.onload = null }
  }, [current.id, current.media_type, current.poster_url, current.stream_thumbnail_url, hasStoredDims])

  // Flag the body while the lightbox/slideshow is open so globally-fixed chrome (the Back-to-top
  // button) hides behind it instead of floating on top and staying clickable.
  React.useEffect(() => {
    document.body.classList.add('hush-overlay-open')
    return () => { document.body.classList.remove('hush-overlay-open') }
  }, [])

  // Preload the neighbouring lightbox items (image full-res / video poster) so moving to the
  // next or previous one is instant instead of showing a blank frame while it downloads.
  React.useEffect(() => {
    if (lightboxIndex < 0) return
    for (const i of [lightboxIndex - 1, lightboxIndex + 1]) {
      const p = viewerPhotos[i]
      if (!p) continue
      const src = p.media_type === 'video' ? (p.poster_url || p.stream_thumbnail_url) : (p.url || p.thumb_url)
      if (src) {
        const img = new window.Image()
        img.decoding = 'async'
        img.src = src
      }
    }
  }, [lightboxIndex, viewerPhotos])

  const videoBoxAspect = hasStoredDims ? current.width! / current.height! : (videoAspect ?? 16 / 9)

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden${slideshowMode ? ' hush-slideshow-overlay' : ''}`}
      onClick={onClose}
      onWheel={(e) => { if (!(e.target as HTMLElement).closest('[data-scroll-allowed="true"]')) e.preventDefault() }}
    >
      <div aria-hidden className="absolute inset-0" style={{ background: 'rgba(5, 8, 5, 0.92)' }} />

      <button
        type="button"
        aria-label="Close"
        className="absolute top-4 right-4 z-20 flex items-center justify-center rounded-full transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        style={{
          width: 42,
          height: 42,
          background: 'rgba(15,20,15,0.68)',
          border: '1px solid rgba(253,250,245,0.35)',
          color: '#FDFAF5',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
        onClick={(e) => { e.stopPropagation(); onClose() }}
      >
        <X className="w-5 h-5" />
      </button>

      {!slideshowMode && (
        <>
          <button
            className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center rounded-full transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{
              width: 48, height: 48,
              background: 'rgba(15,20,15,0.72)',
              border: '1px solid rgba(253,250,245,0.40)',
              color: '#FDFAF5',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
            onClick={(e) => { e.stopPropagation(); onPrev() }}
            aria-label="Previous photo"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center rounded-full transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{
              width: 48, height: 48,
              background: 'rgba(15,20,15,0.72)',
              border: '1px solid rgba(253,250,245,0.40)',
              color: '#FDFAF5',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
            onClick={(e) => { e.stopPropagation(); onNext() }}
            aria-label="Next photo"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </>
      )}

      <div
        className={`hush-modal-pop relative z-10 max-w-[min(96vw,1100px)] mx-4 sm:mx-16 flex flex-col items-center gap-4 [&::-webkit-scrollbar]:hidden${slideshowMode ? ' hush-slideshow-stage' : ''}`}
        data-scroll-allowed="true"
        style={{
          maxHeight: 'min(95svh, 90vh)',
          overflowY: 'auto',
          overflowX: 'hidden',
          scrollbarWidth: 'none',
          touchAction: 'pan-y',
          // Clean horizontal slide that tracks the finger 1:1 (no scale — the scale-wobble read
          // as dated). A light fade near the end keeps it feeling smooth as the item leaves.
          transform: `translateX(${swipeOffset}px)`,
          opacity: 1 - Math.min(Math.abs(swipeOffset), 520) / 1600,
          transition: swipeAnimating ? 'transform 170ms cubic-bezier(0.4, 0, 0.2, 1), opacity 170ms ease-out' : 'none',
        }}
        onClick={(e) => { e.stopPropagation(); onClose() }}
        onTouchStart={onSwipeStart}
        onTouchMove={onSwipeMove}
        onTouchEnd={onSwipeEnd}
        onTouchCancel={onSwipeCancel}
      >
        {slideshowMode && (
          <div className="hush-slideshow-head" onClick={(e) => e.stopPropagation()}>
            <span>Slideshow</span>
            <strong>{lightboxIndex + 1} / {viewerPhotos.length}</strong>
          </div>
        )}

        {(!current.url && !current.stream_uid) || broken.has(current.id) ? (
          <div
            className="flex min-h-[240px] w-[min(92vw,720px)] flex-col items-center justify-center px-6 text-center"
            style={{ background: 'rgba(253,250,245,0.94)', borderRadius: previewRadiusFor(current) }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-semibold" style={{ color: '#630826' }}>This file is unavailable</p>
            <p className="mt-2 text-sm" style={{ color: '#7C5C3E' }}>The album row still exists, but the storage object could not be loaded.</p>
          </div>
        ) : current.media_type === 'video' && current.stream_uid ? (
          // All videos in the new system are Cloudflare Stream. There is no R2 video fallback.
          <div
            className={`hush-photo-flip relative${slideshowMode ? '' : ' hush-lightbox-media'}${slideshowFrameClass}`}
            key={current.id}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              // Size the box to the video's exact aspect ratio, fitting within 92vw AND 82vh with
              // no conflicting caps — so the Stream player fills it with zero black bars.
              aspectRatio: String(videoBoxAspect),
              width: `min(92vw, calc(82vh * ${videoBoxAspect}))`,
            }}
          >
            {videoStarted ? (
              /* Once started, mount the native Stream player with autoplay — it opens already
                 playing, so Stream's oversized centre play button never appears, and all native
                 controls (pause/seek/sound/settings/fullscreen) work. Volume preset to 50%. */
              <iframe
                src={streamFrameSrc(current, true)}
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                allowFullScreen
                className="block w-full h-full max-w-full"
                style={{ background: '#000', border: 0, borderRadius: previewRadiusFor(current) }}
                onClick={(e) => e.stopPropagation()}
                onLoad={(e) => {
                  onMediaNodeChange(e.currentTarget)
                  void unmuteStreamVideo(e.currentTarget, 0.5)
                }}
              />
            ) : (
              /* Not started yet: show the poster with OUR OWN small play button. Tapping starts the
                 video (loads the iframe above); swiping navigates — and because this is our <img>,
                 not the iframe, the swipe actually works here. */
              <div
                className="absolute inset-0"
                style={{ touchAction: 'pan-y', cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); setVideoStarted(true) }}
                onTouchStart={onSwipeStart}
                onTouchMove={onSwipeMove}
                onTouchEnd={onSwipeEnd}
                onTouchCancel={onSwipeCancel}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={current.poster_url || current.stream_thumbnail_url || ''}
                  alt={current.caption || ''}
                  draggable={false}
                  className="block w-full h-full"
                  style={{ objectFit: 'cover', borderRadius: previewRadiusFor(current), background: '#000' }}
                />
                <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span
                    className="rounded-full flex items-center justify-center"
                    style={{ width: 56, height: 56, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
                  >
                    <Play className="w-6 h-6" style={{ color: '#FDFAF5', marginLeft: 2 }} fill="#FDFAF5" />
                  </span>
                </span>
              </div>
            )}
          </div>
        ) : (
          // Image branch (Branch 4 in old code, now Branch 3 — no native <video> branch exists)
          <div className={`hush-photo-flip relative w-[min(92vw,1100px)]${slideshowMode ? '' : ' hush-lightbox-media'}${slideshowFrameClass}`} key={current.id} onContextMenu={(e) => e.preventDefault()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={
                current.thumb_url && !lightboxOriginalLoadedIds.has(current.id)
                  ? current.thumb_url
                  : (current.url ?? undefined)
              }
              alt={current.caption || ''}
              className="block w-full max-h-[min(70vh,760px)] max-w-full object-contain"
              ref={(node) => onMediaNodeChange(node)}
              style={{ ...mediaZoomStyle(current), transition: 'opacity 0.2s ease', opacity: (current.thumb_url && !lightboxOriginalLoadedIds.has(current.id)) ? 0.7 : 1 }}
              onLoad={(e) => {
                if (e.currentTarget.src.endsWith(current.url ?? '') || !current.thumb_url) {
                  onSetOriginalLoaded((prev) => {
                    if (prev.has(current.id)) return prev
                    const next = new Set(prev)
                    next.add(current.id)
                    return next
                  })
                }
              }}
              onError={() => {
                if (current.thumb_url && !lightboxOriginalLoadedIds.has(current.id)) {
                  onSetOriginalLoaded((prev) => {
                    if (prev.has(current.id)) return prev
                    const next = new Set(prev)
                    next.add(current.id)
                    return next
                  })
                  return
                }
                onMarkBroken(current.id)
              }}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => { e.stopPropagation(); onToggleZoom(e) }}
              onMouseDown={onMediaMouseDown}
              onMouseMove={onMediaMouseMove}
              onMouseUp={onMediaMouseUp}
              onMouseLeave={onMediaMouseUp}
              onTouchStart={onMediaTouchStart}
              onTouchMove={onMediaTouchMove}
              onTouchEnd={onMediaTouchEnd}
              onContextMenu={(e) => e.preventDefault()}
              onDragStart={(e) => e.preventDefault()}
            />
            {lightboxFlipped && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center"
                style={{ background: 'rgba(253,250,245,0.97)', borderRadius: previewRadiusFor(current), backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
                onClick={(e) => { e.stopPropagation(); onSetLightboxFlipped(false) }}
              >
                {current.caption && <p className="text-xl font-semibold text-center px-6 leading-snug" style={{ color: '#630826' }}>{current.caption}</p>}
                {current.author_name && <p className={`text-sm${current.caption ? ' mt-2' : ''}`} style={{ color: '#7C5C3E' }}>by {current.author_name}</p>}
                {!current.caption && !current.author_name && <p className="text-sm" style={{ color: '#A89880' }}>No info set</p>}
                <p className="mt-4 text-xs" style={{ color: '#C5B9A8' }}>Tap to close</p>
              </div>
            )}
          </div>
        )}

        {slideshowMode && (
          <div className="hush-slideshow-progress" aria-hidden>
            <span
              key={`${current.id}-${slideshowIntervalMs}`}
              className={slideshowPaused || current.media_type === 'video' ? 'is-paused' : ''}
              style={{ animationDuration: `${slideshowIntervalMs}ms` }}
            />
          </div>
        )}

        <div className={`flex items-center gap-4${slideshowMode ? ' hush-slideshow-controls' : ''}`} onClick={(e) => e.stopPropagation()}>
          {slideshowMode && viewerPhotos.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSlideshowPause() }}
              className="p-2 rounded-lg transition hover:opacity-80"
              style={{ background: slideshowPaused ? 'rgba(253,250,245,0.92)' : 'rgba(138,181,133,0.28)', color: slideshowPaused ? '#630826' : '#FDFAF5', border: '1px solid rgba(253,250,245,0.28)' }}
              title={slideshowPaused ? 'Resume slideshow' : 'Pause slideshow'}
              aria-label={slideshowPaused ? 'Resume slideshow' : 'Pause slideshow'}
            >
              {slideshowPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
            </button>
          )}
          {!slideshowMode && (current.caption || current.author_name) && (
            <div className="text-center">
              {current.caption && <p className="font-medium" style={{ color: '#FDFAF5' }}>{current.caption}</p>}
              {current.author_name && <p className="text-sm" style={{ color: '#C5D9C2' }}>by {current.author_name}</p>}
            </div>
          )}

          {/* Download is only available for images — Stream videos have no downloadable R2 file */}
          {!slideshowMode && current.media_type !== 'video' && (
            <button
              onClick={(e) => { e.stopPropagation(); onDownload(current) }}
              disabled={broken.has(current.id)}
              className="p-2 rounded-lg transition hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'rgba(255,255,255,0.15)', color: '#FDFAF5' }}
              title="Download"
            >
              <Download className="w-5 h-5" />
            </button>
          )}
          {isOwner && !slideshowMode && (
            <button
              onClick={(e) => { e.stopPropagation(); onSetCover(current) }}
              disabled={settingCover}
              title={coverPhotoId === current.id ? 'Clear album cover' : 'Set as album cover'}
              className="p-2 rounded-lg transition hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'rgba(255,255,255,0.15)', color: coverPhotoId === current.id ? '#F4C430' : '#FDFAF5' }}
            >
              <Star className="w-5 h-5" fill={coverPhotoId === current.id ? '#F4C430' : 'none'} />
            </button>
          )}
          {isOwner && (
            <>
              {!slideshowMode && (
                <button
                  onClick={(e) => { e.stopPropagation(); onOpenSettings(current) }}
                  className="p-2 rounded-lg transition hover:opacity-80"
                  style={{ background: 'rgba(255,255,255,0.15)', color: '#FDFAF5' }}
                  title="Settings"
                >
                  <Settings className="w-5 h-5" />
                </button>
              )}
              {slideshowMode ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveFromSlideshow(current.id) }}
                  className="p-2 rounded-lg transition hover:opacity-80"
                  style={{ background: 'rgba(255,255,255,0.15)', color: '#FDFAF5' }}
                  title="Remove from slideshow"
                  aria-label="Remove from slideshow"
                >
                  <X className="w-5 h-5" />
                </button>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(current) }}
                  disabled={deleting === current.id}
                  className="p-2 rounded-lg transition hover:opacity-80 disabled:opacity-50"
                  style={{ background: 'rgba(192,57,43,0.3)', color: '#FDFAF5' }}
                  title="Delete photo"
                  aria-label="Delete photo"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              )}
            </>
          )}
        </div>

        {!slideshowMode && <p className="text-sm" style={{ color: '#8AB585' }}>{lightboxIndex + 1} / {viewerPhotos.length}</p>}

        {slideshowMode && viewerPhotos.length > 1 && (
          <div className="hush-slideshow-strip" data-scroll-allowed="true" onClick={(e) => e.stopPropagation()}>
            {viewerPhotos.map((photo, index) => {
              const isActive = index === lightboxIndex
              const thumbSrc = photo.media_type === 'video' ? photo.stream_thumbnail_url || photo.poster_url || '' : (photo.thumb_url || photo.url)
              return (
                <button
                  key={photo.id}
                  type="button"
                  className={`hush-slideshow-thumb${isActive ? ' is-active' : ''}`}
                  onClick={() => onThumbnailClick(index)}
                  aria-label={`Open slide ${index + 1}`}
                >
                  {thumbSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbSrc} alt="" draggable={false} />
                  ) : (
                    <Play className="h-5 w-5" />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
