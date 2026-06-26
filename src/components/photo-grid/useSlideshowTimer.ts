import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { MediaType } from '@/types'

type Options = {
  active: boolean
  paused: boolean
  lightbox: number | null
  viewerPhotosLength: number
  currentId: string | undefined
  currentMediaType: MediaType | undefined
  // Used for Stream videos: advances slideshow after the video finishes naturally.
  // null = unknown duration → timer disabled, user must advance manually.
  currentDurationSeconds: number | null
  intervalMs: number
  onNext: () => void
}

export type SlideshowTimer = {
  clear: () => void
  startedAtRef: MutableRefObject<number>
  remainingMsRef: MutableRefObject<number | null>
}

export function useSlideshowTimer({
  active,
  paused,
  lightbox,
  viewerPhotosLength,
  currentId,
  currentMediaType,
  currentDurationSeconds,
  intervalMs,
  onNext,
}: Options): SlideshowTimer {
  const timerRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)
  const remainingMsRef = useRef<number | null>(null)
  // Stable ref so onNext identity changes (from viewerPhotos.length change) don't restart timer.
  const onNextRef = useRef(onNext)
  onNextRef.current = onNext

  const clear = useCallback(() => {
    if (timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  // Reset remaining time whenever the photo or interval changes.
  useEffect(() => {
    remainingMsRef.current = intervalMs
  }, [currentId, intervalMs])

  useEffect(() => {
    clear()

    // For Stream videos: use duration_seconds so the slideshow advances after the
    // video finishes naturally. Videos with unknown duration disable the timer.
    // For images: honour remaining time from pause/resume.
    const isVideo = currentMediaType === 'video'
    const videoDuration =
      isVideo && currentDurationSeconds && currentDurationSeconds > 0
        ? currentDurationSeconds * 1000 + 800
        : null
    const effectiveMs = isVideo ? videoDuration : (remainingMsRef.current ?? intervalMs)

    if (
      !active ||
      paused ||
      lightbox === null ||
      viewerPhotosLength < 2 ||
      effectiveMs === null
    ) {
      if (!paused) remainingMsRef.current = intervalMs
      return
    }

    // Images: clamp to [250, intervalMs] to respect pause/resume remaining time.
    // Videos: use full duration (don't clamp against intervalMs).
    const duration = isVideo
      ? Math.max(250, effectiveMs)
      : Math.max(250, Math.min(intervalMs, effectiveMs))

    remainingMsRef.current = duration
    startedAtRef.current = Date.now()
    timerRef.current = window.setTimeout(() => {
      remainingMsRef.current = intervalMs
      onNextRef.current()
    }, duration)

    return clear
  }, [
    active,
    paused,
    lightbox,
    viewerPhotosLength,
    currentId,
    currentMediaType,
    currentDurationSeconds,
    intervalMs,
    clear,
  ])

  return { clear, startedAtRef, remainingMsRef }
}
