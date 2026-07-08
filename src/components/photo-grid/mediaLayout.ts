'use client'

import { useEffect, useRef, useState } from 'react'
import type { Photo } from '@/types'

// ── Aspect ratios ─────────────────────────────────────────────────────────────
// Aspect ratios (width / height) for media that lacks stored upload dimensions (legacy rows).
// Media WITH stored dimensions is read synchronously by the layout, so it never enters this map
// and never triggers a re-render here. Legacy media is measured once from its thumbnail/poster
// and cached; the layout falls back to a square while a measurement is still in flight.
export function useMediaAspects(photos: Photo[], enabled: boolean): Map<string, number> {
  const [aspects, setAspects] = useState<Map<string, number>>(() => new Map())
  const measuredRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    for (const p of photos) {
      if (p.width && p.height) continue          // has stored dims — layout reads them directly
      if (measuredRef.current.has(p.id)) continue // measured (or measuring) already
      measuredRef.current.add(p.id)
      const src = p.media_type === 'video' ? (p.poster_url || p.stream_thumbnail_url) : (p.thumb_url || p.url)
      if (!src) continue
      const img = new window.Image()
      img.decoding = 'async'
      img.onload = () => {
        if (cancelled || img.naturalWidth <= 0 || img.naturalHeight <= 0) return
        setAspects((prev) => {
          const next = new Map(prev)
          next.set(p.id, img.naturalWidth / img.naturalHeight)
          return next
        })
      }
      img.src = src
    }

    return () => { cancelled = true }
  }, [photos, enabled])

  return aspects
}

function aspectOf(photo: Photo, aspects: Map<string, number>): number {
  const stored = photo.width && photo.height && photo.width > 0 && photo.height > 0
    ? photo.width / photo.height
    : null
  const a = stored ?? aspects.get(photo.id) ?? 1
  // Clamp so a single panorama / very-tall screenshot can't produce an absurd tile. Portrait is
  // allowed to be tall (Pinterest style) but not endless; landscape not wider than ~2.2:1.
  if (!Number.isFinite(a) || a <= 0) return 1
  return Math.min(2.2, Math.max(0.5, a))
}

// ── Masonry (Pinterest) columns ───────────────────────────────────────────────

export type MasonryItem = { photo: Photo; index: number; height: number }
export type MasonryColumn = { items: MasonryItem[] }

// Place each photo (in order) into the currently-shortest column, keeping its true aspect ratio.
// Equal-width columns, variable heights — the classic balanced masonry. Returns one item list per
// column; each item carries only its pixel height (width is the column width, set by flex).
export function computeMasonryColumns(
  photos: Photo[],
  aspects: Map<string, number>,
  containerWidth: number,
  columnCount: number,
  gap: number,
): MasonryColumn[] {
  if (containerWidth <= 0 || photos.length === 0 || columnCount < 1) return []

  const colWidth = (containerWidth - gap * (columnCount - 1)) / columnCount
  if (colWidth <= 0) return []

  const columns: MasonryColumn[] = Array.from({ length: columnCount }, () => ({ items: [] }))
  const heights = new Array<number>(columnCount).fill(0)

  photos.forEach((photo, index) => {
    const h = colWidth / aspectOf(photo, aspects)
    // Shortest column wins (ties → leftmost, preserving reading order).
    let col = 0
    for (let i = 1; i < columnCount; i++) {
      if (heights[i] < heights[col]) col = i
    }
    columns[col].items.push({ photo, index, height: Math.max(1, Math.round(h)) })
    heights[col] += h + gap
  })

  return columns
}
