'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useParams, notFound } from 'next/navigation'
import dynamic from 'next/dynamic'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import type { Album, Photo, Tier } from '@/types'
import AlbumSkeleton from '@/components/AlbumSkeleton'
import PasswordGate from '@/components/PasswordGate'
import RevealCountdown from '@/components/RevealCountdown'
import PhotoGrid from '@/components/PhotoGrid'
import AlbumHeader from '@/components/AlbumHeader'
import GuestActionsBar from '@/components/GuestActionsBar'
import { resolveAlbumBackgroundImage } from '@/lib/album-backgrounds'

// Code-split out of the shared album bundle: OwnerToolbar (+ tus/JSZip-adjacent upload code) and
// FaceFinder are only ever needed by the owner or by guests who opt in, never by an ordinary
// guest viewing photos. UploadZone pulls in tus-js-client, which guests on view-only albums never
// need either. This keeps the JS a first-time guest downloads to just what renders.
const UploadZone = dynamic(() => import('@/components/UploadZone'))
const OwnerToolbar = dynamic(() => import('@/components/OwnerToolbar'))
const FaceFinder = dynamic(() => import('@/components/FaceFinder'))

const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space').replace(/\/+$/, '')

// ─── Realtime row sanitization ────────────────────────────────────────────────
// Realtime delivers the raw Postgres row (all columns). We enumerate explicitly
// to avoid leaking future columns to the client and to block javascript:/data: URLs.

function _safeStr(v: unknown): string | null { return typeof v === 'string' ? v : null }
function _safeInt(v: unknown): number | null { return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null }
function _safeHttpsUrl(v: unknown): string | null {
  const s = _safeStr(v); return s && s.startsWith('https://') ? s : null
}
const VALID_FILTERS = new Set(['none', 'warm', 'cool', 'mono', 'vintage', 'soft'] as const)
type MediaDisplayFilter = 'none' | 'warm' | 'cool' | 'mono' | 'vintage' | 'soft'
function _safeFilter(v: unknown): MediaDisplayFilter | null {
  const s = _safeStr(v)
  return s && VALID_FILTERS.has(s as MediaDisplayFilter) ? (s as MediaDisplayFilter) : null
}

function sanitizeRealtimePhoto(row: Record<string, unknown>, expectedAlbumId: string): Photo | null {
  if (_safeStr(row.album_id) !== expectedAlbumId) return null
  const id = _safeStr(row.id)
  if (!id) return null
  return {
    id,
    album_id: expectedAlbumId,
    media_type: row.media_type === 'video' ? 'video' : 'image',
    storage_backend: row.storage_backend === 'stream' ? 'stream' : 'r2',
    created_at: _safeStr(row.created_at) ?? '',
    storage_path: _safeStr(row.storage_path),
    url: _safeHttpsUrl(row.url),
    thumb_url: _safeHttpsUrl(row.thumb_url),
    stream_uid: _safeStr(row.stream_uid),
    stream_iframe_url: _safeHttpsUrl(row.stream_iframe_url),
    stream_thumbnail_url: _safeHttpsUrl(row.stream_thumbnail_url),
    poster_url: _safeHttpsUrl(row.poster_url),
    caption: _safeStr(row.caption),
    author_name: _safeStr(row.author_name),
    sort_order: _safeInt(row.sort_order),
    display_radius: _safeInt(row.display_radius),
    display_filter: _safeFilter(row.display_filter),
    duration_seconds: _safeInt(row.duration_seconds),
    width: _safeInt(row.width),
    height: _safeInt(row.height),
    face_ids: Array.isArray(row.face_ids)
      ? (row.face_ids as unknown[]).filter((x): x is string => typeof x === 'string')
      : null,
  }
}

// ─── Background helpers ────────────────────────────────────────────────────────

function isImageBackground(theme: string | null): theme is string {
  return !!theme && (theme.startsWith('image:') || theme.startsWith('stock:'))
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/

function getBackgroundImageUrl(theme: string): string {
  // stock: → resolve to Pexels CDN URL via the shared helper
  if (theme.startsWith('stock:')) return resolveAlbumBackgroundImage(theme)
  // image: → custom uploaded image stored as "image:https://..."
  if (theme.startsWith('image:')) {
    const url = theme.slice('image:'.length)
    return url.startsWith('https://') ? url : ''  // reject non-https from DB
  }
  return ''
}

function getBackgroundColorStyle(theme: string | null): CSSProperties {
  if (!theme) return { backgroundColor: '#FDFAF5' }
  if (isImageBackground(theme)) return {}  // transparent — fixed image layer shows through
  if (HEX_COLOR_RE.test(theme)) return { background: theme }
  return { backgroundColor: '#FDFAF5' }  // unrecognised value → safe fallback
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AlbumPageClient() {
  const { slug } = useParams<{ slug: string }>()
  const [supabase] = useState(() => createClient())

  // Album data
  const [album, setAlbum] = useState<Album | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])

  // Loading gates
  const [loading, setLoading] = useState(true)
  const [isNotFound, setIsNotFound] = useState(false)
  const [networkError, setNetworkError] = useState(false)
  const [passwordGate, setPasswordGate] = useState<{
    slug: string; title: string
  } | null>(null)
  const [revealGate, setRevealGate] = useState<{
    revealAt: string; slug: string; title: string
  } | null>(null)

  // Owner
  const [ownerTokenReady, setOwnerTokenReady] = useState(false)
  const [ownerToken, setOwnerToken] = useState<string | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [showFaceFinder, setShowFaceFinder] = useState(false)

  // Display state — consumed by Phase 7–9 components
  const [userTier, setUserTier] = useState<Tier>('free')
  const [mediaRadiusMax, setMediaRadiusMax] = useState(144)
  const [forceGlobalRadius, setForceGlobalRadius] = useState(false)
  const [slideshowRequestId, setSlideshowRequestId] = useState(0)
  const [arrangeMode, setArrangeMode] = useState(false)

  // Refs
  // ownerTokenFromUrlRef: did THIS page load come with an owner token in the URL?
  // Guaranteed set before isOwner can become true — see Effect 1 sequencing.
  // Prevents a stale HttpOnly cookie from granting owner view on a guest URL.
  const ownerTokenFromUrlRef = useRef(false)
  const settingsChannelRef = useRef<RealtimeChannel | null>(null)
  const prevGuestDownloadsRef = useRef<boolean | null>(null)
  const uploadRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // fetchGenRef: monotonic generation counter incremented on every slug change.
  // fetchAlbum captures myGen at call time; isCancelled() returns true if the
  // generation advanced past myGen (i.e. a newer slug navigation superseded this call).
  // This prevents a stale in-flight fetchAlbum from overwriting the new album's state.
  const fetchGenRef = useRef(0)

  // Computed at render — ref is always set before isOwner can become true.
  // Owner view requires the owner cookie (set via the #owner= management link or album
  // creation). The public URL is a guest experience for everyone, including the creator.
  const effectiveIsOwner = isOwner && ownerTokenFromUrlRef.current

  // Tombstone recently-deleted photo IDs so a realtime reconnect/refetch (common on mobile)
  // cannot reinstate a photo the user just deleted. Auto-expires after 60s.
  const deletedIdsRef = useRef<Map<string, number>>(new Map())
  const isRecentlyDeleted = useCallback((id: string) => {
    const t = deletedIdsRef.current.get(id)
    if (t == null) return false
    if (Date.now() - t > 60_000) { deletedIdsRef.current.delete(id); return false }
    return true
  }, [])

  // ─── fetchPhotos ────────────────────────────────────────────────────────────
  // Returns the photos array instead of calling setPhotos directly.
  // This lets callers gate the state update with their own cancellation guard
  // (generation counter for fetchAlbum; active flag for the realtime channel).

  const fetchPhotos = useCallback(async (albumId: string): Promise<Photo[]> => {
    // Fetch via the authenticated API route (admin client, server-side access check)
    // rather than the anon client. The anon client can only read photos of OPEN albums
    // (RLS), so password-protected / reveal-gated albums — and the owner's own view of
    // them — came back empty. The route returns photos when the caller is the owner, an
    // unlocked guest, or the album is open.
    try {
      const res = await fetch(`/api/album/photos?albumId=${encodeURIComponent(albumId)}`, { cache: 'no-store' })
      if (!res.ok) {
        console.error('[AlbumPageClient] fetchPhotos failed', res.status)
        return []
      }
      const json = await res.json() as { photos?: Photo[] }
      // Drop any photo the user just deleted — guards against a stale/racing refetch
      // reinstating it before the delete has fully propagated.
      return (json.photos ?? []).filter(p => !isRecentlyDeleted(p.id))
    } catch (e) {
      console.error('[AlbumPageClient] fetchPhotos error', e)
      return []
    }
  }, [isRecentlyDeleted])

  // ─── fetchAlbum ─────────────────────────────────────────────────────────────

  const fetchAlbum = useCallback(async (): Promise<void> => {
    if (!ownerTokenReady) return

    // Capture generation at call time. isCancelled() returns true if a slug
    // change advanced fetchGenRef.current past this value while we were awaiting.
    const myGen = fetchGenRef.current
    const isCancelled = () => fetchGenRef.current !== myGen

    setPasswordGate(null)
    setRevealGate(null)

    // checkOwnerAuth is defined inside fetchAlbum so it closes over isCancelled.
    // This prevents it from updating state after a slug navigation supersedes this call.
    async function checkOwnerAuth(albumSlug: string): Promise<void> {
      try {
        const res = await fetch('/api/album/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: albumSlug }),
        })
        if (isCancelled() || !res.ok) return
        const result = await res.json() as { isOwner?: boolean }
        if (isCancelled()) return
        // Do NOT set ownerTokenFromUrlRef here. Owner VIEW requires the #owner= management link
        // in the current URL (the ref is set only by Effect 1 when that hash is present). A valid
        // owner cookie alone authorizes owner mutations but does not flip the public album URL
        // into owner view — the public URL is a guest experience for everyone, including the
        // creator. The creator reaches owner view via their management link (dashboard / post-create).
        setIsOwner(!!result.isOwner)
        if (result.isOwner) {
          // Non-blocking — page renders before tier resolves
          fetch('/api/me/tier', { cache: 'no-store' })
            .then(r => r.ok ? r.json() : Promise.reject())
            .then((j: { tier?: Tier }) => { if (!isCancelled() && j.tier) setUserTier(j.tier) })
            .catch(() => {})
        }
      } catch {
        // Auth failure = guest view, no action needed
      }
    }

    try {
      // owner=1 only when this load is via the #owner= management link — so a leftover owner
      // cookie on the plain guest URL doesn't bypass the reveal/password gates.
      const res = await fetch(
        `/api/album/resolve?slug=${encodeURIComponent(slug)}&owner=${ownerTokenFromUrlRef.current ? '1' : '0'}`,
        { cache: 'no-store' },
      )
      if (isCancelled()) return

      const json = await res.json().catch(() => ({})) as Record<string, unknown>
      if (isCancelled()) return

      // Real not-found (album deleted or never existed) — checked BEFORE body flags so that
      // a security-minded API returning 404+password_required cannot create an infinite gate
      // loop where the user is prompted for a password that can never succeed
      if (res.status === 404) {
        setIsNotFound(true)
        return
      }

      // Transient server error
      if (!res.ok) {
        setNetworkError(true)
        return
      }

      // Password gate — 200 with password_required flag
      if (json.password_required === true) {
        if (typeof json.slug !== 'string' || typeof json.title !== 'string') {
          setNetworkError(true)
          return
        }
        setPasswordGate({ slug: json.slug, title: json.title })
        return
      }

      // Reveal gate — 200 with locked flag + reveal_at
      if (json.locked === true && json.reveal_at) {
        if (typeof json.slug !== 'string' || typeof json.title !== 'string' || typeof json.reveal_at !== 'string') {
          setNetworkError(true)
          return
        }
        setRevealGate({ revealAt: json.reveal_at, slug: json.slug, title: json.title })
        return
      }

      // Malformed full-album response (gate responses handled above legitimately have no id)
      if (typeof json.id !== 'string') {
        setNetworkError(true)
        return
      }

      // Full album — resolve strips owner_token, password_hash, user_id, retired_at
      const data = json as unknown as Album

      // Auth check and photo fetch in parallel. Both results are guarded below by
      // isCancelled() so a superseded call never commits state to the new album.
      // setAlbum is intentionally AFTER Promise.all so a slug change that completes
      // while we await never flashes the old album title before the isCancelled guard fires.
      const [, photoData] = await Promise.all([
        checkOwnerAuth(data.slug),
        fetchPhotos(data.id),
      ])
      if (isCancelled()) return
      setAlbum(data)
      setPhotos(photoData)
    } catch {
      // fetch() threw — network down, DNS failure, etc.
      if (!isCancelled()) setNetworkError(true)
    } finally {
      if (!isCancelled()) setLoading(false)
    }
  }, [slug, ownerTokenReady, fetchPhotos])

  // ─── Effect 1: Owner token resolution ───────────────────────────────────────
  // Deps: [slug] — runs whenever the route slug changes
  useEffect(() => {
    // Advance the fetch generation FIRST. Any in-flight fetchAlbum from the previous
    // slug will see fetchGenRef.current !== myGen and skip all remaining setState calls.
    fetchGenRef.current++

    // Cancel any pending upload-triggered refetch from the previous album.
    // Without this, a 3s timer from album A would call fetchPhotos(oldAlbumId)
    // while album B is loaded, overwriting album B's photos with album A's.
    if (uploadRefetchTimerRef.current) {
      clearTimeout(uploadRefetchTimerRef.current)
      uploadRefetchTimerRef.current = null
    }

    // Synchronously reset ALL state for the new slug before any async work.
    // App Router re-renders the same component instance on slug changes — it
    // does NOT unmount/remount — so stale state from the previous album must
    // be explicitly cleared here.
    setLoading(true)
    setIsNotFound(false)
    setNetworkError(false)
    setAlbum(null)
    setPhotos([])
    setPasswordGate(null)
    setRevealGate(null)
    setIsOwner(false)
    setOwnerToken(null)
    setOwnerTokenReady(false)
    ownerTokenFromUrlRef.current = false
    prevGuestDownloadsRef.current = null
    // Reset display state that persists across navigations
    setArrangeMode(false)
    setUserTier('free')
    setForceGlobalRadius(false)
    setSlideshowRequestId(0)
    setMediaRadiusMax(144)

    let cancelled = false

    const rawHash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash
    const token = new URLSearchParams(rawHash).get('owner')

    if (!token) {
      setOwnerTokenReady(true)
      return () => { cancelled = true }
    }

    // Mark this load as owner-initiated BEFORE ownerTokenReady is set.
    // This guarantees the ref is true whenever fetchAlbum and checkOwnerAuth run.
    ownerTokenFromUrlRef.current = true
    setOwnerToken(token)

    // Intentionally KEEP #owner=<token> in the URL. Owner view now requires the token in the
    // URL (a bare cookie no longer flips the public link into owner view), so stripping it
    // would drop the owner back to guest view on refresh. The token lives in the URL *fragment*,
    // which browsers never send in the Referer header or to the server — so this is the distinct,
    // persistent management link the owner keeps private (guest link = same path with no #owner=).

    void (async () => {
      // 10s timeout: if owner-login hangs, we fall through to guest view rather
      // than blocking the page indefinitely.
      const ac = new AbortController()
      const timeoutId = setTimeout(() => ac.abort(), 10_000)
      try {
        await fetch('/api/album/owner-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, owner_token: token }),
          signal: ac.signal,
        })
        // On success: server sets hushare_owner_<albumId> HttpOnly cookie (7 days).
        // On failure (including AbortError): swallowed. /api/album/auth returns { isOwner: false }.
      } catch {
        // Network error or timeout — proceed as guest
      } finally {
        clearTimeout(timeoutId)
        if (!cancelled) setOwnerTokenReady(true)
      }
    })()

    return () => { cancelled = true }
  }, [slug])

  // ─── Effect 2: Trigger fetchAlbum ───────────────────────────────────────────
  // fetchAlbum guards on ownerTokenReady internally, so this fires twice when
  // ownerTokenReady goes false → true, but only the second call does real work.
  useEffect(() => {
    void fetchAlbum()
  }, [fetchAlbum])

  // ─── Effect 3: Realtime photos channel ──────────────────────────────────────
  useEffect(() => {
    if (!album?.id) return
    const albumId = album.id
    let active = true
    let retryCount = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let currentChannel: RealtimeChannel | null = null

    function connect() {
      if (!active) return
      if (currentChannel) supabase.removeChannel(currentChannel)

      const ch = supabase
        .channel(`album-photos-${albumId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'photos',
          filter: `album_id=eq.${albumId}`,
        }, ({ new: incoming }) => {
          if (!active) return
          const photo = sanitizeRealtimePhoto(incoming as Record<string, unknown>, albumId)
          if (!photo || !photo.id) return
          if (isRecentlyDeleted(photo.id)) return  // don't re-add a just-deleted photo
          setPhotos(prev =>
            prev.some(p => p.id === photo.id)
              ? prev
              : [...prev, photo],
          )
        })
        .on('postgres_changes', {
          event: 'DELETE',
          schema: 'public',
          table: 'photos',
          filter: `album_id=eq.${albumId}`,
        }, ({ old: deleted }) => {
          if (!active) return
          const deletedId = (deleted as Record<string, unknown>)?.id
          if (typeof deletedId !== 'string') return
          setPhotos(prev => prev.filter(p => p.id !== deletedId))
        })
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'photos',
          filter: `album_id=eq.${albumId}`,
        }, ({ new: updated }) => {
          if (!active) return
          const photo = sanitizeRealtimePhoto(updated as Record<string, unknown>, albumId)
          if (!photo || !photo.id) return
          setPhotos(prev => prev.map(p => p.id === photo.id ? photo : p))
        })
        .subscribe(status => {
          if (!active) return
          if (status === 'SUBSCRIBED') {
            // Always refetch on subscribe: closes the race window between the initial
            // fetchPhotos call and when the channel becomes SUBSCRIBED. Photos uploaded
            // in that gap would be missed if we only refetch on reconnect.
            // The `active` guard on the .then() prevents updating state after cleanup.
            void fetchPhotos(albumId).then(data => { if (active) setPhotos(data) })
            retryCount = 0
          } else if (
            status === 'CHANNEL_ERROR' ||
            status === 'TIMED_OUT' ||
            status === 'CLOSED'
          ) {
            // Exponential backoff: 2s, 4s, 8s, 16s, capped at 30s
            const delay = Math.min(2000 * Math.pow(2, retryCount), 30_000)
            retryCount++
            retryTimer = setTimeout(connect, delay)
          }
        })

      currentChannel = ch
    }

    connect()

    return () => {
      active = false
      if (retryTimer) clearTimeout(retryTimer)
      if (currentChannel) supabase.removeChannel(currentChannel)
    }
  }, [album?.id, supabase, fetchPhotos])

  // ─── Effect 4: Realtime settings broadcast channel ──────────────────────────
  useEffect(() => {
    if (!album?.id) return
    const albumId = album.id
    // Use slug (not UUID) for the resolve endpoint — the route resolves by slug, not by id.
    const albumSlug = album.custom_slug ?? album.slug

    const ch = supabase
      .channel(`album-settings-${albumId}`)
      .on('broadcast', { event: 'album_settings' }, () => {
        // Treat the broadcast as a trigger to re-fetch from the server rather than
        // trusting the payload directly. Supabase Realtime broadcast channels are
        // unauthenticated — any tab that knows the channel name can publish to it,
        // so accepting payload values directly creates a spoofing vector (UI-only
        // impact, but misleads users about the album's current state).
        // Pass owner mode so a gated album (reveal/password) the owner is viewing comes back
        // as the full album, not the guest gate response.
        void fetch(`/api/album/resolve?slug=${encodeURIComponent(albumSlug)}&owner=${ownerTokenFromUrlRef.current ? '1' : '0'}`, { cache: 'no-store' })
          .then(r => r.ok ? r.json() : null)
          .then((data: Album | null) => {
            if (data && typeof data.id === 'string') {
              setAlbum(prev => prev ? { ...prev, ...data } : prev)
            }
          })
          .catch(() => {})
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') settingsChannelRef.current = ch
        else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') settingsChannelRef.current = null
      })

    return () => {
      settingsChannelRef.current = null
      supabase.removeChannel(ch)
    }
  }, [album?.id, supabase])

  // ─── Effect 5: Broadcast guest downloads toggle (owner only) ────────────────
  // When the owner changes allow_guest_downloads, broadcasts to all guest tabs.
  // The strict equality guard prevents a re-broadcast loop: Effect 4 may update
  // album state from the broadcast, but the value matches prevRef so Effect 5 no-ops.
  useEffect(() => {
    if (!album || !effectiveIsOwner) return
    const current = album.allow_guest_downloads

    if (prevGuestDownloadsRef.current === null) {
      prevGuestDownloadsRef.current = current
      return
    }

    if (prevGuestDownloadsRef.current === current) return
    prevGuestDownloadsRef.current = current

    settingsChannelRef.current?.send({
      type: 'broadcast',
      event: 'album_settings',
      payload: { allow_guest_downloads: current },
    })
  }, [album?.allow_guest_downloads, album?.id, effectiveIsOwner])

  // ─── Effect 6: Cleanup upload timer on unmount ──────────────────────────────
  useEffect(() => {
    return () => {
      if (uploadRefetchTimerRef.current) clearTimeout(uploadRefetchTimerRef.current)
    }
  }, [])

  // ─── Callbacks ──────────────────────────────────────────────────────────────

  const handlePhotosUploaded = useCallback(() => {
    if (!album?.id) return
    const albumId = album.id
    if (uploadRefetchTimerRef.current) clearTimeout(uploadRefetchTimerRef.current)
    // 3s delay: gives Realtime a chance to deliver INSERT events first.
    // If Realtime delivers them, this refetch is a no-op (overwrites with same data).
    uploadRefetchTimerRef.current = setTimeout(() => {
      uploadRefetchTimerRef.current = null
      // Merge instead of replace: Realtime may have delivered photos after the query was
      // issued but before it resolves — a full replace would briefly remove them
      void fetchPhotos(albumId).then(data => {
        setPhotos(prev => {
          const inDB = new Map(data.map(p => [p.id, p]))
          const extras = prev.filter(p => !inDB.has(p.id))
          return extras.length > 0 ? [...data, ...extras] : data
        })
      })
    }, 3000)
  }, [album?.id, fetchPhotos])

  const handlePhotoDeleted = useCallback((photoId: string) => {
    deletedIdsRef.current.set(photoId, Date.now())  // tombstone against racing refetch
    setPhotos(prev => prev.filter(p => p.id !== photoId))
  }, [])

  const handleAlbumUpdated = useCallback((
    patch: Partial<Album>,
    options?: {
      forceGlobalRadius?: boolean
      resetRadiusOverrides?: boolean
      resetFilterOverrides?: boolean
    },
  ) => {
    setAlbum(prev => prev ? { ...prev, ...patch } : prev)
    if ('media_radius' in patch) {
      setForceGlobalRadius(!!options?.forceGlobalRadius)
    }
    if (options?.resetRadiusOverrides) {
      setPhotos(prev => prev.map(p => ({ ...p, display_radius: null })))
    }
    if (options?.resetFilterOverrides) {
      setPhotos(prev => prev.map(p => ({ ...p, display_filter: null })))
    }
  }, [])

  const handlePhotoUpdated = useCallback((photoId: string, patch: Partial<Photo>) => {
    if (patch.display_radius !== undefined) setForceGlobalRadius(false)
    setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, ...patch } : p))
  }, [])

  const handlePhotosReordered = useCallback((nextPhotos: Photo[]) => {
    setPhotos(nextPhotos)
  }, [])

  // ─── Rules of Hooks boundary ─────────────────────────────────────────────────
  // notFound() MUST be called after all hooks. It throws a Next.js signal that
  // skips the remaining render. Calling it before useCallback/useEffect would
  // violate Rules of Hooks by conditionally skipping hooks on subsequent renders.
  if (isNotFound) notFound()

  // ─── Render gates ────────────────────────────────────────────────────────────

  if (loading) return <AlbumSkeleton />

  if (networkError) {
    return (
      <div
        className="min-h-dvh flex flex-col items-center justify-center gap-5 px-6 text-center"
        style={{ background: '#FDFAF5' }}
      >
        <p style={{ color: '#630826', fontSize: '1rem', fontWeight: 500 }}>
          Something went wrong. Please check your connection and try again.
        </p>
        <button
          type="button"
          onClick={() => {
            if (uploadRefetchTimerRef.current) {
              clearTimeout(uploadRefetchTimerRef.current)
              uploadRefetchTimerRef.current = null
            }
            fetchGenRef.current++  // cancel any in-flight fetchAlbum before retrying
            setNetworkError(false)
            setLoading(true)
            // Ensure ownerTokenReady is true — it may have stayed false if the network
            // failed during the owner-login call (before setOwnerTokenReady fired).
            setOwnerTokenReady(true)
            // Do NOT call fetchAlbum() directly — setOwnerTokenReady triggers a re-render
            // which rebuilds the fetchAlbum closure, and the fetchAlbum effect fires it.
          }}
          className="rounded-xl px-6 py-2.5 font-semibold transition hover:opacity-85"
          style={{ background: '#630826', color: '#FDFAF5' }}
        >
          Retry
        </button>
      </div>
    )
  }

  if (passwordGate) {
    return (
      <PasswordGate
        slug={passwordGate.slug}
        title={passwordGate.title}
        onUnlocked={() => {
          fetchGenRef.current++
          setPasswordGate(null)
          setLoading(true)
          void fetchAlbum()
        }}
      />
    )
  }

  if (revealGate) {
    return (
      <RevealCountdown
        revealAt={revealGate.revealAt}
        title={revealGate.title}
        onUnlocked={() => {
          fetchGenRef.current++
          setRevealGate(null)
          setLoading(true)
          void fetchAlbum()
        }}
      />
    )
  }

  if (!album) return <AlbumSkeleton />

  // ─── Main render ─────────────────────────────────────────────────────────────

  const bgIsImage = isImageBackground(album.background_theme)
  const bgStyle = getBackgroundColorStyle(album.background_theme)

  return (
    <>
      {/* Fixed background image — lives outside <main> so any stacking context on
          <main> cannot trap it. z-index: -10 paints it behind all page content.
          Body background (#FDFAF5, set in global CSS) shows if the image fails to load. */}
      {bgIsImage && album.background_theme && (
        <div
          className="fixed inset-0 -z-10 pointer-events-none"
          style={{
            backgroundImage: `url("${getBackgroundImageUrl(album.background_theme)}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
          aria-hidden="true"
        />
      )}

      <main
        className="hush-album-page min-h-dvh relative"
        style={bgStyle}
        aria-label={album.title}
      >
        <AlbumHeader
          album={album}
          photoCount={photos.length}
          isOwner={effectiveIsOwner}
          onAlbumUpdated={handleAlbumUpdated}
        />

        {effectiveIsOwner ? (
          <OwnerToolbar
            album={album}
            photos={photos}
            ownerToken={ownerToken}
            userTier={userTier}
            mediaRadiusMax={Math.max(1, mediaRadiusMax)}
            onAlbumUpdated={handleAlbumUpdated}
            onOpenSlideshow={() => setSlideshowRequestId(id => id + 1)}
            arrangeMode={arrangeMode}
            onToggleArrangeMode={() => setArrangeMode(m => !m)}
          />
        ) : (
          <GuestActionsBar
            album={album}
            photos={photos}
            shareUrl={`${SITE_ORIGIN}/${album.custom_slug ?? album.slug}`}
            onOpenSlideshow={() => setSlideshowRequestId(id => id + 1)}
            onOpenFaceFinder={() => setShowFaceFinder(true)}
          />
        )}

        {showFaceFinder && (
          <FaceFinder
            albumSlug={album.custom_slug ?? album.slug}
            photos={photos}
            onClose={() => setShowFaceFinder(false)}
          />
        )}

        {(album.guest_uploads_enabled || effectiveIsOwner) && (
          <UploadZone album={album} userTier={userTier} onPhotosUploaded={handlePhotosUploaded} />
        )}

        <div className="hush-container pb-6">
          <PhotoGrid
            album={album}
            photos={photos}
            isOwner={effectiveIsOwner}
            slug={album.slug}
            forceGlobalRadius={forceGlobalRadius}
            onRadiusMaxChange={setMediaRadiusMax}
            onPhotoDeleted={handlePhotoDeleted}
            onPhotoUpdated={handlePhotoUpdated}
            onPhotosReordered={handlePhotosReordered}
            slideshowRequestId={slideshowRequestId}
            arrangeMode={arrangeMode}
            coverPhotoId={album.cover_photo_id}
            onCoverSet={(photoId) => handleAlbumUpdated({ cover_photo_id: photoId })}
          />
        </div>

        {photos.length >= 2000 && (
          <p className="text-center text-xs py-4" style={{ color: '#8B6F4E' }}>
            Showing the first 2,000 photos
          </p>
        )}
      </main>
    </>
  )
}
