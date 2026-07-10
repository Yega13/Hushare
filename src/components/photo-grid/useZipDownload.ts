'use client'

import { useState, useRef } from 'react'
import { showAppToast } from '@/components/AppToast'
import type { Photo } from '@/types'

// 16 concurrent blob fetches saturate typical home broadband without overwhelming
// the server. Each request goes through /api/download/photo?blob=1 which has a
// rate limit of 2000/hr — well above what a 2000-photo album zip needs.
const CONCURRENCY = 16

export function useZipDownload(photos: Photo[], albumTitle: string) {
  const [zipping, setZipping] = useState(false)
  const [zipProgress, setZipProgress] = useState(0)
  const abortRef = useRef(false)

  async function downloadZip() {
    // Stream videos have no R2 file — only images (storage_backend === 'r2') are downloadable.
    const downloadable = photos.filter((p) => p.storage_backend !== 'stream')
    if (downloadable.length === 0) {
      showAppToast('No downloadable photos in this album.', 'error')
      return
    }
    setZipping(true)
    setZipProgress(0)
    abortRef.current = false
    // Lazy-loaded: JSZip (~28KB gzip) is only needed by the owner/guest who actually clicks
    // download, not shipped to every album visitor.
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()

    let done = 0
    let failed = 0
    const total = downloadable.length

    async function fetchOne(photo: Photo) {
      if (abortRef.current) return
      try {
        // blob=1: server streams R2 bytes through the response body so client fetch()
        // can read it cross-origin without CORS. Uses a separate high rate limit (2000/hr).
        const res = await fetch(`/api/download/photo?id=${encodeURIComponent(photo.id)}&blob=1`, {
          credentials: 'include',
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        const ext = (photo.storage_path ?? '').split('.').pop()?.toLowerCase() || 'jpg'
        const base = (photo.caption?.trim() || photo.id)
          .replace(/[/\\:*?"<>|]/g, '_')
          .slice(0, 80)
        // Deduplicate filenames: if two photos share a caption, append the photo's short ID
        // so JSZip doesn't silently overwrite the first entry with the second.
        const proposed = `${base}.${ext}`
        const filename = zip.files[proposed] ? `${base}-${photo.id.slice(0, 8)}.${ext}` : proposed
        zip.file(filename, blob, { compression: 'STORE' })
      } catch {
        failed++
      }
      done++
      setZipProgress(Math.round((done / total) * 100))
    }

    // Run at most CONCURRENCY fetches at a time.
    const queue = [...downloadable]
    async function runWorker() {
      while (queue.length > 0 && !abortRef.current) {
        const photo = queue.shift()!
        await fetchOne(photo)
      }
    }
    const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, () => runWorker())
    await Promise.all(workers)

    if (abortRef.current) {
      setZipping(false)
      setZipProgress(0)
      return
    }

    if (failed > 0) {
      showAppToast(`${total - failed} of ${total} photos added (${failed} failed).`, 'error')
    }

    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
    const safeTitle = (albumTitle.trim() || 'album').replace(/[/\\:*?"<>|]/g, '_')
    const blobUrl = URL.createObjectURL(zipBlob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = `${safeTitle}.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000)

    setZipping(false)
    setZipProgress(0)
  }

  function cancelZip() {
    abortRef.current = true
  }

  return { zipping, zipProgress, downloadZip, cancelZip }
}
