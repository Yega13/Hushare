import React, { useState, useRef, useEffect } from 'react'
import type { Photo } from '@/types'
import { PREFETCH_DELTAS } from '@/lib/lightbox-plan'

type Options = {
  lightbox: number | null
  currentId: string | undefined
  viewerPhotos: Photo[]
}

export type LightboxMedia = {
  lightboxMediaNode: HTMLElement | null
  setLightboxMediaNode: React.Dispatch<React.SetStateAction<HTMLElement | null>>
  lightboxRadiusMax: number | null
  lightboxOriginalLoadedIds: Set<string>
  setLightboxOriginalLoadedIds: React.Dispatch<React.SetStateAction<Set<string>>>
}

export function useLightboxMedia({ lightbox, currentId, viewerPhotos }: Options): LightboxMedia {
  const viewerPhotosRef = useRef<Photo[]>(viewerPhotos)
  viewerPhotosRef.current = viewerPhotos

  const [lightboxMediaNode, setLightboxMediaNode] = useState<HTMLElement | null>(null)
  const [lightboxRadiusMax, setLightboxRadiusMax] = useState<number | null>(null)
  const [lightboxOriginalLoadedIds, setLightboxOriginalLoadedIds] = useState<Set<string>>(new Set())

  // Reset media node + radius cap when the photo changes (node is replaced by a new DOM element).
  useEffect(() => {
    setLightboxMediaNode(null)
    setLightboxRadiusMax(null)
  }, [currentId])

  // Measure and track the radius cap as the lightbox media node resizes.
  useEffect(() => {
    const maybeMediaNode = lightboxMediaNode
    if (!maybeMediaNode) return
    const mediaNode = maybeMediaNode

    function measureLightboxMedia() {
      const rect = mediaNode.getBoundingClientRect()
      const cap = Math.max(1, Math.ceil(Math.min(rect.width, rect.height) / 2))
      setLightboxRadiusMax(cap)
    }

    measureLightboxMedia()
    const observer = new ResizeObserver(measureLightboxMedia)
    observer.observe(mediaNode)
    window.addEventListener('resize', measureLightboxMedia)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measureLightboxMedia)
    }
  }, [lightboxMediaNode])

  // Prefetch per PREFETCH_DELTAS (lib/lightbox-plan.ts) so swipes paint from cache. This hook is
  // the ONLY prefetcher — LightboxOverlay had a second loop doing ±1 again, and together they put
  // up to seven full-res downloads in flight per swipe, which is what made big albums lag.
  // For videos the poster image is prefetched (that is what paints on arrival); the Stream iframe
  // manages its own buffering, and fetch()ing an iframe URL would just download an HTML page.
  useEffect(() => {
    if (lightbox === null) return
    if (typeof window === 'undefined') return
    const viewer = viewerPhotosRef.current
    for (const delta of PREFETCH_DELTAS) {
      const i = lightbox + delta
      if (i < 0 || i >= viewer.length) continue
      const photo = viewer[i]
      if (!photo) continue
      const isVideo = photo.media_type === 'video'
      const src = isVideo ? (photo.poster_url || photo.stream_thumbnail_url) : photo.url
      if (!src) continue
      const loader = new window.Image()
      loader.decoding = 'async'
      ;(loader as HTMLImageElement & { fetchPriority?: string }).fetchPriority = delta === 0 ? 'high' : 'low'
      if (!isVideo) {
        // Only images join loadedIds — the overlay uses it to swap thumb → original, and a
        // video's poster arriving must never mark the photo as "original loaded".
        loader.onload = () => {
          setLightboxOriginalLoadedIds((prev) => {
            if (prev.has(photo.id)) return prev
            const next = new Set(prev)
            next.add(photo.id)
            return next
          })
        }
      }
      loader.src = src
    }
    // currentId is a dep because the photo AT an index can change while the index doesn't —
    // a realtime refetch after the owner deletes or reorders replaces the array underneath an
    // open lightbox. Depending on the index alone left the new current photo unprefetched and,
    // worse, permanently absent from loadedIds, so the overlay held its dimmed thumbnail until
    // the guest swiped away and back.
  }, [lightbox, currentId])

  return {
    lightboxMediaNode,
    setLightboxMediaNode,
    lightboxRadiusMax,
    lightboxOriginalLoadedIds,
    setLightboxOriginalLoadedIds,
  }
}
