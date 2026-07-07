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

// ── Justified rows ────────────────────────────────────────────────────────────

export type JustifiedItem = { photo: Photo; index: number; width: number; height: number }
export type JustifiedRow = { items: JustifiedItem[]; height: number }

// Clamp extreme ratios so a single panorama/very-tall image can't make a row unusably short/tall.
function clampAspect(a: number): number {
  if (!Number.isFinite(a) || a <= 0) return 1
  return Math.min(3, Math.max(0.4, a))
}

// Pack photos into rows that each fill `containerWidth` at a shared height near `targetRowHeight`.
// Preserves order left-to-right, top-to-bottom (unlike CSS-column masonry). The last, partial row
// keeps the target height instead of being stretched across the full width.
export function computeJustifiedRows(
  photos: Photo[],
  aspects: Map<string, number>,
  containerWidth: number,
  targetRowHeight: number,
  gap: number,
): JustifiedRow[] {
  if (containerWidth <= 0 || photos.length === 0) return []

  const rows: JustifiedRow[] = []
  let current: { photo: Photo; index: number; aspect: number }[] = []
  let aspectSum = 0

  const flush = (isLast: boolean) => {
    if (current.length === 0) return
    const totalGap = gap * (current.length - 1)
    const rowContentWidth = containerWidth - totalGap
    const hRaw = rowContentWidth / aspectSum
    // A partial last row is NOT stretched to fill — it keeps the target height, natural widths,
    // and a ragged right edge (expected justified behaviour). Full rows fill exactly.
    const partial = isLast && hRaw > targetRowHeight
    const h = partial ? targetRowHeight : hRaw
    const height = Math.round(h)
    let used = 0
    const items: JustifiedItem[] = current.map((r, i) => {
      let width: number
      if (partial) {
        width = Math.max(1, Math.round(r.aspect * h))
      } else if (i === current.length - 1) {
        // Last item of a full row absorbs the rounding remainder → the row fills width exactly.
        width = Math.max(1, rowContentWidth - used)
      } else {
        width = Math.max(1, Math.round(r.aspect * h))
        used += width
      }
      return { photo: r.photo, index: r.index, width, height }
    })
    rows.push({ items, height })
    current = []
    aspectSum = 0
  }

  photos.forEach((photo, index) => {
    // Prefer stored dimensions (available synchronously, no reflow); fall back to the measured
    // map for legacy media, then to a square default while a measurement is still in flight.
    const stored = photo.width && photo.height && photo.width > 0 && photo.height > 0
      ? photo.width / photo.height
      : null
    const aspect = clampAspect(stored ?? aspects.get(photo.id) ?? 1)
    current.push({ photo, index, aspect })
    aspectSum += aspect
    const projectedWidth = aspectSum * targetRowHeight + gap * (current.length - 1)
    if (projectedWidth >= containerWidth) flush(false)
  })
  flush(true)

  return rows
}

// Row height scaled to the viewport so tiles stay tappable on phones and roomy on desktop.
export function targetRowHeightFor(containerWidth: number): number {
  if (containerWidth < 480) return 150
  if (containerWidth < 720) return 190
  if (containerWidth < 1100) return 230
  return 260
}
