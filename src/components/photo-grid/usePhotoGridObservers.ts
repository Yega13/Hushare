import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { GRID_PRELOAD_MARGIN_PX } from '@/lib/constants'

// MEASURE ONE TILE ON DEMAND, NOT EVERY TILE ON EVERY CHANGE.
//
// This hook used to sweep the whole grid — querySelectorAll, getBoundingClientRect on each tile,
// a ResizeObserver pointed at every tile, and a fresh Record<photoId, cap> in state. That record
// fed exactly one consumer: the corner-radius slider inside the settings modal, which is open for
// ONE photo at a time. So a 5,000-photo album built a 5,000-entry map to answer a question about
// one tile.
//
// Worse, it was keyed on photoIdsKey, and during an upload burst the album refetches every 2.5s.
// Each refetch added ids, so the whole thing was torn down and rebuilt — 5,000 rect reads and
// 10,000 observer registrations — every 2.5 seconds, on a phone, while that phone was uploading.
// That is the lag you feel on a big album, and it gets worse exactly as the album gets busier.
//
// Now: the ResizeObserver watches the GRID only (one target), the per-photo cap is measured when
// the modal actually asks for it, and the preload observer picks up new tiles incrementally
// instead of restarting.
export function usePhotoGridObservers(
  gridRef: RefObject<HTMLDivElement | null>,
  photoIdsKey: string,
  onRadiusMaxChange: (max: number) => void,
): { measureTileRadiusMax: (photoId: string) => number | null; gridSizeVersion: number } {
  const observedRef = useRef<WeakSet<Element>>(new WeakSet())
  const preloadRef = useRef<IntersectionObserver | null>(null)
  const teardownRef = useRef<(() => void) | null>(null)
  const lastWidthRef = useRef(0)
  // Bumped only when the tile width really changes, so anything holding a measurement knows to
  // take it again. See publishGlobalMax for why this is not bumped on every observer fire.
  const [gridSizeVersion, setGridSizeVersion] = useState(0)

  /** The cap for ONE tile: half its shorter side, which is the radius that makes it fully round. */
  const measureTileRadiusMax = useCallback((photoId: string): number | null => {
    const grid = gridRef.current
    if (!grid) return null
    // CSS.escape: photo ids are uuids today, but an id with a quote in it would otherwise turn a
    // selector into a syntax error rather than a miss.
    const tile = grid.querySelector<HTMLElement>(`[data-photo-id="${CSS.escape(photoId)}"]`)
    if (!tile) return null
    const rect = tile.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return Math.max(1, Math.ceil(Math.min(rect.width, rect.height) / 2))
  }, [gridRef])

  // The GLOBAL cap, for the owner toolbar's album-wide radius slider.
  //
  // Every tile shares the grid's column width, so one tile answers this. It is deliberately taken
  // from the WIDTH: min(w, h) can never exceed the width, so this is either exact (square tiles, and
  // any masonry album containing one portrait photo) or slightly generous. Generous is the safe
  // direction — OwnerToolbar WRITES the album's stored radius down when it exceeds this number, so
  // an under-measurement would quietly shrink a radius the owner chose on purpose. A radius past
  // fully-round just renders as fully round.
  const publishGlobalMax = useCallback(() => {
    const grid = gridRef.current
    if (!grid) return
    const tile = grid.querySelector<HTMLElement>('[data-photo-id]')
    if (!tile) return
    const { width } = tile.getBoundingClientRect()
    if (width <= 0) return
    // WIDTH ONLY, AND ONLY WHEN IT CHANGES.
    //
    // A ResizeObserver on the grid fires whenever its HEIGHT changes too, and on iOS the address
    // bar collapsing during a scroll does exactly that — so re-rendering here would re-render every
    // tile in the album on an ordinary scroll. Tile width is what the radius cap depends on, and it
    // only moves on a real rotate or window resize.
    if (Math.abs(width - lastWidthRef.current) < 0.5) return
    lastWidthRef.current = width
    onRadiusMaxChange(Math.max(1, Math.ceil(width / 2)))
    setGridSizeVersion((v) => v + 1)
  }, [gridRef, onRadiusMaxChange])

  // ATTACHED TO WHATEVER GRID ELEMENT EXISTS NOW, not to the one that existed at mount.
  //
  // The first version of this created both observers in a mount-only effect, which was wrong in a
  // way that cost the owner their settings. PhotoGrid returns an empty-state card instead of the
  // grid when there are no photos, so the ref is null at mount — and the owner's very first action
  // at this event is "create album, open it, upload 5,000 photos". The observers were then never
  // created for the rest of the session: no thumbnail pre-warming at all, and mediaRadiusMax stuck
  // at its initial 144. OwnerToolbar WRITES media_radius down to that ceiling, so on a wide grid
  // the owner's saved corner radius was silently rewritten to a number no one chose.
  //
  // The same applies mid-session: a bib search matching nothing unmounts the grid, and the search
  // being cleared mounts a NEW element. Comparing against the element we attached to catches both,
  // and re-attaching is cheap because it only happens when the element itself changes — not on
  // every refetch, which is what this hook was rewritten to stop doing.
  const attachedRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const grid = gridRef.current
    if (grid === attachedRef.current) return
    teardownRef.current?.()
    teardownRef.current = null
    attachedRef.current = grid
    // A fresh element means fresh tiles; the old WeakSet entries refer to nodes that are gone, and
    // the remembered width belongs to a box that no longer exists.
    observedRef.current = new WeakSet()
    lastWidthRef.current = 0
    if (!grid) return

    const resizeObserver = new ResizeObserver(publishGlobalMax)
    resizeObserver.observe(grid)

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
    preloadRef.current = preloadObserver

    teardownRef.current = () => {
      resizeObserver.disconnect()
      preloadObserver.disconnect()
      preloadRef.current = null
    }
    // photoIdsKey is the dep that makes this run again: it changes when photos arrive, which is
    // exactly when an empty grid becomes a real one.
  }, [gridRef, photoIdsKey, publishGlobalMax])

  // Disconnect on unmount. Separate from the attach effect so re-attaching does not depend on the
  // cleanup order of the effect that is replacing it.
  useEffect(() => () => {
    teardownRef.current?.()
    teardownRef.current = null
    // CLEARED TOGETHER WITH THE TEARDOWN, always. Leaving this pointing at the element we just
    // disconnected from makes the attach effect's `grid === attachedRef.current` check return early
    // and never rebuild — which is exactly what happens under React StrictMode's mount/unmount/
    // remount in development: observers created, torn down, then never recreated. The result in dev
    // is no thumbnail preloading and mediaRadiusMax stuck at 144, i.e. the precise bug this hook
    // was rewritten to remove, reproduced in the only environment where anyone would check.
    attachedRef.current = null
  }, [])

  // New tiles only. A tile already seen is never re-observed, so a refetch that appends 40 photos
  // costs 40 registrations, not 5,000 — and it cannot re-fire preload fetches for tiles the guest
  // scrolled past ten minutes ago.
  useEffect(() => {
    const grid = gridRef.current
    const preloadObserver = preloadRef.current
    if (!grid || !preloadObserver) return
    const observed = observedRef.current
    grid.querySelectorAll<HTMLElement>('[data-photo-id]').forEach((tile) => {
      if (observed.has(tile)) return
      observed.add(tile)
      preloadObserver.observe(tile)
    })
    publishGlobalMax()
  }, [gridRef, photoIdsKey, publishGlobalMax])

  return { measureTileRadiusMax, gridSizeVersion }
}
