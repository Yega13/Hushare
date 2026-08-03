'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import QRCode from 'qrcode'
import { createClient } from '@/lib/supabase/client'
import type { Photo } from '@/types'

const MAX_TILES = 60 // a wall doesn't need the whole album — show the most recent

function displayUrl(p: Photo): string | null {
  if (p.media_type === 'video') return p.poster_url ?? p.stream_thumbnail_url ?? null
  return p.thumb_url ?? p.url ?? null
}

function sortNewestFirst(list: Photo[]): Photo[] {
  return [...list].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
}

export default function PhotoWall({
  albumId,
  title,
  albumUrl,
  initialPhotos,
  initialTotal,
}: {
  albumId: string
  title: string
  albumUrl: string
  initialPhotos: Photo[]
  initialTotal: number
}) {
  const [supabase] = useState(() => createClient())
  const [photos, setPhotos] = useState<Photo[]>(() => sortNewestFirst(initialPhotos))
  const [total, setTotal] = useState<number>(initialTotal)
  const [qr, setQr] = useState<string>('')
  const [newIds, setNewIds] = useState<Set<string>>(new Set())

  // Every id we've ever shown — so a refetch can tell which photos are genuinely NEW (to animate).
  const seenRef = useRef<Set<string>>(new Set(initialPhotos.map((p) => p.id)))
  const tiles = useMemo(() => photos.filter(displayUrl).slice(0, MAX_TILES), [photos])

  // QR of the album link — guests scan it to add their own photos, which then appear live here.
  useEffect(() => {
    QRCode.toDataURL(albumUrl, { margin: 1, width: 320, color: { dark: '#160A12', light: '#FFFFFF' } })
      .then(setQr)
      .catch(() => setQr(''))
  }, [albumUrl])

  const refetch = useCallback(async () => {
    try {
      // Only the newest window — bounded refetch instead of pulling the whole album every ping.
      const res = await fetch(`/api/album/photos?albumId=${encodeURIComponent(albumId)}&recent=80`, { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { photos?: Photo[]; total?: number }
      const fresh = sortNewestFirst(data.photos ?? [])

      const arrived = fresh.filter((p) => !seenRef.current.has(p.id)).map((p) => p.id)
      for (const id of fresh.map((p) => p.id)) seenRef.current.add(id)

      setPhotos(fresh)
      if (typeof data.total === 'number') setTotal(data.total)
      if (arrived.length) {
        setNewIds((prev) => new Set([...prev, ...arrived]))
        // Clear the "new" flag after the pop-in animation so it can fire again next time.
        setTimeout(() => {
          setNewIds((prev) => {
            const next = new Set(prev)
            for (const id of arrived) next.delete(id)
            return next
          })
        }, 2600)
      }
    } catch {
      /* transient — the next ping refetches */
    }
  }, [albumId])

  // Realtime: same `album:<id>` broadcast channel the album page uses. Debounce a burst of uploads
  // into a single refetch, and resubscribe with backoff if the connection drops.
  useEffect(() => {
    let active = true
    let retry = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let debounce: ReturnType<typeof setTimeout> | null = null
    let channel: RealtimeChannel | null = null

    function connect() {
      if (!active) return
      if (channel) supabase.removeChannel(channel)
      channel = supabase
        .channel(`album:${albumId}`)
        .on('broadcast', { event: 'changed' }, () => {
          if (debounce) clearTimeout(debounce)
          debounce = setTimeout(() => { void refetch() }, 500)
        })
        .subscribe((status) => {
          if (!active) return
          if (status === 'SUBSCRIBED') {
            retry = 0
            void refetch()
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            retryTimer = setTimeout(connect, Math.min(2000 * 2 ** retry++, 30_000))
          }
        })
    }
    connect()

    return () => {
      active = false
      if (retryTimer) clearTimeout(retryTimer)
      if (debounce) clearTimeout(debounce)
      if (channel) supabase.removeChannel(channel)
    }
  }, [albumId, supabase, refetch])

  return (
    <main className="hush-wall">
      <style>{`
        .hush-wall { min-height: 100dvh; display: grid; grid-template-columns: 1fr; background: #160A12; color: #F3E0BC; overflow: hidden; }
        /* On a real screen/projector the wall is exactly one viewport tall: the grid clips to what
           fits (newest first) and the side panel — with the join QR at its foot — stays visible. */
        @media (min-width: 900px) { .hush-wall { grid-template-columns: 1fr 300px; height: 100dvh; } }
        .hush-wall-grid { padding: 14px; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); grid-auto-rows: 150px; gap: 10px; align-content: start; overflow: hidden; }
        @media (min-width: 1400px) { .hush-wall-grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); grid-auto-rows: 200px; } }
        .hush-wall-tile { border-radius: 14px; overflow: hidden; background: #2A121F; box-shadow: 0 8px 24px rgba(0,0,0,0.35); }
        .hush-wall-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .hush-wall-new { animation: hushWallPop 1.1s cubic-bezier(0.16,1,0.3,1); box-shadow: 0 0 0 3px #F3E0BC, 0 12px 30px rgba(0,0,0,0.5); }
        @keyframes hushWallPop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.04); opacity: 1; } 100% { transform: scale(1); } }
        .hush-wall-side { padding: 28px 24px; display: flex; flex-direction: column; justify-content: space-between; background: linear-gradient(160deg, #2A121F, #160A12); border-left: 1px solid rgba(243,224,188,0.14); }
        .hush-wall-empty { grid-column: 1 / -1; display: grid; place-items: center; height: 60vh; opacity: 0.65; text-align: center; }
      `}</style>

      <section className="hush-wall-grid">
        {tiles.length === 0 ? (
          <div className="hush-wall-empty">
            <div>
              <p style={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--font-serif)' }}>Waiting for the first photo…</p>
              <p style={{ fontSize: 15, marginTop: 8 }}>Scan the code to add yours →</p>
            </div>
          </div>
        ) : (
          tiles.map((p) => (
            <div key={p.id} className={`hush-wall-tile${newIds.has(p.id) ? ' hush-wall-new' : ''}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={displayUrl(p)!} alt="" loading="eager" />
            </div>
          ))
        )}
      </section>

      <aside className="hush-wall-side">
        <div>
          <p style={{ fontSize: 12, letterSpacing: '0.22em', textTransform: 'uppercase', opacity: 0.7 }}>Live wall</p>
          <h1 style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, marginTop: 8, fontFamily: 'var(--font-serif)', color: '#FDFAF5' }}>{title}</h1>
          <p style={{ fontSize: 15, marginTop: 12, opacity: 0.85 }}>{total} photo{total === 1 ? '' : 's'} and counting</p>
        </div>

        <div style={{ textAlign: 'center' }}>
          {qr && (
            <img src={qr} alt="Scan to add your photos" width={220} height={220} style={{ width: 220, height: 220, borderRadius: 16, background: '#FFF', padding: 10 }} />
          )}
          <p style={{ fontSize: 16, fontWeight: 600, marginTop: 14, color: '#FDFAF5' }}>Scan to add your photos</p>
          <p style={{ fontSize: 12, opacity: 0.6, marginTop: 4, wordBreak: 'break-all' }}>{albumUrl.replace(/^https?:\/\//, '')}</p>
        </div>
      </aside>
    </main>
  )
}
