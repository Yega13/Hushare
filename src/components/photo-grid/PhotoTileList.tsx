'use client'

import React from 'react'
import type { MediaDisplayFilter, Photo } from '@/types'
import { MASONRY_GAP, type MasonryColumn } from '@/components/photo-grid/mediaLayout'
import PhotoTile, { type TileHandlers } from '@/components/photo-grid/PhotoTile'
import { previewRadius, previewFilter } from '@/components/photo-grid/usePhotoSettings'
import { cssMediaDisplayFilter } from '@/lib/media-display'
import { photoStyleTile } from '@/lib/album-design'

// THE ALBUM'S TILES, SEALED OFF FROM EVERYTHING THAT IS NOT ABOUT TILES.
//
// This exists for one reason, and it is measured. Opening a photo, swiping to the next one, zooming
// one, or letting a slideshow tick all change state that lives in PhotoGrid — the lightbox index,
// the zoom offset, the swipe offset, which originals have loaded. Every one of those re-rendered
// the ENTIRE grid. On a 4,566-photo album that is ~9,000 objects allocated and ~82,000 shallow prop
// comparisons per render, repeated for every frame of a swipe or a pan, and it is why the lightbox
// took seconds to open and close on the biggest album on the site while every smaller album felt
// fine. Nothing was wrong with the tiles; there were simply thousands of them being asked the same
// question over and over.
//
// React.memo on this boundary answers it once. The lightbox can re-render as much as it likes and
// the grid below it does not move.
//
// EVERY PROP IS A PRIMITIVE, A SET, OR A REF — deliberately. No function is taken from a hook
// closure (those are new on every render and would defeat the memo silently, which is worse than
// not having it, because it looks fixed). That is also why the two settings-preview rules arrive as
// their inputs rather than as callbacks: the rules themselves are imported from usePhotoSettings,
// so this cannot drift from what the settings modal shows (rule 13).
//
// Anything a tile depends on MUST be a prop here. That is the safety property — a value read from
// an outer scope would go stale invisibly, while a missing prop is a type error.
export type PhotoTileListProps = {
  gridRef: React.RefObject<HTMLDivElement | null>
  photos: Photo[]
  masonry: boolean
  masonryColumns: MasonryColumn[]
  gridColumnsMobile: number
  gridColumnsDesktop: number
  eagerFirstRowCount: number

  // Album-level display, and the live values of an open photo-settings modal.
  //
  // The three FIELDS, not the album object. Passing `album` re-rendered every tile whenever any
  // unrelated field changed — a title edit, a background swap, a slideshow interval — which is
  // exactly the owner-is-designing case where the album is largest and the edits come fastest.
  mediaRadius: number
  mediaFilter: MediaDisplayFilter
  photoStyle: string | null
  forceGlobalRadius: boolean
  settingsPhotoId: string | null
  settingsRadius: number
  settingsFilter: string

  // Per-tile state, reduced to collections PhotoTile turns into booleans.
  arrangeMode: boolean
  reorderDraggingId: string | null
  reorderTargetId: string | null
  flippedPhotoId: string | null
  broken: Set<string>
  posterBroken: Set<string>
  isOwner: boolean
  coverPhotoId: string | null
  selectMode: boolean
  selectedIds: Set<string>
  handlers: React.MutableRefObject<TileHandlers>
}

function PhotoTileList({
  gridRef, photos, masonry, masonryColumns, gridColumnsMobile, gridColumnsDesktop,
  eagerFirstRowCount, mediaRadius, mediaFilter, photoStyle, forceGlobalRadius,
  settingsPhotoId, settingsRadius, settingsFilter,
  arrangeMode, reorderDraggingId, reorderTargetId, flippedPhotoId, broken, posterBroken,
  isOwner, coverPhotoId, selectMode, selectedIds, handlers,
}: PhotoTileListProps) {
  // Reduce every collection down to per-tile PRIMITIVES before handing props to PhotoTile. This is
  // what lets React.memo's shallow comparison skip the other ~4,500 tiles when one photo's
  // selection, drag, flip or settings-preview changes — see the note in PhotoTile.tsx.
  // isReorderMode/isDragging only flip at drag start and end; isDropTarget changes on every pointer
  // move but is true for only one or two tiles.
  const isReorderMode = arrangeMode || reorderDraggingId != null

  // Album "photo style": a named style overrides every tile's radius and adds a white matte when
  // "framed"; the default style keeps the album's own per-tile radius.
  const album = { media_radius: mediaRadius, media_filter: mediaFilter }
  const ps = photoStyle
  const psActive = ps === 'edge' || ps === 'rounded' || ps === 'framed'
  const psFramed = ps === 'framed'
  const psRadius = photoStyleTile(ps, 0).radius

  const renderTile = (photo: Photo, index: number, boxW?: number, boxH?: number) => (
    <PhotoTile
      key={photo.id}
      photo={photo}
      index={index}
      mediaRadius={psActive
        ? psRadius
        : previewRadius(photo, album, forceGlobalRadius, settingsPhotoId, settingsRadius)}
      framed={psFramed}
      filter={cssMediaDisplayFilter(previewFilter(photo, album, settingsPhotoId, settingsFilter))}
      arrangeMode={arrangeMode}
      isReorderMode={isReorderMode}
      isDragging={reorderDraggingId === photo.id}
      isDropTarget={reorderDraggingId != null && reorderTargetId === photo.id && reorderDraggingId !== photo.id}
      isFlipped={flippedPhotoId === photo.id}
      isBroken={broken.has(photo.id)}
      isPosterBroken={posterBroken.has(photo.id)}
      isOwner={isOwner}
      isHeaderPhoto={coverPhotoId === photo.id}
      selectMode={selectMode}
      isSelected={selectedIds.has(photo.id)}
      handlers={handlers}
      boxW={boxW}
      boxH={boxH}
      eager={index < eagerFirstRowCount}
    />
  )

  // translate="no" on both grids below is a fix for a CRASH, not a preference.
  //
  // Android Chrome auto-translates a page whose language does not match the reader's, and it does
  // so by REPLACING text nodes in place. React holds direct references to the nodes it created, so
  // the next commit reaches for a node that is no longer where it believes it is and the whole tree
  // throws: "Failed to execute 'insertBefore' on 'Node'". The album is replaced by "Something went
  // wrong" — a working album killed by a browser feature.
  //
  // Reported from Android 10 on 2026-08-20 and AGAIN on 2026-08-21, after the one-shot recovery
  // reload shipped. That recurrence is what turned this from a suspicion into the fix; it was
  // deliberately not done first, because the stack proves the DOM was inconsistent, not what made
  // it so.
  //
  // Scoped to the grid rather than the document on purpose: the site's own UI stays translatable,
  // and the only text sealed off is what should never be translated anyway — the captions and names
  // guests type. Rewriting a person's name into another language is a bug in its own right.
  if (masonry) {
    return (
      <div ref={gridRef} translate="no" className="hush-masonry" style={{ gap: MASONRY_GAP }}>
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
      translate="no"
      className="hush-photo-grid grid gap-3 xl:gap-4"
      style={{
        '--hush-grid-cols': gridColumnsMobile,
        '--hush-grid-cols-desktop': gridColumnsDesktop,
      } as React.CSSProperties}
    >
      {photos.map((photo, index) => renderTile(photo, index))}
    </div>
  )
}

export default React.memo(PhotoTileList)
