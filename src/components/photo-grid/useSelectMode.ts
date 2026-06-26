import { useState, useEffect } from 'react'
import { showAppToast } from '@/components/AppToast'
import type { Photo } from '@/types'

type Options = {
  slug: string
  arrangeMode: boolean
  onPhotoDeleted: (id: string) => void
}

export type SelectMode = {
  selectMode: boolean
  selectedIds: Set<string>
  bulkDeleting: boolean
  enterSelectMode: (photoId: string) => void
  exitSelectMode: () => void
  toggleSelection: (photoId: string) => void
  selectAll: (photos: Photo[]) => void
  bulkDeleteSelected: () => Promise<void>
}

export function useSelectMode({
  slug,
  arrangeMode,
  onPhotoDeleted,
}: Options): SelectMode {
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  function enterSelectMode(photoId: string) {
    setSelectMode(true)
    setSelectedIds(new Set([photoId]))
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  function toggleSelection(photoId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(photoId)) next.delete(photoId)
      else next.add(photoId)
      return next
    })
  }

  function selectAll(photos: Photo[]) {
    setSelectedIds(new Set(photos.map((p) => p.id)))
  }

  async function bulkDeleteSelected() {
    if (selectedIds.size === 0) return
    setBulkDeleting(true)
    const ids = [...selectedIds]

    // Optimistic: remove from UI immediately.
    for (const id of ids) onPhotoDeleted(id)
    exitSelectMode()

    // Server max is 200 per request — chunk just in case.
    const CHUNK = 200
    let deleted = 0
    let failed = 0
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK)
      try {
        const res = await fetch('/api/album/photo/bulk-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, photo_ids: batch }),
        })
        const body = (await res.json().catch(() => ({}))) as { deleted?: number; error?: string }
        if (res.ok && typeof body.deleted === 'number') {
          deleted += body.deleted
        } else {
          failed += batch.length
          console.error('[bulk-delete] server error:', body.error ?? res.status)
        }
      } catch {
        failed += batch.length
      }
    }
    setBulkDeleting(false)
    if (failed > 0) showAppToast(`${deleted} deleted, ${failed} failed — refresh to see current state`, 'error')
  }

  // Exit select mode when arrange mode activates (they're mutually exclusive).
  useEffect(() => {
    if (arrangeMode && selectMode) exitSelectMode()
  }, [arrangeMode, selectMode])

  // Escape key exits select mode.
  useEffect(() => {
    if (!selectMode) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); exitSelectMode() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectMode])

  return {
    selectMode,
    selectedIds,
    bulkDeleting,
    enterSelectMode,
    exitSelectMode,
    toggleSelection,
    selectAll,
    bulkDeleteSelected,
  }
}
