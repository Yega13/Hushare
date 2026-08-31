'use client'

import { useState, useRef } from 'react'
import { reportClientError } from '@/lib/report-error'
import { showAppToast } from '@/components/AppToast'
import type { Album, Photo } from '@/types'
import { batchByBytes, ZIP_BUDGET_MOBILE, ZIP_BUDGET_DESKTOP } from '@/lib/zip-batching'
import {
  DOWNLOAD_CONCURRENCY_MOBILE,
  DOWNLOAD_CONCURRENCY_DESKTOP,
  DOWNLOAD_ATTEMPTS,
} from '@/lib/constants'

// How many photos are fetched at once. The reasoning lives in constants.ts; the short version is
// that the old single value of 16 was chosen for home broadband and put ~35MB of blobs in flight at
// once on a phone.
const concurrencyForDevice = () =>
  typeof navigator !== 'undefined' && /Mobi|Android/i.test(navigator.userAgent)
    ? DOWNLOAD_CONCURRENCY_MOBILE
    : DOWNLOAD_CONCURRENCY_DESKTOP

// A whole big album can be tens of GB — far too much for one browser tab — so it downloads in
// parts, never holding more than one part's worth in memory. How big a part may be is decided by
// BYTES in lib/zip-batching.ts; an album that fits in one part is still a single ZIP, as before.
//
// Read at press time rather than through a hook: this runs inside an event handler, and the only
// question is what the screen is now.
function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 640
}

// What one ZIP part produced: how many photos were lost, and why.
type ZipOutcome = { failed: number; reasons: Map<string, number> }

// Reasons as one short string, commonest first — "network x14, HTTP 429 x2".
//
// Kept STABLE for a given kind of failure, and free of per-photo detail, because /admin groups
// incidents by exact message and context: a reason that varied per file would split one recurring
// problem into a column of one-count rows, which is the same trap tooLargeMessage avoids.
function reasonSummary(reasons: Map<string, number>): string {
  return [...reasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, n]) => `${reason} x${n}`)
    .join(', ')
}

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
      // A thrown fetch here used to escape the whole download. Returning what we have lets the
      // caller fall back to the loaded window (`all.length === 0` → `photos`), so a blip costs a
      // smaller download rather than no download at all.
      let res: Response
      try {
        res = await fetch(`/api/album/photos?albumId=${encodeURIComponent(album.id)}&offset=${offset}&limit=2000`, { cache: 'no-store' })
      } catch {
        break
      }
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
  async function zipAndSave(list: Photo[], filename: string, base: number, grand: number): Promise<ZipOutcome> {
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    let done = 0
    let failed = 0
    // WHY each one failed, counted. The old code was `catch { failed++ }` — it knew photos had
    // been lost and nothing about the cause, so the panel could only say "16 of 16 failed" with no
    // way to tell a 404 from a rate limit from a dropped connection.
    const reasons = new Map<string, number>()

    async function fetchOne(photo: Photo) {
      if (abortRef.current) return
      // The FIRST reason is kept, not the last: by the final attempt a failure has often turned into
      // something vaguer, and the first is what actually went wrong.
      let firstReason = ''

      for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt++) {
        if (abortRef.current) return
        try {
          const res = await fetch(`/api/download/photo?id=${encodeURIComponent(photo.id)}&blob=1`, { credentials: 'include' })
          if (!res.ok) {
            const e = new Error(`HTTP ${res.status}`)
            // A 4xx is the server's settled answer: the photo is gone, the album is locked, or the
            // rate limit is in force for the next hour. Retrying cannot change any of those, and
            // against a rate limit it actively makes things worse by tripling the requests that
            // caused it. Only connections and 5xx get another go.
            if (res.status >= 400 && res.status < 500) {
              failed++
              const key = `HTTP ${res.status}`
              reasons.set(key, (reasons.get(key) ?? 0) + 1)
              done++
              setZipProgress(Math.round(((base + done) / Math.max(1, grand)) * 100))
              return
            }
            throw e
          }
          const blob = await res.blob()
          const ext = (photo.storage_path ?? '').split('.').pop()?.toLowerCase() || 'jpg'
        const b = (photo.caption?.trim() || photo.id).replace(/[/\\:*?"<>|]/g, '_').slice(0, 80)
          const proposed = `${b}.${ext}`
          const name = zip.files[proposed] ? `${b}-${photo.id.slice(0, 8)}.${ext}` : proposed
          zip.file(name, blob, { compression: 'STORE' })
          done++
          setZipProgress(Math.round(((base + done) / Math.max(1, grand)) * 100))
          return
        } catch (err) {
          // A thrown fetch is almost always the connection rather than the server, and that
          // distinction is worth naming in the report.
          const reason = err instanceof Error
            ? (err.name === 'TypeError' ? 'network' : err.message)
            : String(err)
          if (!firstReason) firstReason = reason.slice(0, 40)
          if (attempt < DOWNLOAD_ATTEMPTS - 1) {
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
          }
        }
      }

      failed++
      const key = firstReason || 'unknown'
      reasons.set(key, (reasons.get(key) ?? 0) + 1)
      done++
      setZipProgress(Math.round(((base + done) / Math.max(1, grand)) * 100))
    }

    const queue = [...list]
    async function worker() { while (queue.length > 0 && !abortRef.current) { const p = queue.shift()!; await fetchOne(p) } }
    await Promise.all(Array.from({ length: Math.min(concurrencyForDevice(), list.length) }, worker))
    if (abortRef.current) return { failed, reasons }

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
    return { failed, reasons }
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

      // BATCHED BY BYTES, NOT BY COUNT (lib/zip-batching.ts). The tab holds every photo of a part
      // in memory until it is written out, and photos are not a fixed size — 500 phone snaps is a
      // couple of hundred megabytes, 500 originals is over nine gigabytes and the tab is killed.
      // The budget is smaller on a phone, where this button is most often pressed.
      const budget = isNarrowViewport() ? ZIP_BUDGET_MOBILE : ZIP_BUDGET_DESKTOP
      const parts = batchByBytes(downloadable, budget)

      if (parts.length <= 1) {
        const { failed, reasons } = await zipAndSave(downloadable, `${title}.zip`, 0, downloadable.length)
        if (failed > 0 && !abortRef.current) {
          // Downloads were entirely silent: a guest could lose part of an album and nobody would
          // ever know. Uploads have been reported since the beginning; the other half of the
          // product's job had no instrumentation at all, so "is anything broken?" could only ever
          // be answered about half the system.
          reportClientError({ level: 'error', source: 'download:zip', message: 'Some photos could not be added to the download', albumId: album.id, context: {
            failed, total: downloadable.length, reasons: reasonSummary(reasons), concurrency: concurrencyForDevice(),
          } })
          showAppToast(`${downloadable.length - failed} of ${downloadable.length} photos added (${failed} failed).`, 'error')
        }
        return
      }

      // Big album → multiple ZIP files, one part at a time (bounded memory).
      let base = 0
      let failedTotal = 0
      const allReasons = new Map<string, number>()
      for (let i = 0; i < parts.length; i++) {
        if (abortRef.current) break
        setZipStatus(`Part ${i + 1} of ${parts.length}`)
        const part = await zipAndSave(parts[i], `${title} — part ${i + 1} of ${parts.length}.zip`, base, downloadable.length)
        failedTotal += part.failed
        for (const [k, n] of part.reasons) allReasons.set(k, (allReasons.get(k) ?? 0) + n)
        base += parts[i].length
      }
      if (!abortRef.current) {
        if (failedTotal > 0) {
          reportClientError({ level: 'error', source: 'download:zip', message: 'Some photos could not be added to the download', albumId: album.id, context: {
            failed: failedTotal, total: downloadable.length, parts: parts.length,
            reasons: reasonSummary(allReasons), concurrency: concurrencyForDevice(),
          } })
        }
        showAppToast(
          failedTotal > 0
            ? `Downloaded ${downloadable.length - failedTotal} of ${downloadable.length} across ${parts.length} files (${failedTotal} failed).`
            : `Downloaded all ${downloadable.length} photos in ${parts.length} files.`,
          failedTotal > 0 ? 'error' : 'success',
        )
      }
    } catch (err) {
      // try/finally with NO catch was the bug. A dropped connection inside fetchAllRecords threw
      // "TypeError: Failed to fetch", nothing caught it, and because the button calls this without
      // awaiting, it surfaced as an unhandled rejection — a red error in the panel, and for the
      // guest a spinner that simply stopped with no explanation and nothing to press.
      //
      // Two guests hit this today on an Android phone mid-event. The download is the half of the
      // product with the weakest instrumentation, which is exactly why it needs the loudest.
      if (abortRef.current) return
      const reason = err instanceof Error
        ? (err.name === 'TypeError' ? 'network' : err.message.slice(0, 120))
        : String(err).slice(0, 120)
      reportClientError({
        level: 'error', source: 'download:zip', albumId: album.id,
        message: 'Download failed before it could finish',
        context: { reason, photos: photos.length },
      })
      showAppToast('Download failed — check your connection and try again.', 'error')
    } finally {
      setZipping(false)
      setZipProgress(0)
      setZipStatus('')
    }
  }

  function cancelZip() { abortRef.current = true }

  return { zipping, zipProgress, zipStatus, downloadZip, cancelZip }
}
