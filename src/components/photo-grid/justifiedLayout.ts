'use client'

import { useEffect, useRef, useState } from 'react'
import type { Photo } from '@/types'

// ── Aspect ratios ─────────────────────────────────────────────────────────────
// Resolve each photo's aspect ratio (width / height). Stored upload dimensions are used
// instantly; legacy media without them is measured once from its thumbnail/poster and cached.
// Missing entries fall back to 1 at layout time.
export function useMediaAspects(photos: Photo[], enabled: boolean): Map<string, number> {
  const [aspects, setAspects] = useState<Map<string, number>>(() => new Map())
  const measuredRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    // Apply stored dimensions immediately.
    setAspects((prev) => {
      const next = new Map(prev)
      for (const p of photos) {
        if (p.width && p.height && p.width > 0 && p.height > 0) next.set(p.id, p.width / p.height)
      }
      return next
    })

    // Measure anything without stored dimensions, once per id.
    for (const p of photos) {
      if (p.width && p.height) continue
      if (measuredRef.current.has(p.id)) continue
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
    let h = (containerWidth - totalGap) / aspectSum
    if (isLast && h > targetRowHeight) h = targetRowHeight
    const height = Math.round(h)
    const items: JustifiedItem[] = current.map((r) => ({
      photo: r.photo,
      index: r.index,
      width: Math.max(1, Math.round(r.aspect * h)),
      height,
    }))
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
