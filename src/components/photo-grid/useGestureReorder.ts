import React, { useState, useRef, useEffect, type MutableRefObject } from 'react'
import {
  HOLD_TO_SELECT_MS,
  HOLD_TO_SELECT_MOBILE_MS,
  SUPPRESS_CLICK_AFTER_REORDER_MS,
  SUPPRESS_CLICK_AFTER_SELECT_MS,
  AUTO_SCROLL_ZONE_PX,
  AUTO_SCROLL_MIN_PX_FRAME,
  AUTO_SCROLL_MAX_PX_FRAME,
} from '@/lib/constants'
import { showAppToast } from '@/components/AppToast'
import type { Photo } from '@/types'

const ARRANGE_HINT_KEY = 'hush-arrange-hint-seen'

type Point = { x: number; y: number }

type Options = {
  photos: Photo[]
  slug: string
  isOwner: boolean
  arrangeMode: boolean
  onPhotosReordered: (photos: Photo[]) => void
  onEnterSelectMode: (photoId: string) => void
}

export type GestureReorder = {
  reorderDraggingId: string | null
  reorderTargetId: string | null
  reorderSaving: boolean
  dragGhostPointer: Point | null
  showArrangeHint: boolean
  setShowArrangeHint: React.Dispatch<React.SetStateAction<boolean>>
  reorderSuppressedClickRef: MutableRefObject<boolean>
  reorderDragTileSizeRef: MutableRefObject<number>
  startReorderPress: (photo: Photo, e: React.PointerEvent<HTMLDivElement>) => void
  handleTilePointerTouchStart: (photo: Photo, e: React.TouchEvent<HTMLDivElement>) => void
  handleTileTouchMove: (e: React.TouchEvent<HTMLDivElement>) => void
  handleTileTouchEnd: () => void
  handleReorderMove: (e: React.PointerEvent<HTMLDivElement>) => void
  finishReorder: (e: React.PointerEvent<HTMLDivElement>) => void
  clearReorderTimer: () => void
  cancelDrag: () => void
}

export function useGestureReorder({
  photos,
  slug,
  isOwner,
  arrangeMode,
  onPhotosReordered,
  onEnterSelectMode,
}: Options): GestureReorder {
  const reorderTimerRef = useRef<number | null>(null)
  const pendingOrderRef = useRef<Photo[] | null>(null)
  const prevArrangeModeRef = useRef(arrangeMode)
  const reorderDragIdRef = useRef<string | null>(null)
  const reorderTargetIdRef = useRef<string | null>(null)
  // True only while an arrange-mode drag is in flight. reorderDragIdRef is set on ANY
  // pointer-down (even normal mode, for the hold-to-select timer), so finishReorder and
  // handleReorderMove must check this flag instead of the drag id.
  const isArrangeDragRef = useRef(false)
  const autoScrollVelRef = useRef(0)
  const autoScrollRafRef = useRef<number | null>(null)
  const reorderSuppressedClickRef = useRef(false)
  const reorderDragPointerRef = useRef<Point | null>(null)
  const reorderDragTileSizeRef = useRef<number>(90)
  // Origin of a mobile long-press in progress. Used to distinguish a still hold (→ enter select
  // mode) from a scroll gesture.
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null)
  const longPressScrollYRef = useRef(0)

  const [reorderDraggingId, setReorderDraggingId] = useState<string | null>(null)
  const [reorderTargetId, setReorderTargetId] = useState<string | null>(null)
  const [reorderSaving, setReorderSaving] = useState(false)
  const [dragGhostPointer, setDragGhostPointer] = useState<Point | null>(null)
  const [showArrangeHint, setShowArrangeHint] = useState(false)

  function clearReorderTimer() {
    if (reorderTimerRef.current != null) {
      window.clearTimeout(reorderTimerRef.current)
      reorderTimerRef.current = null
    }
  }

  function stopAutoScroll() {
    autoScrollVelRef.current = 0
    if (autoScrollRafRef.current != null) {
      cancelAnimationFrame(autoScrollRafRef.current)
      autoScrollRafRef.current = null
    }
    document.documentElement.style.scrollBehavior = ''
  }

  function updateAutoScroll(clientY: number) {
    const vh = window.innerHeight
    let vel = 0
    if (clientY < AUTO_SCROLL_ZONE_PX) {
      const t = 1 - clientY / AUTO_SCROLL_ZONE_PX
      vel = -Math.ceil(AUTO_SCROLL_MIN_PX_FRAME + (AUTO_SCROLL_MAX_PX_FRAME - AUTO_SCROLL_MIN_PX_FRAME) * t)
    } else if (clientY > vh - AUTO_SCROLL_ZONE_PX) {
      const t = 1 - (vh - clientY) / AUTO_SCROLL_ZONE_PX
      vel = Math.ceil(AUTO_SCROLL_MIN_PX_FRAME + (AUTO_SCROLL_MAX_PX_FRAME - AUTO_SCROLL_MIN_PX_FRAME) * t)
    }
    autoScrollVelRef.current = vel
    if (vel !== 0 && autoScrollRafRef.current == null) {
      const tick = () => {
        if (autoScrollVelRef.current === 0) { autoScrollRafRef.current = null; return }
        document.documentElement.style.scrollBehavior = 'auto'
        window.scrollBy(0, autoScrollVelRef.current)
        autoScrollRafRef.current = requestAnimationFrame(tick)
      }
      autoScrollRafRef.current = requestAnimationFrame(tick)
    } else if (vel === 0) {
      stopAutoScroll()
    }
  }

  function cancelDrag() {
    clearReorderTimer()
    reorderDragIdRef.current = null
    setReorderDraggingId(null)
    setReorderTargetId(null)
  }

  function movePhoto(dragId: string, targetId: string) {
    if (dragId === targetId) return
    const fromIndex = photos.findIndex((photo) => photo.id === dragId)
    const toIndex = photos.findIndex((photo) => photo.id === targetId)
    if (fromIndex < 0 || toIndex < 0) return
    const nextPhotos = [...photos]
    ;[nextPhotos[fromIndex], nextPhotos[toIndex]] = [nextPhotos[toIndex], nextPhotos[fromIndex]]
    // Accumulate swaps locally — the save fires once when the user clicks Done (arrangeMode → false).
    const ordered = nextPhotos.map((photo, index) => ({ ...photo, sort_order: index }))
    pendingOrderRef.current = ordered
    const y = window.scrollY
    onPhotosReordered(ordered)
    requestAnimationFrame(() => {
      document.documentElement.style.scrollBehavior = 'auto'
      window.scrollTo(0, y)
      requestAnimationFrame(() => { document.documentElement.style.scrollBehavior = '' })
    })
  }

  async function savePhotoOrder(nextPhotos: Photo[]) {
    if (!isOwner) return
    const previousPhotos = photos
    onPhotosReordered(nextPhotos)
    setReorderSaving(true)
    try {
      const res = await fetch('/api/album/photos/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, photo_ids: nextPhotos.map((photo) => photo.id) }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        onPhotosReordered(previousPhotos)
        showAppToast(body.error ?? `Could not save order (${res.status})`, 'error')
      } else {
        showAppToast('Media order saved.')
      }
    } catch (e) {
      onPhotosReordered(previousPhotos)
      showAppToast(e instanceof Error ? e.message : 'Could not save order', 'error')
    } finally {
      setReorderSaving(false)
    }
  }

  function startReorderPress(photo: Photo, e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !isOwner || reorderSaving) return
    if (arrangeMode) {
      // Only the drag handle (data-drag-handle) initiates a drag. Detecting it here on the
      // tile means setPointerCapture is called on e.currentTarget — the tile — which is exactly
      // what onPointerMove/Up expect.
      if (!(e.target as HTMLElement).closest('[data-drag-handle]')) return
      e.preventDefault()
      clearReorderTimer()
      const tileEl = e.currentTarget
      const rect = tileEl.getBoundingClientRect()
      reorderDragIdRef.current = photo.id
      reorderTargetIdRef.current = photo.id
      reorderDragPointerRef.current = { x: e.clientX, y: e.clientY }
      reorderDragTileSizeRef.current = Math.round(Math.min(rect.width, rect.height) * 0.82)
      try { if (tileEl.isConnected) tileEl.setPointerCapture(e.pointerId) } catch {}
      isArrangeDragRef.current = true
      reorderSuppressedClickRef.current = true
      window.setTimeout(() => { reorderSuppressedClickRef.current = false }, SUPPRESS_CLICK_AFTER_REORDER_MS)
      setReorderDraggingId(photo.id)
      setReorderTargetId(photo.id)
      setDragGhostPointer({ x: e.clientX, y: e.clientY })
      return
    }
    if (e.pointerType === 'touch') return
    const coarsePointer = typeof window !== 'undefined' && window.matchMedia('(hover: none), (pointer: coarse)').matches
    if (coarsePointer) return
    // Desktop only: 500ms hold enters select mode
    clearReorderTimer()
    reorderDragIdRef.current = photo.id
    reorderDragPointerRef.current = { x: e.clientX, y: e.clientY }
    const rect = e.currentTarget.getBoundingClientRect()
    reorderDragTileSizeRef.current = Math.round(Math.min(rect.width, rect.height) * 0.82)
    reorderTimerRef.current = window.setTimeout(() => {
      reorderTimerRef.current = null
      reorderSuppressedClickRef.current = true
      window.setTimeout(() => { reorderSuppressedClickRef.current = false }, SUPPRESS_CLICK_AFTER_REORDER_MS)
      onEnterSelectMode(photo.id)
    }, HOLD_TO_SELECT_MS)
  }

  // Mobile long-press → enter bulk-select. Uses native touch events because Android Chrome's
  // pointer events are flaky for hold detection. Skips arrange mode (pointer-event drag handles
  // that with setPointerCapture).
  function handleTilePointerTouchStart(photo: Photo, e: React.TouchEvent<HTMLDivElement>) {
    if (!isOwner || reorderSaving || arrangeMode) return
    if (e.touches.length !== 1) return
    const t = e.touches[0]
    longPressOriginRef.current = { x: t.clientX, y: t.clientY }
    longPressScrollYRef.current = window.scrollY
    clearReorderTimer()
    reorderTimerRef.current = window.setTimeout(() => {
      reorderTimerRef.current = null
      longPressOriginRef.current = null
      // Suppress the click and any subsequent contextmenu (Android Chrome fires it ~600 ms in)
      // for a window long enough to outlast the gesture.
      reorderSuppressedClickRef.current = true
      window.setTimeout(() => { reorderSuppressedClickRef.current = false }, SUPPRESS_CLICK_AFTER_SELECT_MS)
      onEnterSelectMode(photo.id)
    }, HOLD_TO_SELECT_MOBILE_MS)
  }

  function handleTileTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (!longPressOriginRef.current || reorderTimerRef.current == null) return
    // Page-scroll check with a generous 120 px tolerance — on Android, the first touch often
    // hides the address bar, jumping scrollY by ~56 px, which is NOT the user scrolling. A real
    // scroll also moves the finger, which the dx/dy check below catches, so this is just a
    // backstop for momentum. Too tight a value here was cancelling every long-press.
    if (Math.abs(window.scrollY - longPressScrollYRef.current) > 120) {
      clearReorderTimer()
      longPressOriginRef.current = null
      return
    }
    const t = e.touches[0]
    if (!t) return
    const dx = Math.abs(t.clientX - longPressOriginRef.current.x)
    const dy = Math.abs(t.clientY - longPressOriginRef.current.y)
    // 20 px lets a finger settle/jitter during a hold without canceling, while still catching
    // any real swipe/scroll gesture.
    if (dx > 20 || dy > 20) {
      clearReorderTimer()
      longPressOriginRef.current = null
    }
  }

  function handleTileTouchEnd() {
    // Short tap — cancel the pending long-press timer. If the timer already fired, this is a
    // no-op (reorderTimerRef.current is null) and select mode stays.
    if (reorderTimerRef.current != null) {
      clearReorderTimer()
      longPressOriginRef.current = null
    }
  }

  function handleReorderMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isArrangeDragRef.current) return
    e.preventDefault()
    reorderDragPointerRef.current = { x: e.clientX, y: e.clientY }
    setDragGhostPointer({ x: e.clientX, y: e.clientY })
    updateAutoScroll(e.clientY)
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-photo-id]')
    const targetId = target?.dataset.photoId
    if (targetId) {
      reorderTargetIdRef.current = targetId
      setReorderTargetId(targetId)
    }
  }

  function finishReorder(e: React.PointerEvent<HTMLDivElement>) {
    clearReorderTimer()
    stopAutoScroll()
    const wasArrangeDrag = isArrangeDragRef.current
    const dragId = reorderDragIdRef.current
    const targetId = reorderTargetIdRef.current
    isArrangeDragRef.current = false
    reorderDragIdRef.current = null
    reorderTargetIdRef.current = null
    reorderDragPointerRef.current = null
    setReorderDraggingId(null)
    setReorderTargetId(null)
    setDragGhostPointer(null)
    if (wasArrangeDrag && dragId) {
      e.preventDefault()
      reorderSuppressedClickRef.current = true
      window.setTimeout(() => { reorderSuppressedClickRef.current = false }, 0)
      if (targetId) movePhoto(dragId, targetId)
    }
  }

  useEffect(() => {
    if (!arrangeMode) { setShowArrangeHint(false); return }
    if (typeof window === 'undefined') return
    if (localStorage.getItem(ARRANGE_HINT_KEY)) return
    localStorage.setItem(ARRANGE_HINT_KEY, '1')
    setShowArrangeHint(true)
  }, [arrangeMode])

  useEffect(() => {
    const wasArranging = prevArrangeModeRef.current
    prevArrangeModeRef.current = arrangeMode
    // arrange mode just turned off AND there are unsaved swaps — fire a single save
    if (wasArranging && !arrangeMode && pendingOrderRef.current) {
      void savePhotoOrder(pendingOrderRef.current)
      pendingOrderRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrangeMode])

  useEffect(() => () => {
    clearReorderTimer()
    stopAutoScroll()
  }, [])

  return {
    reorderDraggingId,
    reorderTargetId,
    reorderSaving,
    dragGhostPointer,
    showArrangeHint,
    setShowArrangeHint,
    reorderSuppressedClickRef,
    reorderDragTileSizeRef,
    startReorderPress,
    handleTilePointerTouchStart,
    handleTileTouchMove,
    handleTileTouchEnd,
    handleReorderMove,
    finishReorder,
    clearReorderTimer,
    cancelDrag,
  }
}
