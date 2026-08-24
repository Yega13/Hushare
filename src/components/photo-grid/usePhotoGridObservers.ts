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
            // 'low', not 'high'. This is speculative work for tiles the guest has not reached yet;
            // marking it high told the browser to prioritise it over the guest's own uploads on the
            // same connection. Preloading should use the spare capacity, never bid for it.
            ;(loader as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'low'
            loader.src = imgEl.src
          }
          preloadObserver.unobserve(entry.target)
        }
      },
      { rootMargin: `${GRID_PRELOAD_MARGIN_PX}px` },
    )
    grid.querySelectorAll<HTMLElement>('[data-photo-id]').forEach((tile) => preloadObserver.observe(tile))

    // Reveal tiles as they reach the viewport, so a long album unrolls instead of arriving as a
    // wall. The class is what ARMS the CSS — without it every tile is plainly visible, so a
    // failure anywhere in here degrades to "no animation" rather than "no photos".
    grid.classList.add('hush-grid-reveal')

    // A SEPARATE observer from the preloader above, on purpose. That one runs 2000px early to warm
    // thumbnails; revealing that far outside the viewport would mean every tile had already
    // finished animating before it was ever on screen. This one fires just before the edge.
    const revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const tile = entry.target as HTMLElement
          // A data attribute, not a class: React owns className on these tiles and would wipe it on
          // the next render. It patches only the attributes it renders, so this one survives.
          tile.dataset.revealed = '1'
          revealObserver.unobserve(entry.target)
        }
      },
      { rootMargin: '80px' },
    )
    grid.querySelectorAll<HTMLElement>('[data-photo-id]').forEach((tile) => {
      // Already revealed on a previous run (this effect re-runs whenever photos are added). Leaving
      // it observed would be harmless but pointless; re-hiding it would make the whole grid flash
      // every time someone uploads.
      if (tile.dataset.revealed) return
      revealObserver.observe(tile)
    })

    return () => {
      resizeObserver.disconnect()
      preloadObserver.disconnect()
      revealObserver.disconnect()
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
