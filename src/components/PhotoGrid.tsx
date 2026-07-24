'use client'

import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react'
import type { Album, Photo } from '@/types'
import type { SlideshowAnimation } from '@/types'
import { DEFAULT_SLIDESHOW_INTERVAL_MS, cssMediaDisplayFilter } from '@/lib/media-display'
import { MEDIA_AUTHOR_MAX, MEDIA_CAPTION_MAX, SUPPRESS_CLICK_AFTER_REORDER_MS, BTT_UPDATE_EVENT } from '@/lib/constants'
import { showAppToast } from '@/components/AppToast'
import { useT } from '@/i18n/LocaleProvider'
import PhotoSettingsModal from '@/components/photo-grid/PhotoSettingsModal'
import SlideshowPickerModal from '@/components/SlideshowPickerModal'
import { usePhotoGridObservers } from '@/components/photo-grid/usePhotoGridObservers'
import { useSlideshowTimer } from '@/components/photo-grid/useSlideshowTimer'
import LightboxOverlay from '@/components/photo-grid/LightboxOverlay'
import { useGestureReorder } from '@/components/photo-grid/useGestureReorder'
import { useLightboxZoom } from '@/components/photo-grid/useLightboxZoom'
import { usePhotoSettings } from '@/components/photo-grid/usePhotoSettings'
import { useSelectMode } from '@/components/photo-grid/useSelectMode'
import { downloadPhoto } from '@/components/photo-grid/downloadPhoto'
import { useLightboxMedia } from '@/components/photo-grid/useLightboxMedia'
import { useSlideshow } from '@/components/photo-grid/useSlideshow'
import { useSwipeNavigation } from '@/components/photo-grid/useSwipeNavigation'
import PhotoTile, { type TileHandlers } from '@/components/photo-grid/PhotoTile'
import { useMediaAspects, computeMasonryColumns } from '@/components/photo-grid/mediaLayout'
import { X, Play, Move } from 'lucide-react'

const MASONRY_GAP = 8

type Props = {
  album: Album
  photos: Photo[]
  isOwner: boolean
  slug: string
  forceGlobalRadius: boolean
  onRadiusMaxChange: (max: number) => void
  onPhotoDeleted: (id: string) => void
  onPhotoUpdated: (id: string, patch: Partial<Photo>) => void
  onPhotosReordered: (photos: Photo[]) => void
  slideshowRequestId?: number
  arrangeMode?: boolean
  coverPhotoId?: string | null
  onCoverSet?: (photoId: string | null) => void
}

export default function PhotoGrid({ album, photos, isOwner, slug, forceGlobalRadius, onRadiusMaxChange, onPhotoDeleted, onPhotoUpdated, onPhotosReordered, slideshowRequestId = 0, arrangeMode = false, coverPhotoId, onCoverSet }: Props) {
  const { t } = useT()
  const gridRef = useRef<HTMLDivElement>(null)
  const lightboxHistoryRef = useRef(false)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [flippedPhotoId, setFlippedPhotoId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [broken, setBroken] = useState<Set<string>>(new Set())
  // Separate from `broken`: when a video's poster image fails, flag the poster only
  // so the grid shows the placeholder while the lightbox can still open the video.
  const [posterBroken, setPosterBroken] = useState<Set<string>>(new Set())
  const [settingCover, setSettingCover] = useState(false)

  // ── Layout: masonry (Pinterest, true aspect ratios) vs the default square grid ──
  // DB value is 'justified' (kept to avoid a migration); it renders a masonry layout.
  const masonry = album.photo_layout === 'justified'

  // First-row (above-the-fold) tiles load eagerly at high priority — the rest stay lazy. Combined
  // with server-rendering the grid, this stops the LCP image from being deprioritized.
  const eagerFirstRowCount = album.mobile_grid_columns ?? 3

  // Stable key over the set of photo IDs. Lets effects depend on "did the tile set change?"
  // instead of "did the photos array reference change?" — the latter happens on every Realtime
  // UPDATE, which would otherwise force a full observer rebuild + re-firing all preloads.
  // The layout is part of the key so the observers re-attach to the new tile elements when the
  // owner switches grid ↔ masonry (the tiles live in a different container per layout).
  const photoIdsKey = useMemo(() => (masonry ? 'm:' : 'g:') + photos.map((p) => p.id).join('|'), [photos, masonry])
  const tileRadiusMaxById = usePhotoGridObservers(gridRef, photoIdsKey, onRadiusMaxChange)

  const aspects = useMediaAspects(photos, masonry)
  const [containerWidth, setContainerWidth] = useState(0)
  // `hasPhotos` is a dep because the grid element only exists once there are photos (an empty
  // album early-returns without it). Without it, an album that starts empty then receives its
  // first upload would never attach the observer, leaving containerWidth at 0 → nothing renders.
  const hasPhotos = photos.length > 0
  // useLayoutEffect (not useEffect) so the width is measured and tiles are laid out BEFORE the
  // browser paints — otherwise the first paint shows an empty container (containerWidth 0) and
  // the tiles pop in a frame later. PhotoGrid only ever renders client-side, so this is SSR-safe.
  useLayoutEffect(() => {
    const el = gridRef.current
    if (!masonry || !el) return
    const measure = () => setContainerWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [masonry, hasPhotos])
  // Masonry column count follows the same "Grid" setting as the square layout, so changing it
  // (3–6) affects both. Falls back to 3.
  const masonryColumnCount = album.mobile_grid_columns ?? 3
  const masonryColumns = useMemo(
    () => (masonry
      ? computeMasonryColumns(photos, aspects, containerWidth, masonryColumnCount, MASONRY_GAP)
      : []),
    [masonry, photos, aspects, containerWidth, masonryColumnCount],
  )

  const {
    selectMode, selectedIds, bulkDeleting,
    enterSelectMode, exitSelectMode, toggleSelection, selectAll, bulkDeleteSelected,
  } = useSelectMode({ slug, arrangeMode, onPhotoDeleted })

  // Callback ref on the bulk-select toolbar: measures the real element height so BackToTop
  // raises itself by the exact amount, not a hardcoded estimate.
  const selectBarRef = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      document.documentElement.dataset.bttBarHeight = String(el.offsetHeight)
    } else {
      delete document.documentElement.dataset.bttBarHeight
    }
    window.dispatchEvent(new Event(BTT_UPDATE_EVENT))
  }, [])

  const {
    reorderDraggingId, reorderTargetId, reorderSaving, dragGhostPointer,
    showArrangeHint, setShowArrangeHint,
    reorderSuppressedClickRef, reorderDragTileSizeRef,
    startReorderPress, handleTilePointerTouchStart, handleTileTouchMove,
    handleTileTouchEnd, handleReorderMove, finishReorder, clearReorderTimer, cancelDrag,
  } = useGestureReorder({
    photos,
    slug,
    isOwner,
    arrangeMode,
    onPhotosReordered,
    onEnterSelectMode: enterSelectMode,
  })

  const {
    slideshowActive, slideshowPaused, slideshowPickerOpen, slideshowSelectedIds, slideshowPhotoIds,
    slideshowMode, setSlideshowActive, setSlideshowPaused, setSlideshowPickerOpen, setSlideshowSelectedIds,
    toggleSlideshowPick, startSlideshow, clearSlideshow, removeFromSlideshow,
  } = useSlideshow({ photos, slideshowRequestId, lightbox, onSetLightboxIndex: setLightbox })

  const viewerPhotos = slideshowPhotoIds
    ? slideshowPhotoIds
        .map((id) => photos.find((photo) => photo.id === id))
        .filter((photo): photo is Photo => Boolean(photo))
    : photos
  const current = lightbox !== null ? viewerPhotos[lightbox] ?? null : null

  const {
    lightboxMediaNode, setLightboxMediaNode,
    lightboxRadiusMax,
    lightboxOriginalLoadedIds, setLightboxOriginalLoadedIds,
  } = useLightboxMedia({ lightbox, currentId: current?.id, viewerPhotos })

  const {
    settingsPhoto, settingsRadius, settingsFilter, settingsCaption, settingsAuthor,
    settingsSaving, settingsError,
    setSettingsPhoto, setSettingsRadius, setSettingsFilter, setSettingsCaption, setSettingsAuthor,
    openSettings, previewRadiusFor, previewFilterFor, radiusMaxFor,
    applySettingsRadius, closeSettings,
  } = usePhotoSettings({
    album,
    slug,
    forceGlobalRadius,
    currentId: current?.id,
    lightboxRadiusMax,
    tileRadiusMaxById,
    onPhotoUpdated,
  })

  const {
    zoomScale, zoomPan, lightboxFlipped, setLightboxFlipped,
    toggleZoom, mediaZoomStyle,
    handleMediaTouchStart, handleMediaTouchMove, handleMediaTouchEnd,
    handleMediaMouseDown, handleMediaMouseMove, handleMediaMouseUp,
  } = useLightboxZoom({
    currentId: current?.id,
    lightboxMediaNode,
    previewRadiusFor,
    previewFilterFor,
  })

  const zoomScaleRef = useRef(1)
  zoomScaleRef.current = zoomScale

  const overlayOpen = lightbox !== null || slideshowPickerOpen
  const slideshowIntervalMs = album.slideshow_interval_ms ?? DEFAULT_SLIDESHOW_INTERVAL_MS
  const slideshowAnimation: SlideshowAnimation = album.slideshow_animation ?? 'fade'
  const slideshowFrameClass = slideshowActive && slideshowAnimation !== 'none' ? ` hush-slideshow-frame hush-slideshow-${slideshowAnimation}` : ''

  async function setCoverPhoto(photo: Photo) {
    if (!isOwner) return
    const newCoverId = coverPhotoId === photo.id ? null : photo.id
    setSettingCover(true)
    try {
      const res = await fetch('/api/album/cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, photo_id: newCoverId }),
      })
      if (res.ok) {
        onCoverSet?.(newCoverId)
        showAppToast(newCoverId ? t('pg.coverSet') : t('pg.coverCleared'))
      } else {
        showAppToast(t('pg.coverFail'), 'error')
      }
    } catch {
      showAppToast(t('pg.coverFail'), 'error')
    } finally {
      setSettingCover(false)
    }
  }

  const closeLightbox = useCallback(() => {
    slideshowTimer.clear()
    slideshowTimer.remainingMsRef.current = null
    clearSlideshow()
    setFlippedPhotoId(null)
    setLightboxFlipped(false)
    setLightbox(null)
    if (lightboxHistoryRef.current) {
      lightboxHistoryRef.current = false
      window.history.back()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openLightbox(index: number) {
    setLightbox(index)
    if (!lightboxHistoryRef.current) {
      window.history.pushState({ hushLightbox: true }, '', window.location.href)
      lightboxHistoryRef.current = true
    }
  }

  async function deletePhoto(photo: Photo) {
    if (!isOwner) return
    // Optimistic: remove from UI immediately so the user sees instant feedback.
    onPhotoDeleted(photo.id)
    if (lightbox !== null) closeLightbox()
    setDeleting(photo.id)

    const res = await fetch('/api/album/photo/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, photo_id: photo.id }),
    })

    if (!res.ok) {
      showAppToast(`Delete failed (${res.status}) — refresh to see current state`, 'error')
    }

    setDeleting(null)
  }

  function markBroken(photoId: string) {
    setBroken((cur) => {
      if (cur.has(photoId)) return cur
      const next = new Set(cur)
      next.add(photoId)
      return next
    })
  }

  function handleTileClick(index: number) {
    if (reorderSuppressedClickRef.current) {
      reorderSuppressedClickRef.current = false
      return
    }
    if (selectMode) {
      const clicked = photos[index]
      if (clicked) toggleSelection(clicked.id)
      return
    }
    const clicked = photos[index]
    if (clicked && flippedPhotoId === clicked.id) {
      setFlippedPhotoId(null)
      return
    }
    setFlippedPhotoId(null)
    clearSlideshow()
    // No video prefetch here — Stream video URLs are iframe HTML, not media blobs.
    // The Stream player manages its own buffering.
    openLightbox(index)
  }

  function mediaNameFor(photo: Photo): string {
    return photo.caption?.trim() || photo.author_name?.trim() || ''
  }

  function toggleGridCardBack(photo: Photo, e: React.MouseEvent<HTMLElement>) {
    e.preventDefault()
    e.stopPropagation()
    if (arrangeMode) return
    if (reorderSuppressedClickRef.current) return
    cancelDrag()
    const coarsePointer = typeof window !== 'undefined' && window.matchMedia('(hover: none), (pointer: coarse)').matches
    if (coarsePointer) {
      if (!isOwner) return
      if (selectMode) {
        toggleSelection(photo.id)
      } else {
        enterSelectMode(photo.id)
        reorderSuppressedClickRef.current = true
        window.setTimeout(() => { reorderSuppressedClickRef.current = false }, SUPPRESS_CLICK_AFTER_REORDER_MS)
      }
      return
    }
    const mediaName = mediaNameFor(photo)
    if (!mediaName) {
      showAppToast(t('pg.noName'), 'error')
      return
    }
    setFlippedPhotoId((id) => (id === photo.id ? null : photo.id))
  }

  function createSlideshow() {
    const ids = photos.map((p) => p.id).filter((id) => slideshowSelectedIds.has(id))
    if (ids.length < 2) {
      showAppToast(t('pg.slideshowMin'), 'error')
      return
    }
    slideshowTimer.remainingMsRef.current = slideshowIntervalMs
    startSlideshow(ids)
    setLightbox(0)
  }

  function toggleSlideshowPause() {
    setSlideshowPaused((paused) => {
      const nextPaused = !paused
      // Only capture remaining time for images — Stream videos control their own playback
      // via the iframe player and don't need the timer to advance them.
      if (nextPaused && current?.media_type !== 'video') {
        const startedAt = slideshowTimer.startedAtRef.current
        const remaining = slideshowTimer.remainingMsRef.current ?? slideshowIntervalMs
        const elapsed = startedAt > 0 ? Date.now() - startedAt : 0
        slideshowTimer.remainingMsRef.current = Math.max(250, remaining - elapsed)
        slideshowTimer.clear()
      }
      return nextPaused
    })
  }

  const prev = useCallback(() => {
    setLightbox((cur) => (cur === null ? null : cur === 0 ? viewerPhotos.length - 1 : cur - 1))
  }, [viewerPhotos.length])

  const next = useCallback(() => {
    setLightbox((cur) => (cur === null ? null : cur === viewerPhotos.length - 1 ? 0 : cur + 1))
  }, [viewerPhotos.length])

  const slideshowTimer = useSlideshowTimer({
    active: slideshowActive,
    paused: slideshowPaused,
    lightbox,
    viewerPhotosLength: viewerPhotos.length,
    currentId: current?.id,
    currentMediaType: current?.media_type,
    currentDurationSeconds: current?.duration_seconds ?? null,
    intervalMs: slideshowIntervalMs,
    onNext: next,
  })

  const {
    swipeOffset, swipeAnimating,
    handleSwipeStart, handleSwipeMove, handleSwipeEnd, handleSwipeCancel,
  } = useSwipeNavigation({ zoomScale, currentId: current?.id, onPrev: prev, onNext: next })

  useEffect(() => {
    if (lightbox === null) return
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); if (zoomScaleRef.current <= 1) prev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (zoomScaleRef.current <= 1) next() }
      else if (e.key === 'Escape') { e.preventDefault(); closeLightbox() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, prev, next, closeLightbox])

  useEffect(() => {
    function onPopState() {
      if (!lightboxHistoryRef.current) return
      lightboxHistoryRef.current = false
      closeLightbox()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [closeLightbox])

  useEffect(() => {
    setFlippedPhotoId(null)
  }, [current?.id])

  useEffect(() => {
    if (lightbox === null || current) return
    setLightbox(null)
    clearSlideshow()
  }, [current, lightbox, clearSlideshow])

  useEffect(() => {
    if (!overlayOpen) return

    function preventPageScroll(event: Event) {
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-scroll-allowed="true"]')) return
      event.preventDefault()
    }

    document.documentElement.classList.add('hush-scroll-locked')
    document.body.classList.add('hush-scroll-locked')
    window.addEventListener('wheel', preventPageScroll, { passive: false })
    window.addEventListener('touchmove', preventPageScroll, { passive: false })

    return () => {
      window.removeEventListener('wheel', preventPageScroll)
      window.removeEventListener('touchmove', preventPageScroll)
      document.documentElement.classList.remove('hush-scroll-locked')
      document.body.classList.remove('hush-scroll-locked')
    }
  }, [overlayOpen])

  // Handler bag ref — assigned every render so PhotoTile callbacks always have the latest
  // closures without needing useCallback dependency lists across ~10 handlers.
  // NOTE: hooks must come before any early return — that's why this is positioned above the
  // empty-state branch even though it isn't used until later.
  const tileHandlersRef = useRef<TileHandlers>({
    handleTileClick, startReorderPress, handleReorderMove, finishReorder,
    handleTilePointerTouchStart, handleTileTouchMove, handleTileTouchEnd,
    clearReorderTimer, toggleGridCardBack, setPosterBroken, markBroken,
    reorderDraggingActive: reorderDraggingId != null,
  })
  tileHandlersRef.current = {
    handleTileClick, startReorderPress, handleReorderMove, finishReorder,
    handleTilePointerTouchStart, handleTileTouchMove, handleTileTouchEnd,
    clearReorderTimer, toggleGridCardBack, setPosterBroken, markBroken,
    reorderDraggingActive: reorderDraggingId != null,
  }

  // Suppress unused variable warnings from hooks still used but not referenced outside the hook.
  void [settingsSaving, settingsError, setSettingsPhoto, setSettingsRadius, setSettingsFilter, setSettingsCaption, setSettingsAuthor, setSlideshowActive, reorderSaving]

  if (photos.length === 0) {
    return (
      <div className="text-center py-20" style={{ color: '#A89880' }}>
        <p className="text-lg">{t('pg.empty')}</p>
        <p className="text-sm mt-1">{t('pg.emptySub')}</p>
      </div>
    )
  }

  return (
    <>
      {showArrangeHint && (
        <div
          className="flex items-center gap-3 rounded-2xl px-4 py-3 mb-4"
          style={{ background: '#630826' }}
        >
          <span
            className="shrink-0 flex items-center justify-center rounded-lg"
            style={{ width: 28, height: 28, background: 'rgba(255,255,255,0.18)' }}
          >
            <Move className="w-3.5 h-3.5" style={{ color: '#FDFAF5', pointerEvents: 'none' }} />
          </span>
          <p className="flex-1 text-sm leading-snug" style={{ color: '#FDFAF5' }}>
            {t('pg.arrangeTip')}
          </p>
          <button
            type="button"
            aria-label={t('pg.dismissTip')}
            className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
            onClick={() => setShowArrangeHint(false)}
          >
            <X className="w-4 h-4" style={{ color: '#FDFAF5' }} />
          </button>
        </div>
      )}
      {(() => {
        // Reduce every collection (Sets, the currently-dragged/flipped/edited photo id) down to
        // per-tile PRIMITIVES before handing props to PhotoTile. This is what lets React.memo's
        // shallow prop comparison actually skip re-rendering the other ~2000 tiles when only one
        // photo's selection/drag/flip/settings-preview state changes — see the note in
        // PhotoTile.tsx. isReorderMode/isDragging only flip at drag start/end (rare); isDropTarget
        // is the one that changes on every pointer move, and now only affects the 1-2 tiles it's
        // actually true for instead of forcing every tile to re-render.
        const isReorderMode = arrangeMode || reorderDraggingId != null
        const renderTile = (photo: Photo, index: number, boxW?: number, boxH?: number) => (
          <PhotoTile
            key={photo.id}
            photo={photo}
            index={index}
            mediaRadius={previewRadiusFor(photo)}
            filter={cssMediaDisplayFilter(previewFilterFor(photo))}
            arrangeMode={arrangeMode}
            isReorderMode={isReorderMode}
            isDragging={reorderDraggingId === photo.id}
            isDropTarget={reorderDraggingId != null && reorderTargetId === photo.id && reorderDraggingId !== photo.id}
            isFlipped={flippedPhotoId === photo.id}
            isBroken={broken.has(photo.id)}
            isPosterBroken={posterBroken.has(photo.id)}
            isOwner={isOwner}
            selectMode={selectMode}
            isSelected={selectedIds.has(photo.id)}
            handlers={tileHandlersRef}
            boxW={boxW}
            boxH={boxH}
            eager={index < eagerFirstRowCount}
          />
        )

        if (masonry) {
          return (
            <div ref={gridRef} className="hush-masonry" style={{ gap: MASONRY_GAP }}>
              {masonryColumns.map((col, ci) => (
                <div key={ci} className="hush-masonry-col" style={{ gap: MASONRY_GAP }}>
                  {col.items.map((item) => renderTile(item.photo, item.index, undefined, item.height))}
                </div>
              ))}
            </div>
          )
        }

        return (
          <div
            ref={gridRef}
            className="hush-photo-grid grid gap-3 xl:gap-4"
            style={{ '--hush-grid-cols': album.mobile_grid_columns ?? 3 } as React.CSSProperties}
          >
            {photos.map((photo, index) => renderTile(photo, index))}
          </div>
        )
      })()}

      {current && (
        <LightboxOverlay
          current={current}
          lightboxIndex={lightbox ?? 0}
          viewerPhotos={viewerPhotos}
          slideshowMode={slideshowMode}
          slideshowActive={slideshowActive}
          slideshowPaused={slideshowPaused}
          slideshowIntervalMs={slideshowIntervalMs}
          slideshowFrameClass={slideshowFrameClass}
          swipeOffset={swipeOffset}
          swipeAnimating={swipeAnimating}
          lightboxFlipped={lightboxFlipped}
          lightboxOriginalLoadedIds={lightboxOriginalLoadedIds}
          broken={broken}
          isOwner={isOwner}
          settingCover={settingCover}
          coverPhotoId={coverPhotoId ?? null}
          deleting={deleting}
          videoAutoplay={!!album.video_autoplay}
          zoomPan={zoomPan}
          previewRadiusFor={previewRadiusFor}
          mediaZoomStyle={mediaZoomStyle}
          onSwipeStart={handleSwipeStart}
          onSwipeMove={handleSwipeMove}
          onSwipeEnd={handleSwipeEnd}
          onSwipeCancel={handleSwipeCancel}
          onMediaMouseDown={handleMediaMouseDown}
          onMediaMouseMove={handleMediaMouseMove}
          onMediaMouseUp={handleMediaMouseUp}
          onMediaTouchStart={handleMediaTouchStart}
          onMediaTouchMove={handleMediaTouchMove}
          onMediaTouchEnd={handleMediaTouchEnd}
          onToggleZoom={toggleZoom}
          onMediaNodeChange={setLightboxMediaNode}
          onMarkBroken={markBroken}
          onClose={closeLightbox}
          onPrev={prev}
          onNext={next}
          onSetLightboxFlipped={setLightboxFlipped}
          onSetOriginalLoaded={setLightboxOriginalLoadedIds}
          onThumbnailClick={(index) => { setLightbox(index); setSlideshowPaused(true) }}
          onDownload={downloadPhoto}
          onSetCover={(photo) => void setCoverPhoto(photo)}
          onOpenSettings={openSettings}
          onRemoveFromSlideshow={removeFromSlideshow}
          onDelete={deletePhoto}
          onToggleSlideshowPause={toggleSlideshowPause}
        />
      )}

      {slideshowPickerOpen && (
        <SlideshowPickerModal
          photos={photos}
          selectedIds={slideshowSelectedIds}
          onClose={() => setSlideshowPickerOpen(false)}
          onSelectAll={() => setSlideshowSelectedIds(new Set(photos.map((p) => p.id)))}
          onClearAll={() => setSlideshowSelectedIds(new Set())}
          onToggle={toggleSlideshowPick}
          onCreate={createSlideshow}
        />
      )}

      {reorderDraggingId && dragGhostPointer && (() => {
        const ghost = photos.find((p) => p.id === reorderDraggingId)
        if (!ghost) return null
        const size = reorderDragTileSizeRef.current
        const thumbSrc = ghost.media_type === 'video' ? ghost.stream_thumbnail_url || ghost.poster_url || '' : (ghost.thumb_url || ghost.url)
        return (
          <div
            style={{
              position: 'fixed',
              left: dragGhostPointer.x - size / 2,
              top: dragGhostPointer.y - size / 2,
              width: size,
              height: size,
              zIndex: 300,
              pointerEvents: 'none',
              borderRadius: previewRadiusFor(ghost),
              overflow: 'hidden',
              transform: 'scale(1.1)',
              transformOrigin: 'center',
              boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
              border: '2px solid rgba(253,250,245,0.65)',
              opacity: 0.93,
            }}
          >
            {thumbSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
            ) : (
              <div style={{ width: '100%', height: '100%', background: '#E8E0D2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Play className="w-6 h-6" style={{ color: '#7C5C3E' }} />
              </div>
            )}
          </div>
        )
      })()}

      {isOwner && selectMode && (
        <div
          ref={selectBarRef}
          className="fixed bottom-0 left-0 right-0 z-[200] flex items-center justify-between gap-3 px-4 py-4 sm:px-6"
          style={{
            background: 'rgba(253,250,245,0.96)',
            borderTop: '1px solid #DDD5C5',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-sm font-semibold rounded-xl px-3 py-1.5 transition hover:opacity-80"
              style={{ background: '#F6E9EE', color: '#630826' }}
              onClick={() => selectAll(photos)}
            >
              All
            </button>
            <span className="text-sm font-medium" style={{ color: '#630826' }}>
              {selectedIds.size} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-xl px-4 py-2 text-sm font-semibold transition hover:opacity-80"
              style={{ background: '#F5F0E8', color: '#7C5C3E' }}
              onClick={exitSelectMode}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={selectedIds.size === 0 || bulkDeleting}
              className="rounded-xl px-4 py-2 text-sm font-semibold transition hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: selectedIds.size > 0 ? '#C0392B' : '#DDD5C5', color: '#FDFAF5' }}
              onClick={() => void bulkDeleteSelected()}
            >
              {bulkDeleting ? 'Deleting…' : `Delete ${selectedIds.size}`}
            </button>
          </div>
        </div>
      )}

      {settingsPhoto && isOwner && (
        <PhotoSettingsModal
          album={album}
          photo={settingsPhoto}
          radius={settingsRadius}
          filter={settingsFilter}
          caption={settingsCaption}
          author={settingsAuthor}
          radiusMax={radiusMaxFor(settingsPhoto)}
          captionMax={MEDIA_CAPTION_MAX}
          authorMax={MEDIA_AUTHOR_MAX}
          onClose={closeSettings}
          onRadiusChange={applySettingsRadius}
          onRadiusReset={() => setSettingsRadius(album.media_radius ?? 12)}
          onFilterChange={setSettingsFilter}
          onCaptionChange={setSettingsCaption}
          onAuthorChange={setSettingsAuthor}
        />
      )}
    </>
  )
}
