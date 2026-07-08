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
  // Coalesce measurements that land in the same frame into a single state update, so a burst of
  // legacy poster loads triggers one masonry re-pack instead of one per image (avoids thrashing).
  const pendingRef = useRef<Map<string, number>>(new Map())
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const flush = () => {
      rafRef.current = null
      if (pendingRef.current.size === 0) return
      setAspects((prev) => {
        const next = new Map(prev)
        for (const [id, a] of pendingRef.current) next.set(id, a)
        pendingRef.current.clear()
        return next
      })
    }

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
        pendingRef.current.set(p.id, img.naturalWidth / img.naturalHeight)
        if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush)
      }
      img.src = src
    }

    return () => {
      cancelled = true
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      // Apply any measurement captured but not yet flushed, so a cancelled frame can't strand an
      // aspect in the pending map and leave that tile stuck as a square.
      if (pendingRef.current.size > 0) flush()
    }
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

  // Never create more columns than there are photos, otherwise a tiny album (e.g. 2 photos with a
  // 5-column setting) would leave empty flex columns and squeeze the tiles into a narrow strip.
  const cols = Math.min(columnCount, photos.length)
  const colWidth = (containerWidth - gap * (cols - 1)) / cols
  if (colWidth <= 0) return []

  const columns: MasonryColumn[] = Array.from({ length: cols }, () => ({ items: [] }))
  const heights = new Array<number>(cols).fill(0)

  photos.forEach((photo, index) => {
    const h = colWidth / aspectOf(photo, aspects)
    // Shortest column wins (ties → leftmost, preserving reading order).
    let col = 0
    for (let i = 1; i < cols; i++) {
      if (heights[i] < heights[col]) col = i
    }
    columns[col].items.push({ photo, index, height: Math.max(1, Math.round(h)) })
    heights[col] += h + gap
  })

  return columns
}
