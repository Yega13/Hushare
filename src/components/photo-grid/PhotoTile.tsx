import React from 'react'
import { Play, Check, Move } from 'lucide-react'
import { formatDuration } from '@/lib/media'
import type { Photo } from '@/types'

export type TileHandlers = {
  handleTileClick: (index: number) => void
  startReorderPress: (photo: Photo, e: React.PointerEvent<HTMLDivElement>) => void
  handleReorderMove: (e: React.PointerEvent<HTMLDivElement>) => void
  finishReorder: (e: React.PointerEvent<HTMLDivElement>) => void
  handleTilePointerTouchStart: (photo: Photo, e: React.TouchEvent<HTMLDivElement>) => void
  handleTileTouchMove: (e: React.TouchEvent<HTMLDivElement>) => void
  handleTileTouchEnd: () => void
  clearReorderTimer: () => void
  toggleGridCardBack: (photo: Photo, e: React.MouseEvent<HTMLElement>) => void
  setPosterBroken: React.Dispatch<React.SetStateAction<Set<string>>>
  markBroken: (photoId: string) => void
  reorderDraggingActive: boolean
}

// All state that varies per-photo (selection, reorder drag/target, broken flags, flipped caption,
// settings-preview radius/filter) is resolved to PLAIN PRIMITIVES by the caller (PhotoGrid) before
// reaching this component — never Sets/objects/ids that require an internal `.has()`/`===` check.
// That is what lets React.memo's shallow prop comparison actually skip re-rendering the ~2000
// other tiles when only one photo's selection/drag/flip state changes; passing the raw
// `selectedIds`/`broken` Set (or `reorderTargetId` string) down to every tile would hand every
// tile a "changed" prop on every interaction, defeating memoization entirely.
type Props = {
  photo: Photo
  index: number
  mediaRadius: number
  filter: string
  arrangeMode: boolean
  isReorderMode: boolean
  isDragging: boolean
  isDropTarget: boolean
  isFlipped: boolean
  isBroken: boolean
  isPosterBroken: boolean
  isOwner: boolean
  selectMode: boolean
  isSelected: boolean
  handlers: React.MutableRefObject<TileHandlers>
  // Justified layout: when set, the tile fills a box of these exact pixel dimensions (its real
  // aspect ratio) instead of being cropped to a square. Passed as primitives (not an object) so
  // React.memo can still shallow-compare and skip re-renders.
  boxW?: number
  boxH?: number
}

const PhotoTile = React.memo(function PhotoTile({
  photo,
  index,
  mediaRadius,
  filter,
  arrangeMode,
  isReorderMode,
  isDragging,
  isDropTarget,
  isFlipped,
  isBroken,
  isPosterBroken,
  isOwner,
  selectMode,
  isSelected,
  handlers,
  boxW,
  boxH,
}: Props) {
  const isVideo = photo.media_type === 'video'
  // Video thumbnail: prefer the R2 poster (uploaded on submit — immediate + reliable), and
  // fall back to the Cloudflare Stream thumbnail (which 404s until Stream finishes processing)
  // only if the poster is missing or fails. Prevents a blank video tile right after upload.
  const [videoPosterFailed, setVideoPosterFailed] = React.useState(false)
  const videoThumb = (!videoPosterFailed && photo.poster_url)
    ? photo.poster_url
    : (photo.stream_thumbnail_url || photo.poster_url || '')
  // GIFs must animate in the grid (auto-loop) without opening the lightbox, so render the
  // original animated file rather than the static thumbnail frame. A native <img> loops a GIF
  // on its own.
  const isGif = !isVideo && typeof photo.url === 'string' && /\.gif(\?|$)/i.test(photo.url)
  // For videos, drop the src entirely once every source failed so the tile shows the
  // placeholder + Play icon instead of a broken-image icon under the overlay.
  const thumbSrc = isVideo
    ? (isPosterBroken ? '' : videoThumb)
    : (isGif ? (photo.url || photo.thumb_url) : (photo.thumb_url || photo.url))
  // In the new system all videos are Cloudflare Stream (stream_uid always set).
  // There is no R2 video backup and no mirror_url — so videoThumbSrc is always null for
  // Stream videos. We keep the conditional for correctness in the unlikely case a legacy
  // row has stream_uid === null (which schema constraints prevent, but defensive is good).
  const videoThumbSrc = isVideo && !thumbSrc && !isBroken && photo.stream_uid === null
    ? photo.url
    : null
  const mediaName = photo.caption?.trim() || photo.author_name?.trim() || ''
  const isGridFlipped = Boolean(mediaName && isFlipped)

  // Box mode (masonry/justified): a fixed height, and either a fixed width or — when width is
  // omitted — the tile stretches to fill its flex column (masonry). Falls back to a square tile.
  const boxed = boxH != null
  return (
    <div className="min-w-0" style={boxed ? { width: boxW, height: boxH } : undefined}>
      <div
        className={`${isReorderMode ? 'hush-reorder-ring ' : ''}${isDragging || isDropTarget ? 'hush-reorder-ring-solid ' : ''}hush-photo-tile relative overflow-hidden cursor-pointer ${boxed ? 'w-full h-full' : 'aspect-square'}`}
        data-photo-id={photo.id}
        style={{
          background: '#EDE7DB',
          borderRadius: mediaRadius,
          opacity: isDragging ? 0.58 : 1,
          // Block touch-based scrolling ONLY while a drag is in flight.
          // Keeping 'none' for the whole arrange session blocked page scroll on mobile,
          // making it impossible to reach photos below the fold before dragging.
          // Once a drag starts (reorderDraggingId set + setPointerCapture called),
          // the captured pointer ignores touchAction anyway.
          touchAction: handlers.current.reorderDraggingActive ? 'none' : 'manipulation',
          WebkitTouchCallout: 'none',
          userSelect: 'none',
        }}
        onClick={() => handlers.current.handleTileClick(index)}
        onPointerDown={(e) => handlers.current.startReorderPress(photo, e)}
        onPointerMove={(e) => handlers.current.handleReorderMove(e)}
        onPointerUp={(e) => handlers.current.finishReorder(e)}
        onPointerCancel={(e) => handlers.current.finishReorder(e)}
        onPointerLeave={(e) => {
          if (handlers.current.reorderDraggingActive) {
            handlers.current.handleReorderMove(e)
            return
          }
          handlers.current.clearReorderTimer()
        }}
        onTouchStart={(e) => handlers.current.handleTilePointerTouchStart(photo, e)}
        onTouchMove={(e) => handlers.current.handleTileTouchMove(e)}
        onTouchEnd={() => handlers.current.handleTileTouchEnd()}
        onContextMenu={(e) => handlers.current.toggleGridCardBack(photo, e)}
        onDragStart={(e) => e.preventDefault()}
      >
        {thumbSrc && !isBroken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbSrc}
            alt={photo.caption || ''}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="hush-media-img object-cover"
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
              '--hush-media-filter': filter,
            } as React.CSSProperties}
            onError={() => {
              if (isVideo) {
                // R2 poster failed — try the Stream thumbnail before giving up on a thumbnail.
                if (!videoPosterFailed && photo.poster_url && photo.stream_thumbnail_url) {
                  setVideoPosterFailed(true)
                  return
                }
                // All sources failed — show the placeholder + Play icon (video may still play,
                // so flag the poster only, not the whole photo, and the lightbox still opens it).
                handlers.current.setPosterBroken((prev) => {
                  if (prev.has(photo.id)) return prev
                  const next = new Set(prev)
                  next.add(photo.id)
                  return next
                })
              } else {
                handlers.current.markBroken(photo.id)
              }
            }}
            onContextMenu={(e) => handlers.current.toggleGridCardBack(photo, e)}
          />
        ) : videoThumbSrc ? (
          // Legacy fallback for R2 videos (should not occur in new system).
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={videoThumbSrc}
            preload="metadata"
            muted
            playsInline
            draggable={false}
            onLoadedMetadata={(e) => { const v = e.currentTarget; v.currentTime = Math.min(0.5, (v.duration || 1) * 0.05) }}
            className="hush-media-img object-cover"
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
              '--hush-media-filter': filter,
            } as React.CSSProperties}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 px-3 text-center" style={{ background: '#E8E0D2' }}>
            {isVideo ? <Play className="w-8 h-8" style={{ color: '#7C5C3E' }} /> : null}
            {isVideo ? (
              isBroken ? (
                <span className="text-xs font-semibold" style={{ color: '#7C5C3E' }}>Video unavailable</span>
              ) : null
            ) : (
              <span className="text-xs font-semibold" style={{ color: '#7C5C3E' }}>
                {isBroken ? 'File unavailable' : 'Preview unavailable'}
              </span>
            )}
          </div>
        )}

        {isVideo && (
          <>
            <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span
                className="rounded-full flex items-center justify-center"
                style={{
                  width: 32,
                  height: 32,
                  background: 'rgba(0,0,0,0.55)',
                  backdropFilter: 'blur(4px)',
                  WebkitBackdropFilter: 'blur(4px)',
                }}
              >
                <Play className="w-4 h-4" style={{ color: '#FDFAF5', marginLeft: 1.5 }} fill="#FDFAF5" />
              </span>
            </span>
            {photo.duration_seconds ? (
              <span
                className="absolute top-2 right-2 text-[10px] font-medium px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(0,0,0,0.65)', color: '#FDFAF5' }}
              >
                {formatDuration(photo.duration_seconds)}
              </span>
            ) : null}
          </>
        )}

        {isGridFlipped && (
          <div className="hush-grid-photo-back" style={{ borderRadius: mediaRadius }}>
            <strong className="hush-photo-back-title">{mediaName}</strong>
          </div>
        )}

        {isOwner && selectMode && (
          <div
            className="absolute inset-0 pointer-events-none z-10"
            style={{ background: isSelected ? 'rgba(99,8,38,0.28)' : 'transparent' }}
          >
            <span
              className="absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center"
              style={{
                background: isSelected ? '#630826' : 'rgba(253,250,245,0.88)',
                border: `2px solid ${isSelected ? '#630826' : 'rgba(99,8,38,0.40)'}`,
              }}
            >
              {isSelected && <Check className="w-3.5 h-3.5" style={{ color: '#FDFAF5' }} />}
            </span>
          </div>
        )}

        {arrangeMode && (
          <div
            className="absolute top-1.5 left-1.5 z-20 flex items-center justify-center rounded-md w-7 h-7 md:w-9 md:h-9"
            data-drag-handle="true"
            style={{
              touchAction: 'none',
              background: 'rgba(99,8,38,0.78)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
              cursor: isDragging ? 'grabbing' : 'grab',
            }}
          >
            <Move className="w-4 h-4 md:w-5 md:h-5" style={{ color: '#FDFAF5', pointerEvents: 'none' }} />
          </div>
        )}
      </div>
    </div>
  )
})

export default PhotoTile
