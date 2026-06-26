import { useState, useEffect, type RefObject } from 'react'
import { GRID_PRELOAD_MARGIN_PX } from '@/lib/constants'

export function usePhotoGridObservers(
  gridRef: RefObject<HTMLDivElement | null>,
  photoIdsKey: string,
  onRadiusMaxChange: (max: number) => void,
): Record<string, number> {
  const [tileRadiusMaxById, setTileRadiusMaxById] = useState<Record<string, number>>({})

  useEffect(() => {
    const maybeGrid = gridRef.current
    if (!maybeGrid) return
    const grid = maybeGrid

    function measureTiles() {
      const nextCaps: Record<string, number> = {}
      let globalMax = 1
      grid.querySelectorAll<HTMLElement>('[data-photo-id]').forEach((tile) => {
        const id = tile.dataset.photoId
        if (!id) return
        const rect = tile.getBoundingClientRect()
        const cap = Math.max(1, Math.ceil(Math.min(rect.width, rect.height) / 2))
        nextCaps[id] = cap
        globalMax = Math.max(globalMax, cap)
      })
      setTileRadiusMaxById(nextCaps)
      onRadiusMaxChange(globalMax)
    }

    measureTiles()
    const resizeObserver = new ResizeObserver(measureTiles)
    resizeObserver.observe(grid)
    grid.querySelectorAll<HTMLElement>('[data-photo-id]').forEach((tile) => resizeObserver.observe(tile))
    window.addEventListener('resize', measureTiles)

    // Pre-warm thumbnails before tiles enter the viewport.
    // Stream videos are excluded — they have no direct-fetch URL; the iframe player
    // manages its own buffering. Only image tiles carry an <img> we can preload.
    const preloadObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const tile = entry.target as HTMLElement
          const imgEl = tile.querySelector<HTMLImageElement>('img')
          if (imgEl?.src) {
            const loader = new window.Image()
            ;(loader as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'high'
            loader.src = imgEl.src
          }
          preloadObserver.unobserve(entry.target)
        }
      },
      { rootMargin: `${GRID_PRELOAD_MARGIN_PX}px` },
    )
    grid.querySelectorAll<HTMLElement>('[data-photo-id]').forEach((tile) => preloadObserver.observe(tile))

    return () => {
      resizeObserver.disconnect()
      preloadObserver.disconnect()
      window.removeEventListener('resize', measureTiles)
    }
    // Depend on photo IDs, NOT the full photos array. A photo UPDATE (caption change,
    // realtime row update) produces a new array but the same ID set — without this we'd
    // tear down + rebuild both observers and re-fire preload fetches for every tile,
    // which is the main source of perceived lag on large albums.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoIdsKey, onRadiusMaxChange])

  return tileRadiusMaxById
}
