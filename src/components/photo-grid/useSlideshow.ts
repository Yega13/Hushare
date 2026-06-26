import { useState, useRef, useEffect, useCallback, type Dispatch, type SetStateAction } from 'react'
import { showAppToast } from '@/components/AppToast'
import type { Photo } from '@/types'

type Options = {
  photos: Photo[]
  slideshowRequestId: number
  lightbox: number | null
  onSetLightboxIndex: (index: number | null) => void
}

export type Slideshow = {
  slideshowActive: boolean
  slideshowPaused: boolean
  slideshowPickerOpen: boolean
  slideshowSelectedIds: Set<string>
  slideshowPhotoIds: string[] | null
  slideshowMode: boolean
  setSlideshowActive: Dispatch<SetStateAction<boolean>>
  setSlideshowPaused: Dispatch<SetStateAction<boolean>>
  setSlideshowPickerOpen: Dispatch<SetStateAction<boolean>>
  setSlideshowSelectedIds: Dispatch<SetStateAction<Set<string>>>
  toggleSlideshowPick: (photoId: string) => void
  startSlideshow: (photoIds: string[]) => void
  clearSlideshow: () => void
  removeFromSlideshow: (photoId: string) => void
}

export function useSlideshow({
  photos,
  slideshowRequestId,
  lightbox,
  onSetLightboxIndex,
}: Options): Slideshow {
  const handledSlideshowRequestRef = useRef(0)
  const [slideshowActive, setSlideshowActive] = useState(false)
  const [slideshowPaused, setSlideshowPaused] = useState(false)
  const [slideshowPickerOpen, setSlideshowPickerOpen] = useState(false)
  const [slideshowSelectedIds, setSlideshowSelectedIds] = useState<Set<string>>(new Set())
  const [slideshowPhotoIds, setSlideshowPhotoIds] = useState<string[] | null>(null)

  const slideshowMode = slideshowPhotoIds !== null

  function toggleSlideshowPick(photoId: string) {
    setSlideshowSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(photoId)) next.delete(photoId)
      else next.add(photoId)
      return next
    })
  }

  function startSlideshow(photoIds: string[]) {
    setSlideshowPhotoIds(photoIds)
    setSlideshowActive(photoIds.length > 1)
    setSlideshowPaused(false)
    setSlideshowPickerOpen(false)
  }

  const clearSlideshow = useCallback(() => {
    setSlideshowActive(false)
    setSlideshowPaused(false)
    setSlideshowPhotoIds(null)
  }, [])

  function removeFromSlideshow(photoId: string) {
    if (!slideshowPhotoIds) return
    const newIds = slideshowPhotoIds.filter((id) => id !== photoId)
    if (newIds.length === 0) {
      setSlideshowPhotoIds(null)
      onSetLightboxIndex(null)
      return
    }
    if (lightbox !== null && lightbox >= newIds.length) {
      onSetLightboxIndex(newIds.length - 1)
    }
    setSlideshowPhotoIds(newIds)
    showAppToast('Removed from slideshow.')
  }

  useEffect(() => {
    if (!slideshowRequestId || handledSlideshowRequestRef.current === slideshowRequestId) return
    handledSlideshowRequestRef.current = slideshowRequestId
    if (photos.length === 0) {
      showAppToast('No media to show yet.', 'error')
      return
    }
    if (photos.length < 2) {
      showAppToast('A slideshow needs at least 2 photos or videos.', 'error')
      return
    }
    setSlideshowSelectedIds(new Set(photos.map((p) => p.id)))
    setSlideshowPickerOpen(true)
  }, [photos, slideshowRequestId])

  return {
    slideshowActive,
    slideshowPaused,
    slideshowPickerOpen,
    slideshowSelectedIds,
    slideshowPhotoIds,
    slideshowMode,
    setSlideshowActive,
    setSlideshowPaused,
    setSlideshowPickerOpen,
    setSlideshowSelectedIds,
    toggleSlideshowPick,
    startSlideshow,
    clearSlideshow,
    removeFromSlideshow,
  }
}
