import React, { useState, useRef, useEffect } from 'react'
import { SWIPE_THRESHOLD_PX, SWIPE_VELOCITY_MIN, SWIPE_RESET_ANIMATE_MS } from '@/lib/constants'

type Options = {
  zoomScale: number
  currentId: string | undefined
  onPrev: () => void
  onNext: () => void
}

export type SwipeNavigation = {
  swipeOffset: number
  swipeAnimating: boolean
  handleSwipeStart: (e: React.TouchEvent<HTMLDivElement>) => void
  handleSwipeMove: (e: React.TouchEvent<HTMLDivElement>) => void
  handleSwipeEnd: (e: React.TouchEvent<HTMLDivElement>) => void
  handleSwipeCancel: () => void
}

export function useSwipeNavigation({ zoomScale, currentId, onPrev, onNext }: Options): SwipeNavigation {
  const swipeRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const [swipeOffset, setSwipeOffset] = useState(0)
  const [swipeAnimating, setSwipeAnimating] = useState(false)
  // Track all pending animation timers so they can be cancelled on unmount,
  // preventing setState calls after the lightbox closes.
  const swipeTimersRef = useRef<Set<number>>(new Set())

  useEffect(() => () => {
    swipeTimersRef.current.forEach((id) => window.clearTimeout(id))
    swipeTimersRef.current.clear()
  }, [])

  // Reset swipe state whenever the displayed photo changes (e.g. keyboard nav, thumbnail click).
  useEffect(() => {
    swipeRef.current = null
    setSwipeAnimating(false)
    setSwipeOffset(0)
  }, [currentId])

  function handleSwipeStart(e: React.TouchEvent<HTMLDivElement>) {
    if (zoomScale > 1 || e.touches.length !== 1) {
      swipeRef.current = null
      return
    }
    const touch = e.touches[0]
    swipeRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() }
    setSwipeAnimating(false)
    setSwipeOffset(0)
  }

  function handleSwipeMove(e: React.TouchEvent<HTMLDivElement>) {
    if (zoomScale > 1 || e.touches.length !== 1) return
    const start = swipeRef.current
    if (!start) return

    const touch = e.touches[0]
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) < 8 || Math.abs(deltaX) < Math.abs(deltaY)) return

    setSwipeOffset(deltaX)
  }

  function handleSwipeEnd(e: React.TouchEvent<HTMLDivElement>) {
    if (zoomScale > 1) {
      swipeRef.current = null
      setSwipeOffset(0)
      return
    }
    const start = swipeRef.current
    swipeRef.current = null
    if (!start || e.changedTouches.length !== 1) {
      setSwipeOffset(0)
      return
    }

    const touch = e.changedTouches[0]
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    const elapsed = Date.now() - start.time
    const velocity = Math.abs(deltaX) / Math.max(1, elapsed)
    const isHorizontalSwipe = Math.abs(deltaX) >= SWIPE_THRESHOLD_PX && Math.abs(deltaX) > Math.abs(deltaY) * 1.15
    if (!isHorizontalSwipe && velocity < SWIPE_VELOCITY_MIN) {
      setSwipeAnimating(true)
      setSwipeOffset(0)
      const t = window.setTimeout(() => { swipeTimersRef.current.delete(t); setSwipeAnimating(false) }, SWIPE_RESET_ANIMATE_MS)
      swipeTimersRef.current.add(t)
      return
    }

    const direction = deltaX < 0 ? -1 : 1
    // Prevent iOS from synthesizing a click after the swipe, which would
    // trigger closeLightbox() via the swipe div's onClick handler.
    if (e.cancelable) e.preventDefault()
    setSwipeAnimating(true)
    setSwipeOffset(direction * window.innerWidth)
    const t = window.setTimeout(() => {
      swipeTimersRef.current.delete(t)
      if (direction < 0) onNext()
      else onPrev()
      setSwipeAnimating(false)
      setSwipeOffset(0)
    }, 150) // matches the 170ms slide transition — snappy without cutting the animation short
    swipeTimersRef.current.add(t)
  }

  function handleSwipeCancel() {
    swipeRef.current = null
    setSwipeAnimating(true)
    setSwipeOffset(0)
    const t = window.setTimeout(() => { swipeTimersRef.current.delete(t); setSwipeAnimating(false) }, SWIPE_RESET_ANIMATE_MS)
    swipeTimersRef.current.add(t)
  }

  return {
    swipeOffset,
    swipeAnimating,
    handleSwipeStart,
    handleSwipeMove,
    handleSwipeEnd,
    handleSwipeCancel,
  }
}
