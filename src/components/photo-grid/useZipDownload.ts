'use client'

import { useState, useRef } from 'react'
import { reportClientError } from '@/lib/report-error'
import { showAppToast } from '@/components/AppToast'
import type { Album, Photo } from '@/types'

// 16 concurrent blob fetches saturate typical home broadband without overwhelming the server.
// Each request goes through /api/download/photo?blob=1 (rate limit 2000/hr).
const CONCURRENCY = 16

// Photos per ZIP file. A whole big album can be tens of GB — far too much to hold in one browser
// tab — so we download it in parts, never holding more than one batch's worth in memory at once.
// Albums at/under this size are a single ZIP, exactly as before.
const BATCH_SIZE = 500

function safeName(s: string): string {
  return (s.trim() || 'album').replace(/[/\\:*?"<>|]/g, '_')
}

export function useZipDownload(photos: Photo[], album: Pick<Album, 'id' | 'title'>) {
  const [zipping, setZipping] = useState(false)
  const [zipProgress, setZipProgress] = useState(0)   // 0–100 across the ENTIRE download
  const [zipStatus, setZipStatus] = useState('')       // '' for a single ZIP; 'Part 2 of 40' when batched
  const abortRef = useRef(false)

  // Pull EVERY photo record for the album (metadata only — a few MB even at 20k) so the download is
  // the WHOLE album, not just the pages the owner happened to scroll to. Dedupes across windows.
  async function fetchAllRecords(): Promise<Photo[]> {
    const out: Photo[] = []
    const seen = new Set<string>()
    let offset = 0
    while (!abortRef.current) {
      const res = await fetch(`/api/album/photos?albumId=${encodeURIComponent(album.id)}&offset=${offset}&limit=2000`, { cache: 'no-store' })
      if (!res.ok) break
      const json = (await res.json()) as { photos?: Photo[]; total?: number }
      const page = json.photos ?? []
      for (const p of page) if (!seen.has(p.id)) { seen.add(p.id); out.push(p) }
      offset += page.length
      const total = json.total ?? out.length
      if (page.length === 0 || out.length >= total) break
    }
    return out
  }

  // Zip ONE list of photos and trigger its download. Progress is reported against the grand total
  // (base = how many were already done in earlier batches) so the bar climbs smoothly 0→100 overall.
  async function zipAndSave(list: Photo[], filename: string, base: number, grand: number): Promise<number> {
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    let done = 0
    let failed = 0

    async function fetchOne(photo: Photo) {
      if (abortRef.current) return
      try {
        const res = await fetch(`/api/download/photo?id=${encodeURIComponent(photo.id)}&blob=1`, { credentials: 'include' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        const ext = (photo.storage_path ?? '').split('.').pop()?.toLowerCase() || 'jpg'
        const b = (photo.caption?.trim() || photo.id).replace(/[/\\:*?"<>|]/g, '_').slice(0, 80)
        const proposed = `${b}.${ext}`
        const name = zip.files[proposed] ? `${b}-${photo.id.slice(0, 8)}.${ext}` : proposed
        zip.file(name, blob, { compression: 'STORE' })
      } catch { failed++ }
      done++
      setZipProgress(Math.round(((base + done) / Math.max(1, grand)) * 100))
    }

    const queue = [...list]
    async function worker() { while (queue.length > 0 && !abortRef.current) { const p = queue.shift()!; await fetchOne(p) } }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker))
    if (abortRef.current) return failed

    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
    const url = URL.createObjectURL(zipBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // Longer than a single-ZIP would need: with multiple parts, the browser is still flushing an
    // earlier part to disk while the next builds — revoking too soon would truncate it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return failed
  }

  async function downloadZip() {
    setZipping(true)
    setZipProgress(0)
    setZipStatus('')
    abortRef.current = false
    try {
      // Whole album (not just the loaded window). Falls back to the loaded set if the listing fails.
      let all = await fetchAllRecords()
      if (all.length === 0 && !abortRef.current) all = photos
      // Stream videos have no R2 file — only images (storage_backend !== 'stream') are downloadable.
      const downloadable = all.filter((p) => p.storage_backend !== 'stream')
      if (downloadable.length === 0) {
        reportClientError({ level: 'warn', source: 'download:empty', message: 'Download requested but nothing was downloadable', albumId: album.id })
        showAppToast('No downloadable photos in this album.', 'error')
        return
      }

      const title = safeName(album.title ?? '')

      if (downloadable.length <= BATCH_SIZE) {
        const failed = await zipAndSave(downloadable, `${title}.zip`, 0, downloadable.length)
        if (failed > 0 && !abortRef.current) {
          // Downloads were entirely silent: a guest could lose part of an album and nobody would
          // ever know. Uploads have been reported since the beginning; the other half of the
          // product's job had no instrumentation at all, so "is anything broken?" could only ever
          // be answered about half the system.
          reportClientError({ level: 'error', source: 'download:zip', message: 'Some photos could not be added to the download', albumId: album.id, context: {
            failed, total: downloadable.length,
          } })
          showAppToast(`${downloadable.length - failed} of ${downloadable.length} photos added (${failed} failed).`, 'error')
        }
        return
      }

      // Big album → multiple ZIP files, one batch at a time (bounded memory).
      const parts: Photo[][] = []
      for (let i = 0; i < downloadable.length; i += BATCH_SIZE) parts.push(downloadable.slice(i, i + BATCH_SIZE))
      let base = 0
      let failedTotal = 0
      for (let i = 0; i < parts.length; i++) {
        if (abortRef.current) break
        setZipStatus(`Part ${i + 1} of ${parts.length}`)
        failedTotal += await zipAndSave(parts[i], `${title} — part ${i + 1} of ${parts.length}.zip`, base, downloadable.length)
        base += parts[i].length
      }
      if (!abortRef.current) {
        if (failedTotal > 0) {
          reportClientError({ level: 'error', source: 'download:zip', message: 'Some photos could not be added to the download', albumId: album.id, context: {
            failed: failedTotal, total: downloadable.length, parts: parts.length,
          } })
        }
        showAppToast(
          failedTotal > 0
            ? `Downloaded ${downloadable.length - failedTotal} of ${downloadable.length} across ${parts.length} files (${failedTotal} failed).`
            : `Downloaded all ${downloadable.length} photos in ${parts.length} files.`,
          failedTotal > 0 ? 'error' : 'success',
        )
      }
    } finally {
      setZipping(false)
      setZipProgress(0)
      setZipStatus('')
    }
  }

  function cancelZip() { abortRef.current = true }

  return { zipping, zipProgress, zipStatus, downloadZip, cancelZip }
}
