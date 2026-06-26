import React, { useState, useRef, useEffect, useCallback } from 'react'
import { cssMediaDisplayFilter, type MediaDisplayFilter } from '@/lib/media-display'
import type { Photo } from '@/types'

type Point = { x: number; y: number }

type Options = {
  currentId: string | undefined
  lightboxMediaNode: HTMLElement | null
  previewRadiusFor: (photo: Photo) => number
  previewFilterFor: (photo: Photo) => MediaDisplayFilter
}

export type LightboxZoom = {
  zoomScale: number
  zoomPan: Point
  lightboxFlipped: boolean
  setLightboxFlipped: React.Dispatch<React.SetStateAction<boolean>>
  resetZoom: () => void
  toggleZoom: (e?: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>) => void
  mediaZoomStyle: (photo: Photo) => React.CSSProperties
  handleMediaTouchStart: (e: React.TouchEvent<HTMLElement>) => void
  handleMediaTouchMove: (e: React.TouchEvent<HTMLElement>) => void
  handleMediaTouchEnd: (e: React.TouchEvent<HTMLElement>) => void
  handleMediaMouseDown: (e: React.MouseEvent<HTMLElement>) => void
  handleMediaMouseMove: (e: React.MouseEvent<HTMLElement>) => void
  handleMediaMouseUp: (e: React.MouseEvent<HTMLElement>) => void
}

function touchDistance(touches: React.TouchList): number {
  const first = touches[0]
  const second = touches[1]
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)
}

function touchMidpoint(touches: React.TouchList): Point {
  const first = touches[0]
  const second = touches[1]
  return {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  }
}

function pointFromEvent(e: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>): Point | null {
  if ('touches' in e) {
    const touch = e.changedTouches[0] ?? e.touches[0]
    return touch ? { x: touch.clientX, y: touch.clientY } : null
  }
  return { x: e.clientX, y: e.clientY }
}

function pointRelativeToCenter(point: Point, node: HTMLElement): Point {
  const rect = node.getBoundingClientRect()
  return {
    x: point.x - (rect.left + rect.width / 2),
    y: point.y - (rect.top + rect.height / 2),
  }
}

export function useLightboxZoom({
  currentId,
  lightboxMediaNode,
  previewRadiusFor,
  previewFilterFor,
}: Options): LightboxZoom {
  const pinchRef = useRef<{ distance: number; scale: number; pan: Point; center: Point } | null>(null)
  const panGestureRef = useRef<{ point: Point; pan: Point; moved: boolean } | null>(null)
  const panRef = useRef<Point>({ x: 0, y: 0 })
  const lastTapRef = useRef(0)
  const rotateTimerRef = useRef<number | null>(null)
  const rotateTouchStartRef = useRef<Point | null>(null)
  const rotateHoldFiredRef = useRef(false)

  const [zoomScale, setZoomScale] = useState(1)
  const [zoomPan, setZoomPan] = useState<Point>({ x: 0, y: 0 })
  const [lightboxFlipped, setLightboxFlipped] = useState(false)

  const setZoomPanValue = useCallback((nextPan: Point) => {
    panRef.current = nextPan
    setZoomPan(nextPan)
  }, [])

  const resetZoom = useCallback(() => {
    setZoomScale(1)
    setZoomPanValue({ x: 0, y: 0 })
    pinchRef.current = null
    panGestureRef.current = null
  }, [setZoomPanValue])

  function clearRotateTimer() {
    if (rotateTimerRef.current != null) {
      window.clearTimeout(rotateTimerRef.current)
      rotateTimerRef.current = null
    }
  }

  function toggleZoom(e?: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>) {
    const mediaNode = lightboxMediaNode
    if (zoomScale > 1 || !mediaNode) {
      resetZoom()
      return
    }
    const point = e ? pointFromEvent(e) : null
    const nextScale = 2
    setZoomScale(nextScale)
    if (point) {
      const relative = pointRelativeToCenter(point, mediaNode)
      setZoomPanValue({
        x: -relative.x * (nextScale - 1),
        y: -relative.y * (nextScale - 1),
      })
    }
  }

  function mediaZoomStyle(photo: Photo): React.CSSProperties {
    return {
      borderRadius: previewRadiusFor(photo),
      filter: cssMediaDisplayFilter(previewFilterFor(photo)),
      transform: `translate3d(${zoomPan.x}px, ${zoomPan.y}px, 0) scale(${zoomScale})`,
      transformOrigin: 'center',
      transition: pinchRef.current || panGestureRef.current ? 'filter 180ms ease' : 'transform 160ms ease, filter 180ms ease',
      touchAction: zoomScale > 1 ? 'none' : 'pan-y',
      cursor: zoomScale > 1 ? 'zoom-out' : 'zoom-in',
    }
  }

  function handleMediaTouchStart(e: React.TouchEvent<HTMLElement>) {
    if (e.touches.length === 2) {
      e.stopPropagation()
      clearRotateTimer()
      const mediaNode = e.currentTarget
      pinchRef.current = {
        distance: touchDistance(e.touches),
        scale: zoomScale,
        pan: panRef.current,
        center: pointRelativeToCenter(touchMidpoint(e.touches), mediaNode),
      }
      panGestureRef.current = null
      return
    }
    if (zoomScale > 1) {
      e.stopPropagation()
      if (e.cancelable) e.preventDefault()
      const touch = e.touches[0]
      if (touch) panGestureRef.current = { point: { x: touch.clientX, y: touch.clientY }, pan: panRef.current, moved: false }
      return
    }
    if (e.touches.length === 1) {
      const touch = e.touches[0]
      rotateTouchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null
      clearRotateTimer()
      rotateHoldFiredRef.current = false
      rotateTimerRef.current = window.setTimeout(() => {
        rotateTimerRef.current = null
        rotateHoldFiredRef.current = true
        setLightboxFlipped(true)
      }, 600)
    }
  }

  function handleMediaTouchMove(e: React.TouchEvent<HTMLElement>) {
    if (rotateTimerRef.current !== null && e.touches.length === 1) {
      const touch = e.touches[0]
      const start = rotateTouchStartRef.current
      if (touch && start && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10) {
        clearRotateTimer()
      }
    }
    if (pinchRef.current && e.touches.length === 2) {
      e.stopPropagation()
      if (e.cancelable) e.preventDefault()
      const nextScale = Math.max(1, Math.min(4, pinchRef.current.scale * (touchDistance(e.touches) / pinchRef.current.distance)))
      const ratio = nextScale / Math.max(1, pinchRef.current.scale)
      const startPan = pinchRef.current.pan
      const center = pinchRef.current.center
      setZoomScale(nextScale)
      setZoomPanValue({
        x: center.x - (center.x - startPan.x) * ratio,
        y: center.y - (center.y - startPan.y) * ratio,
      })
      return
    }
    if (panGestureRef.current && e.touches.length === 1 && zoomScale > 1) {
      e.stopPropagation()
      if (e.cancelable) e.preventDefault()
      const touch = e.touches[0]
      const deltaX = touch.clientX - panGestureRef.current.point.x
      const deltaY = touch.clientY - panGestureRef.current.point.y
      if (Math.hypot(deltaX, deltaY) > 6) panGestureRef.current.moved = true
      setZoomPanValue({
        x: panGestureRef.current.pan.x + deltaX,
        y: panGestureRef.current.pan.y + deltaY,
      })
    }
  }

  function handleMediaTouchEnd(e: React.TouchEvent<HTMLElement>) {
    clearRotateTimer()
    rotateTouchStartRef.current = null
    if (rotateHoldFiredRef.current) {
      rotateHoldFiredRef.current = false
      e.stopPropagation()
      if (e.cancelable) e.preventDefault()
      return
    }
    if (lightboxFlipped) {
      setLightboxFlipped(false)
      e.stopPropagation()
      if (e.cancelable) e.preventDefault()
      return
    }
    if (pinchRef.current) {
      e.stopPropagation()
      if (e.touches.length < 2) pinchRef.current = null
      if (zoomScale <= 1.02) resetZoom()
      return
    }
    if (panGestureRef.current) {
      e.stopPropagation()
      const wasTap = !panGestureRef.current.moved
      panGestureRef.current = null
      if (wasTap) {
        const now = Date.now()
        if (now - lastTapRef.current < 280) {
          if (e.cancelable) e.preventDefault()
          toggleZoom(e)
          lastTapRef.current = 0
        } else {
          lastTapRef.current = now
        }
      }
      return
    }
    const now = Date.now()
    if (now - lastTapRef.current < 280) {
      e.stopPropagation()
      if (e.cancelable) e.preventDefault()
      toggleZoom(e)
      lastTapRef.current = 0
      return
    }
    lastTapRef.current = now
  }

  function handleMediaMouseDown(e: React.MouseEvent<HTMLElement>) {
    if (zoomScale <= 1) return
    e.stopPropagation()
    e.preventDefault()
    panGestureRef.current = { point: { x: e.clientX, y: e.clientY }, pan: panRef.current, moved: false }
  }

  function handleMediaMouseMove(e: React.MouseEvent<HTMLElement>) {
    if (!panGestureRef.current || zoomScale <= 1) return
    e.stopPropagation()
    e.preventDefault()
    if (Math.hypot(e.clientX - panGestureRef.current.point.x, e.clientY - panGestureRef.current.point.y) > 6) {
      panGestureRef.current.moved = true
    }
    setZoomPanValue({
      x: panGestureRef.current.pan.x + e.clientX - panGestureRef.current.point.x,
      y: panGestureRef.current.pan.y + e.clientY - panGestureRef.current.point.y,
    })
  }

  function handleMediaMouseUp(e: React.MouseEvent<HTMLElement>) {
    if (!panGestureRef.current) return
    e.stopPropagation()
    panGestureRef.current = null
  }

  // Reset zoom and flip when the displayed photo changes.
  useEffect(() => {
    resetZoom()
    setLightboxFlipped(false)
    lastTapRef.current = 0
  }, [currentId, resetZoom])

  useEffect(() => () => {
    clearRotateTimer()
  }, [])

  return {
    zoomScale,
    zoomPan,
    lightboxFlipped,
    setLightboxFlipped,
    resetZoom,
    toggleZoom,
    mediaZoomStyle,
    handleMediaTouchStart,
    handleMediaTouchMove,
    handleMediaTouchEnd,
    handleMediaMouseDown,
    handleMediaMouseMove,
    handleMediaMouseUp,
  }
}
