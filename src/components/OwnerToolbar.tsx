'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useZipDownload } from '@/components/photo-grid/useZipDownload'
import { Check, ChevronDown, Clock, Copy, Download, FolderPlus, Images, Link2, Loader2, Lock, LockOpen, Move, Play, ScanFace, Settings, Trash2, X } from 'lucide-react'
import type { Album, Photo, Tier } from '@/types'
import {
  DEFAULT_SLIDESHOW_INTERVAL_MS,
  MAX_SLIDESHOW_INTERVAL_MS,
  MIN_SLIDESHOW_INTERVAL_MS,
  MEDIA_DISPLAY_FILTER_OPTIONS,
  MOBILE_GRID_COLUMN_OPTIONS,
  SLIDESHOW_ANIMATION_OPTIONS,
  type MediaDisplayFilter,
  type MediaHoverEffect,
  type MobileGridColumns,
  type SlideshowAnimation,
} from '@/lib/media-display'
import { formatFileSize } from '@/lib/utils'
import { showAppToast, storeAppToast } from '@/components/AppToast'
import BackgroundLibraryModal from '@/components/owner-toolbar/BackgroundLibraryModal'
import RevealDatePicker from '@/components/RevealDatePicker'
import ShareMenu from '@/components/owner-toolbar/ShareMenu'
import {
  addAlbumToCollectionRequest,
  deleteAlbumRequest,
  fetchCollections,
  saveBackgroundRequest,
  saveCustomUrlRequest,
  saveGuestDownloadsRequest,
  saveMediaSettingsRequest,
  savePasswordRequest,
  uploadBackgroundRequest,
} from '@/components/owner-toolbar/api'
import {
  BACKGROUND_IMAGE_TYPES,
  DEFAULT_BG,
  FEATURED_STOCK_BACKGROUNDS,
  MAX_BACKGROUND_BYTES,
  PRESETS,
} from '@/components/owner-toolbar/constants'
import { accordionButton, btnBase, inputStyle, sectionTitle, settingsSectionStyle } from '@/components/owner-toolbar/styles'
import type { CollectionSummary, SettingsSection } from '@/components/owner-toolbar/types'

type Props = {
  album: Album
  photos: Photo[]
  ownerToken: string | null
  userTier: Tier
  mediaRadiusMax: number
  onAlbumUpdated: (
    patch: Partial<Album>,
    options?: {
      forceGlobalRadius?: boolean
      resetRadiusOverrides?: boolean
      resetFilterOverrides?: boolean
    },
  ) => void
  onOpenSlideshow: () => void
  arrangeMode: boolean
  onToggleArrangeMode: () => void
}

// ownerToken is kept in props only to build the owner share URL (the #owner=… link
// that recipients use to log in on a new device). It is NOT passed to any API call —
// all owner mutations use the HttpOnly hushare_owner_* cookie set by /api/album/owner-login.

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function OwnerToolbar({ album, photos, ownerToken, userTier, mediaRadiusMax, onAlbumUpdated, onOpenSlideshow, arrangeMode, onToggleArrangeMode }: Props) {
  const [copied, setCopied] = useState<'share' | 'owner' | null>(null)
  const [showShare, setShowShare] = useState(false)
  // Account owners have no #owner= link, so ownerToken (prop) is null for them. Fetch the
  // token from the owner-verified endpoint the first time the Share menu opens so the
  // management link can be shown. Never fetched for guests (this component only renders
  // for owners) and never on mount — only when the owner actually opens Share.
  const [fetchedOwnerToken, setFetchedOwnerToken] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [openSection, setOpenSection] = useState<SettingsSection | null>(null)

  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deletingAlbum, setDeletingAlbum] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const [customUrlInput, setCustomUrlInput] = useState(album.custom_slug ?? '')
  const [customUrlSaving, setCustomUrlSaving] = useState(false)
  const [customUrlError, setCustomUrlError] = useState('')
  const [customUrlSaved, setCustomUrlSaved] = useState(false)

  const [passwordInput, setPasswordInput] = useState('')
  const [passwordInputKey, setPasswordInputKey] = useState(0)
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSaved, setPasswordSaved] = useState(false)

  const [collectionSaving, setCollectionSaving] = useState(false)
  const [collectionError, setCollectionError] = useState('')
  const [collectionUrl, setCollectionUrl] = useState('')
  const [collections, setCollections] = useState<CollectionSummary[]>([])
  const [collectionsLoading, setCollectionsLoading] = useState(false)

  const [backgroundSaving, setBackgroundSaving] = useState(false)
  const [backgroundError, setBackgroundError] = useState('')
  const [showBackgroundLibrary, setShowBackgroundLibrary] = useState(false)
  const [mediaRadius, setMediaRadius] = useState(album.media_radius ?? 12)
  const [mediaRadiusDraft, setMediaRadiusDraft] = useState(String(album.media_radius ?? 12))
  const [mediaRadiusEditing, setMediaRadiusEditing] = useState(false)
  const [savedMediaRadius, setSavedMediaRadius] = useState(album.media_radius ?? 12)
  const [videoAutoplay, setVideoAutoplay] = useState(!!album.video_autoplay)
  const [mediaFilter, setMediaFilter] = useState<MediaDisplayFilter>(album.media_filter ?? 'none')
  const [savedMediaFilter, setSavedMediaFilter] = useState<MediaDisplayFilter>(album.media_filter ?? 'none')
  const [mediaHover, setMediaHover] = useState<MediaHoverEffect>(album.media_hover ?? 'none')
  const [mobileGridColumns, setMobileGridColumns] = useState<MobileGridColumns>(album.mobile_grid_columns ?? 3)
  const [slideshowIntervalMs, setSlideshowIntervalMs] = useState(album.slideshow_interval_ms ?? DEFAULT_SLIDESHOW_INTERVAL_MS)
  const [slideshowAnimation, setSlideshowAnimation] = useState<SlideshowAnimation>(album.slideshow_animation ?? 'fade')
  const [mediaError, setMediaError] = useState('')

  const [revealInput, setRevealInput] = useState(() => toDatetimeLocal(album.reveal_at ?? null))
  const [revealSaving, setRevealSaving] = useState(false)
  const [revealError, setRevealError] = useState('')
  const [revealSaved, setRevealSaved] = useState(false)

  const { zipping, zipProgress, downloadZip } = useZipDownload(photos, album.title ?? '')

  const [allowGuestDownloads, setAllowGuestDownloads] = useState(album.allow_guest_downloads !== false)
  const [faceFinderEnabled, setFaceFinderEnabled] = useState(!!album.face_finder_enabled)

  const shareRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  const backgroundInputRef = useRef<HTMLInputElement>(null)

  const publicSlug = album.custom_slug ?? album.slug
  // shareUrl and ownerUrl depend on window.location.origin, which is not available during
  // SSR. Initialise with '' and populate in a useEffect so the server-rendered HTML and
  // the first client render both produce an empty origin — eliminating the hydration mismatch.
  const [origin, setOrigin] = useState('')
  useEffect(() => { setOrigin(window.location.origin) }, [])
  const shareUrl = origin ? `${origin}/${publicSlug}` : `/${publicSlug}`

  // Fetch the owner token eagerly when the toolbar mounts (owner view is already confirmed),
  // so the management link is ready the instant the Share menu opens — not a few seconds
  // later. Only needed when we arrived without the token in the URL (e.g. a page refresh:
  // owner cookie present, no #owner= hash). Runs at most once per album.
  useEffect(() => {
    if (ownerToken || fetchedOwnerToken) return
    let cancelled = false
    void fetch(`/api/album/owner-link?slug=${encodeURIComponent(album.slug)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { owner_token?: string } | null) => {
        if (!cancelled && j?.owner_token) setFetchedOwnerToken(j.owner_token)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [ownerToken, fetchedOwnerToken, album.slug])

  // The owner link works whether the token came from the #owner= hash (ownerToken prop)
  // or was fetched for an account owner (fetchedOwnerToken).
  const effectiveOwnerToken = ownerToken ?? fetchedOwnerToken
  const ownerUrl = effectiveOwnerToken && origin ? `${origin}/${album.slug}#owner=${effectiveOwnerToken}` : null
  const canCustomize = userTier === 'pro' || userTier === 'studio'
  const canUseCollections = userTier === 'studio'
  const bgChoice = album.background_theme ?? DEFAULT_BG
  const currentColor = bgChoice.startsWith('#') ? bgChoice : DEFAULT_BG
  const isDark = bgChoice === '#1C2333' || bgChoice === '#1A2B1A' || bgChoice.startsWith('image:') || bgChoice.startsWith('stock:')
  const radiusMax = Math.max(1, Math.round(mediaRadiusMax))

  useEffect(() => {
    if (mediaRadius > radiusMax) {
      setMediaRadius(radiusMax)
      onAlbumUpdated({ media_radius: radiusMax }, { forceGlobalRadius: true })
    }
  }, [mediaRadius, onAlbumUpdated, radiusMax])

  useEffect(() => {
    if (!mediaRadiusEditing) setMediaRadiusDraft(String(mediaRadius))
  }, [mediaRadius, mediaRadiusEditing])

  const loadCollections = useCallback(async () => {
    setCollectionsLoading(true)
    try {
      setCollections(await fetchCollections(album.slug))
    } finally {
      setCollectionsLoading(false)
    }
  }, [album.slug])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node
      if (shareRef.current && !shareRef.current.contains(target)) setShowShare(false)
      if (settingsRef.current && !settingsRef.current.contains(target)) setShowSettings(false)
    }
    if (showShare || showSettings) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showShare, showSettings])

  useEffect(() => {
    // Only lock scroll for the mobile centred panel; the desktop dropdown must not freeze the page.
    const lock = showShare && typeof window !== 'undefined' && window.innerWidth < 640
    if (lock) document.body.classList.add('hush-scroll-locked')
    else document.body.classList.remove('hush-scroll-locked')
    return () => document.body.classList.remove('hush-scroll-locked')
  }, [showShare])

  useEffect(() => {
    if (!showSettings) {
      // Cancel any pending debounced save so closing the panel doesn't persist uncommitted changes.
      if (debouncedSaveRef.current !== null) {
        window.clearTimeout(debouncedSaveRef.current)
        debouncedSaveRef.current = null
      }
      setCustomUrlInput(album.custom_slug ?? '')
      setCustomUrlError('')
      setCustomUrlSaved(false)
      setPasswordError('')
      setPasswordSaved(false)
      setPasswordInput('')
      setCollectionError('')
      setMediaRadius(album.media_radius ?? 12)
      setMediaRadiusDraft(String(album.media_radius ?? 12))
      setMediaRadiusEditing(false)
      setSavedMediaRadius(album.media_radius ?? 12)
      setVideoAutoplay(!!album.video_autoplay)
      setAllowGuestDownloads(album.allow_guest_downloads !== false)
      setFaceFinderEnabled(!!album.face_finder_enabled)
      setMediaFilter(album.media_filter ?? 'none')
      setSavedMediaFilter(album.media_filter ?? 'none')
      setMediaHover(album.media_hover ?? 'none')
      setMobileGridColumns(album.mobile_grid_columns ?? 3)
      setSlideshowIntervalMs(album.slideshow_interval_ms ?? DEFAULT_SLIDESHOW_INTERVAL_MS)
      setSlideshowAnimation(album.slideshow_animation ?? 'fade')
      setMediaError('')
      setRevealInput(toDatetimeLocal(album.reveal_at ?? null))
      setRevealError('')
      setRevealSaved(false)
      setOpenSection(null)
      setDeleteConfirm(false)
      setDeleteError('')
    }
  }, [album.allow_guest_downloads, album.custom_slug, album.media_filter, album.media_hover, album.media_radius, album.mobile_grid_columns, album.reveal_at, album.slideshow_animation, album.slideshow_interval_ms, album.video_autoplay, showSettings])

  useEffect(() => {
    if (showSettings && canUseCollections) void loadCollections()
  }, [showSettings, canUseCollections, loadCollections])

  function toggleSection(section: SettingsSection) {
    setOpenSection((current) => {
      const next = current === section ? null : section
      // Only clear password state when OPENING — not when closing — so the user doesn't
      // lose a partially-typed password if they accidentally close and reopen.
      if (section === 'password' && next === 'password') {
        setPasswordInput('')
        setPasswordInputKey((key) => key + 1)
        setPasswordError('')
        setPasswordSaved(false)
      }
      return next
    })
  }

  async function copy(type: 'share' | 'owner') {
    const text = type === 'share' ? shareUrl : (ownerUrl ?? '')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(type)
      showAppToast(type === 'share' ? 'Share link copied.' : 'Owner link copied.')
      setTimeout(() => setCopied(null), 2000)
    } catch {
      showAppToast('Could not copy — please copy the link manually.', 'error')
    }
  }

  async function saveCustomUrl(action: 'set' | 'clear') {
    setCustomUrlSaving(true)
    setCustomUrlError('')
    setCustomUrlSaved(false)
    try {
      const result = await saveCustomUrlRequest(
        album.slug,
        action === 'clear' ? null : customUrlInput.trim().toLowerCase(),
      )
      if (!result.ok) {
        setCustomUrlError(result.error)
        showAppToast(result.error, 'error')
        return
      }
      onAlbumUpdated({ custom_slug: result.custom_slug })
      setCustomUrlSaved(true)
      showAppToast(action === 'clear' ? 'Custom URL cleared.' : 'Custom URL saved.')
      if (action === 'clear') setCustomUrlInput('')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Network error'
      setCustomUrlError(message)
      showAppToast(message, 'error')
    } finally {
      setCustomUrlSaving(false)
    }
  }

  async function savePassword(action: 'set' | 'clear') {
    setPasswordSaving(true)
    setPasswordError('')
    setPasswordSaved(false)
    try {
      const result = await savePasswordRequest(
        album.slug,
        action === 'clear' ? null : passwordInput,
      )
      if (!result.ok) {
        setPasswordError(result.error)
        showAppToast(result.error, 'error')
        return
      }
      onAlbumUpdated({ password_protected: result.password_protected })
      setPasswordSaved(true)
      setPasswordInput('')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Network error'
      setPasswordError(message)
      showAppToast(message, 'error')
    } finally {
      setPasswordSaving(false)
    }
  }

  async function saveBackground(choice: string | null): Promise<boolean> {
    setBackgroundSaving(true)
    setBackgroundError('')
    const previousBackground = album.background_theme ?? null
    onAlbumUpdated({ background_theme: choice })
    try {
      const result = await saveBackgroundRequest(album.slug, choice)
      if (!result.ok) {
        onAlbumUpdated({ background_theme: previousBackground })
        setBackgroundError(result.error)
        showAppToast(result.error, 'error')
        return false
      }
      onAlbumUpdated({ background_theme: result.background_theme })
      showAppToast('Background saved.')
      return true
    } catch (e) {
      onAlbumUpdated({ background_theme: previousBackground })
      const message = e instanceof Error ? e.message : 'Network error'
      setBackgroundError(message)
      showAppToast(message, 'error')
      return false
    } finally {
      setBackgroundSaving(false)
    }
  }

  async function saveMediaSettings(
    nextRadius = mediaRadius,
    nextAutoplay = videoAutoplay,
    nextFilter = mediaFilter,
    nextHover = mediaHover,
    nextMobileGridColumns = mobileGridColumns,
    nextSlideshowIntervalMs = slideshowIntervalMs,
    nextSlideshowAnimation = slideshowAnimation,
  ) {
    setMediaError('')
    try {
      const resetRadiusOverrides = nextRadius !== savedMediaRadius
      const resetFilterOverrides = nextFilter !== savedMediaFilter
      const result = await saveMediaSettingsRequest(
        album.slug,
        nextRadius,
        nextAutoplay,
        nextFilter,
        nextHover,
        nextMobileGridColumns,
        nextSlideshowIntervalMs,
        nextSlideshowAnimation,
        resetRadiusOverrides,
        resetFilterOverrides,
      )
      if (!result.ok) {
        setMediaError(result.error)
        showAppToast(result.error, 'error')
        return
      }
      setMediaRadius(result.media_radius)
      setSavedMediaRadius(result.media_radius)
      setVideoAutoplay(result.video_autoplay)
      setMediaFilter(result.media_filter)
      setSavedMediaFilter(result.media_filter)
      setMediaHover(result.media_hover)
      setMobileGridColumns(result.mobile_grid_columns)
      setSlideshowIntervalMs(result.slideshow_interval_ms)
      setSlideshowAnimation(result.slideshow_animation)
      onAlbumUpdated(
        {
          media_radius: result.media_radius,
          video_autoplay: result.video_autoplay,
          media_filter: result.media_filter,
          media_hover: result.media_hover,
          mobile_grid_columns: result.mobile_grid_columns,
          slideshow_interval_ms: result.slideshow_interval_ms,
          slideshow_animation: result.slideshow_animation,
        },
        { forceGlobalRadius: false, resetRadiusOverrides, resetFilterOverrides },
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Network error'
      setMediaError(message)
      showAppToast(message, 'error')
    }
  }

  // Debounced auto-save for slider controls. 500ms lets the user settle on a value.
  const debouncedSaveRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (debouncedSaveRef.current !== null) {
      window.clearTimeout(debouncedSaveRef.current)
    }
  }, [])

  function scheduleAutoSave(
    nextRadius: number,
    nextAutoplay: boolean,
    nextFilter: MediaDisplayFilter,
    nextHover: MediaHoverEffect,
    nextMobileGridColumns: MobileGridColumns,
    nextSlideshowIntervalMs: number,
    nextSlideshowAnimation: SlideshowAnimation,
  ) {
    if (debouncedSaveRef.current !== null) {
      window.clearTimeout(debouncedSaveRef.current)
    }
    debouncedSaveRef.current = window.setTimeout(() => {
      debouncedSaveRef.current = null
      void saveMediaSettings(
        nextRadius,
        nextAutoplay,
        nextFilter,
        nextHover,
        nextMobileGridColumns,
        nextSlideshowIntervalMs,
        nextSlideshowAnimation,
      )
    }, 500)
  }

  function applyMediaRadius(value: number) {
    const nextRadius = Math.max(0, Math.min(radiusMax, Math.round(value)))
    setMediaRadius(nextRadius)
    onAlbumUpdated({ media_radius: nextRadius }, { forceGlobalRadius: true })
    scheduleAutoSave(nextRadius, videoAutoplay, mediaFilter, mediaHover, mobileGridColumns, slideshowIntervalMs, slideshowAnimation)
  }

  function parseMediaRadiusDraft(value: string): number | null {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) return null
    return Math.max(0, Math.min(radiusMax, Math.round(parsed)))
  }

  function commitMediaRadiusDraft() {
    const nextRadius = parseMediaRadiusDraft(mediaRadiusDraft)
    if (nextRadius == null) {
      setMediaRadiusDraft(String(mediaRadius))
      return
    }
    applyMediaRadius(nextRadius)
    setMediaRadiusDraft(String(nextRadius))
  }

  function changeMediaRadiusDraft(value: string) {
    const digitsOnly = value.replace(/[^\d]/g, '')
    setMediaRadiusDraft(digitsOnly)
    const nextRadius = parseMediaRadiusDraft(digitsOnly)
    if (nextRadius != null) applyMediaRadius(nextRadius)
  }

  function applySlideshowInterval(value: number) {
    const nextInterval = Math.max(MIN_SLIDESHOW_INTERVAL_MS, Math.min(MAX_SLIDESHOW_INTERVAL_MS, Math.round(value)))
    setSlideshowIntervalMs(nextInterval)
    onAlbumUpdated({ slideshow_interval_ms: nextInterval })
    scheduleAutoSave(mediaRadius, videoAutoplay, mediaFilter, mediaHover, mobileGridColumns, nextInterval, slideshowAnimation)
  }

  async function chooseBackground(choice: string, closeLibrary = false) {
    const saved = await saveBackground(choice)
    if (saved && closeLibrary) setShowBackgroundLibrary(false)
  }

  async function uploadBackgroundImage(file: File) {
    setBackgroundError('')
    if (!BACKGROUND_IMAGE_TYPES.has(file.type)) {
      setBackgroundError('Use a JPG, PNG, WebP, or AVIF image.')
      showAppToast('Use a JPG, PNG, WebP, or AVIF image.', 'error')
      return
    }
    if (file.size > MAX_BACKGROUND_BYTES) {
      const message = `Background image must be ${formatFileSize(MAX_BACKGROUND_BYTES)} or smaller.`
      setBackgroundError(message)
      showAppToast(message, 'error')
      return
    }

    setBackgroundSaving(true)
    try {
      const result = await uploadBackgroundRequest(album.slug, file)
      if (!result.ok) {
        setBackgroundError(result.error)
        showAppToast(result.error, 'error')
        return
      }
      onAlbumUpdated({ background_theme: result.background_theme })
      showAppToast('Background image uploaded.')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Network error'
      setBackgroundError(message)
      showAppToast(message, 'error')
    } finally {
      setBackgroundSaving(false)
      if (backgroundInputRef.current) backgroundInputRef.current.value = ''
    }
  }

  async function addAlbumToCollection(collectionId: string) {
    setCollectionSaving(true)
    setCollectionError('')
    setCollectionUrl('')
    try {
      const result = await addAlbumToCollectionRequest(album.slug, collectionId)
      if (!result.ok) {
        setCollectionError(result.error)
        showAppToast(result.error, 'error')
        return
      }
      setCollectionUrl(`${window.location.origin}/c/${result.slug}`)
      await loadCollections()
      showAppToast('Album added to collection.')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Network error'
      setCollectionError(message)
      showAppToast(message, 'error')
    } finally {
      setCollectionSaving(false)
    }
  }

  async function deleteAlbum() {
    if (!deleteConfirm) {
      setDeleteConfirm(true)
      setDeleteError('')
      return
    }

    setDeletingAlbum(true)
    setDeleteError('')
    try {
      const result = await deleteAlbumRequest(album.slug)
      if (!result.ok) {
        setDeleteError(result.error)
        showAppToast(result.error, 'error')
        return
      }
      storeAppToast('Album deleted.')
      window.location.href = '/'
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Network error'
      setDeleteError(message)
      showAppToast(message, 'error')
    } finally {
      setDeletingAlbum(false)
    }
  }

  async function saveReveal(action: 'set' | 'clear') {
    setRevealError('')
    setRevealSaved(false)
    // Validate BEFORE setting revealSaving=true so an invalid date doesn't leave
    // the button stuck in the "Saving…" state forever.
    let reveal_at: string | null = null
    if (action === 'set' && revealInput) {
      const parsed = new Date(revealInput)
      if (isNaN(parsed.getTime())) {
        setRevealError('Invalid date')
        return
      }
      reveal_at = parsed.toISOString()
    }
    setRevealSaving(true)
    try {
      const res = await fetch('/api/album/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: album.slug, reveal_at }),
      })
      const result = (await res.json()) as { ok?: boolean; reveal_at?: string | null; error?: string }
      if (!res.ok || !result.ok) {
        const message = result.error ?? 'Could not save reveal time'
        setRevealError(message)
        showAppToast(message, 'error')
        return
      }
      onAlbumUpdated({ reveal_at: result.reveal_at ?? null })
      setRevealInput(toDatetimeLocal(result.reveal_at ?? null))
      setRevealSaved(true)
      showAppToast(action === 'clear' ? 'Reveal time cleared.' : 'Reveal time saved.')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Network error'
      setRevealError(message)
      showAppToast(message, 'error')
    } finally {
      setRevealSaving(false)
    }
  }

  return (
    <>
    <div className="hush-owner-toolbar" style={{ background: '#F5F0E8', borderBottom: '1px solid #DDD5C5' }}>
      <div className="hush-container hush-owner-toolbar-inner py-3 flex flex-wrap items-center gap-3" style={{ paddingInline: 'clamp(14px, 4vw, 20px)' }}>
        <div className="hush-owner-action-wrap relative" ref={shareRef}>
          <button
            className="hush-press hush-owner-action"
            style={btnBase}
            onClick={() => {
              setShowShare((s) => !s)
              setShowSettings(false)
            }}
          >
            <Copy className="w-4 h-4" style={{ color: '#7C5C3E' }} />
            Share
          </button>

          {showShare && (
            <ShareMenu
              copied={copied}
              ownerUrl={ownerUrl}
              shareUrl={shareUrl}
              albumTitle={album.title ?? 'Album'}
              onClose={() => setShowShare(false)}
              onCopy={copy}
            />
          )}
        </div>

        <button
          className="hush-press hush-owner-action"
          style={btnBase}
          onClick={() => {
            if (photos.length === 0) {
              showAppToast('Upload photos or videos before creating a slideshow.', 'error')
              return
            }
            setShowShare(false)
            setShowSettings(false)
            onOpenSlideshow()
          }}
          title="Create slideshow"
        >
          <Play className="w-4 h-4" style={{ color: '#7C5C3E' }} />
          Slideshow
        </button>

        <button
          className="hush-press hush-owner-action hush-owner-arrange-action"
          style={{ ...btnBase, background: arrangeMode ? '#254F22' : btnBase.background, color: arrangeMode ? '#FDFAF5' : btnBase.color }}
          onClick={() => {
            setShowShare(false)
            setShowSettings(false)
            onToggleArrangeMode()
          }}
          title="Arrange media"
        >
          <Move className="w-4 h-4" style={{ color: arrangeMode ? '#FDFAF5' : '#7C5C3E' }} />
          {arrangeMode ? 'Done' : 'Arrange'}
        </button>

        <div className="hush-owner-action-wrap hush-owner-settings relative ml-auto" ref={settingsRef}>
          <button
            className="hush-press hush-owner-action"
            style={{ ...btnBase, padding: '6px 10px' }}
            onClick={() => {
              setShowSettings((s) => {
                const next = !s
                if (next) {
                  setPasswordInput('')
                  setPasswordError('')
                  setPasswordSaved(false)
                }
                return next
              })
              setShowShare(false)
            }}
            title="Settings"
          >
            <Settings className="w-4 h-4" style={{ color: '#7C5C3E' }} />
            Settings
          </button>

          {showSettings && (
            <div
              className="hush-menu-pop absolute right-0 top-full mt-2 z-50 rounded-2xl shadow-xl max-h-[78vh] overflow-y-auto"
              style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', width: 'min(94vw, 480px)', padding: 12 }}
            >
              <div className="flex items-start justify-between gap-4 rounded-xl px-3 py-3 mb-3" style={{ background: '#FFFFFF', border: '1px solid #E8E0D2' }}>
                <div>
                  <span className="block font-semibold text-sm" style={{ color: '#254F22' }}>Album settings</span>
                  <span className="block text-xs mt-1" style={{ color: '#8B6F4E' }}>
                    Share, customize, protect, and organize this album.
                  </span>
                </div>
                <button onClick={() => setShowSettings(false)} className="shrink-0 rounded-full p-1 transition hover:opacity-80" style={{ color: '#A89880', cursor: 'pointer', background: '#F5F0E8' }} aria-label="Close settings">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Customization */}
              <section style={settingsSectionStyle}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('customization')}>
                  <Images className="w-4 h-4" style={{ color: '#7C5C3E' }} />
                  <span style={sectionTitle}>Customization</span>
                  <ChevronDown
                    className="ml-auto w-4 h-4 transition-transform"
                    style={{ color: '#A89880', transform: openSection === 'customization' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>

                {openSection === 'customization' && (
                  <div className="px-4 pb-4">
                    <p className="text-xs font-medium mb-2" style={{ color: '#7C5C3E' }}>Color patterns</p>
                    <div className="grid grid-cols-8 gap-2 mb-4">
                      {PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          title={preset.label}
                          onClick={() => saveBackground(preset.value)}
                          disabled={backgroundSaving}
                          style={{
                            width: '100%',
                            aspectRatio: '1',
                            borderRadius: 10,
                            background: preset.value,
                            border: bgChoice === preset.value ? '2px solid #254F22' : '1.5px solid #DDD5C5',
                            cursor: backgroundSaving ? 'wait' : 'pointer',
                            position: 'relative',
                          }}
                        >
                          {bgChoice === preset.value && (
                            <span className="absolute inset-0 flex items-center justify-center">
                              <Check className="w-4 h-4" style={{ color: isDark ? '#FFFFFF' : '#254F22' }} />
                            </span>
                          )}
                        </button>
                      ))}
                    </div>

                    <p className="text-xs font-medium mb-2" style={{ color: '#7C5C3E' }}>Stock photos</p>
                    <div className="grid grid-cols-5 gap-2 mb-3">
                      {FEATURED_STOCK_BACKGROUNDS.map((preset) => (
                        <button
                          key={preset.value}
                          title={preset.label}
                          onClick={() => chooseBackground(preset.value)}
                          disabled={backgroundSaving}
                          className="relative overflow-hidden"
                          style={{
                            width: '100%',
                            aspectRatio: '1',
                            borderRadius: 10,
                            backgroundImage: `url(${preset.src})`,
                            backgroundPosition: 'center',
                            backgroundSize: 'cover',
                            border: (bgChoice === preset.value || bgChoice === preset.legacyValue || bgChoice === preset.imageValue) ? '2px solid #254F22' : '1.5px solid #DDD5C5',
                            cursor: backgroundSaving ? 'wait' : 'pointer',
                          }}
                        >
                          {(bgChoice === preset.value || bgChoice === preset.legacyValue || bgChoice === preset.imageValue) && (
                            <span className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(37,79,34,0.25)' }}>
                              <Check className="w-4 h-4" style={{ color: '#FFFFFF' }} />
                            </span>
                          )}
                        </button>
                      ))}
                    </div>

                    <input
                      ref={backgroundInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/avif"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) void uploadBackgroundImage(file)
                      }}
                    />

                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <button
                        className="hush-press flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: '#254F22', border: '1px solid #254F22', color: '#FDFAF5', cursor: backgroundSaving ? 'wait' : 'pointer' }}
                        onClick={() => backgroundInputRef.current?.click()}
                        disabled={backgroundSaving}
                      >
                        <Images className="h-4 w-4" />
                        {backgroundSaving ? 'Saving...' : 'Add picture'}
                      </button>
                      <button
                        className="hush-press flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition hover:opacity-90"
                        style={{ background: '#F5F0E8', border: '1px solid #DDD5C5', color: '#254F22', cursor: 'pointer' }}
                        onClick={() => setShowBackgroundLibrary(true)}
                      >
                        <Images className="h-4 w-4" />
                        See all
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium" style={{ color: '#7C5C3E' }}>Custom color</label>
                      <input
                        type="color"
                        value={currentColor}
                        onChange={(e) => void saveBackground(e.target.value)}
                        style={{ width: 36, height: 28, borderRadius: 8, border: '1.5px solid #DDD5C5', cursor: 'pointer', padding: 2 }}
                      />
                      <span className="text-xs font-mono" style={{ color: '#A89880' }}>{currentColor}</span>
                      <button
                        className="ml-auto text-xs"
                        style={{ color: '#A89880', cursor: 'pointer' }}
                        onClick={() => void saveBackground(null)}
                      >
                        Reset
                      </button>
                    </div>
                    {backgroundError && <p className="text-xs mt-2" style={{ color: '#C0392B' }}>{backgroundError}</p>}
                  </div>
                )}
              </section>

              {/* Media display */}
              <section style={settingsSectionStyle}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('media')}>
                  <Settings className="w-4 h-4" style={{ color: '#7C5C3E' }} />
                  <span style={sectionTitle}>Media display</span>
                  <ChevronDown
                    className="ml-auto w-4 h-4 transition-transform"
                    style={{ color: '#A89880', transform: openSection === 'media' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'media' && (
                  <div className="px-4 pb-4 space-y-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <label className="text-xs font-medium" style={{ color: '#7C5C3E' }}>Global corner radius</label>
                        <span className="text-xs font-mono" style={{ color: '#A89880' }}>{mediaRadius}px</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={radiusMax}
                        value={mediaRadius}
                        onChange={(e) => applyMediaRadius(Number(e.target.value))}
                        className="w-full"
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={mediaRadiusDraft}
                        onChange={(e) => changeMediaRadiusDraft(e.target.value)}
                        onFocus={() => {
                          setMediaRadiusEditing(true)
                          setMediaRadiusDraft(String(mediaRadius))
                        }}
                        onBlur={() => {
                          setMediaRadiusEditing(false)
                          commitMediaRadiusDraft()
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                          else if (e.key === 'Escape') {
                            setMediaRadiusDraft(String(mediaRadius))
                            e.currentTarget.blur()
                          }
                        }}
                        className="mt-2 w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                        style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
                      />
                    </div>

                    <label className="flex items-center justify-between gap-4 rounded-xl px-3 py-3" style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', cursor: 'pointer' }}>
                      <span>
                        <span className="block text-sm font-semibold" style={{ color: '#254F22' }}>Video autoplay</span>
                        <span className="block text-xs" style={{ color: '#7C5C3E' }}>Start videos automatically when opened.</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={videoAutoplay}
                        onChange={(e) => {
                          const nextAutoplay = e.target.checked
                          setVideoAutoplay(nextAutoplay)
                          onAlbumUpdated({ video_autoplay: nextAutoplay })
                          if (debouncedSaveRef.current !== null) { window.clearTimeout(debouncedSaveRef.current); debouncedSaveRef.current = null }
                          void saveMediaSettings(mediaRadius, nextAutoplay, mediaFilter, mediaHover, mobileGridColumns, slideshowIntervalMs, slideshowAnimation)
                        }}
                        className="h-4 w-4"
                      />
                    </label>

                    <div>
                      <label className="mb-2 block text-xs font-medium" style={{ color: '#7C5C3E' }}>Global filter</label>
                      <select
                        value={mediaFilter}
                        onChange={(e) => {
                          const nextFilter = e.target.value as MediaDisplayFilter
                          setMediaFilter(nextFilter)
                          onAlbumUpdated({ media_filter: nextFilter })
                          if (debouncedSaveRef.current !== null) { window.clearTimeout(debouncedSaveRef.current); debouncedSaveRef.current = null }
                          void saveMediaSettings(mediaRadius, videoAutoplay, nextFilter, mediaHover, mobileGridColumns, slideshowIntervalMs, slideshowAnimation)
                        }}
                        className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                        style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
                      >
                        {MEDIA_DISPLAY_FILTER_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-medium" style={{ color: '#7C5C3E' }}>Grid</label>
                      <div className="grid grid-cols-4 gap-2">
                        {MOBILE_GRID_COLUMN_OPTIONS.map((option) => {
                          const selected = mobileGridColumns === option.value
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => {
                                setMobileGridColumns(option.value)
                                onAlbumUpdated({ mobile_grid_columns: option.value })
                                if (debouncedSaveRef.current !== null) { window.clearTimeout(debouncedSaveRef.current); debouncedSaveRef.current = null }
                                void saveMediaSettings(mediaRadius, videoAutoplay, mediaFilter, mediaHover, option.value, slideshowIntervalMs, slideshowAnimation)
                              }}
                              className="hush-press rounded-lg py-2 text-sm font-semibold"
                              style={{
                                background: selected ? '#254F22' : '#FDFAF5',
                                border: '1px solid #DDD5C5',
                                color: selected ? '#FDFAF5' : '#254F22',
                              }}
                            >
                              {option.value}
                            </button>
                          )
                        })}
                      </div>
                      <p className="mt-2 text-xs" style={{ color: '#8B6F4E' }}>
                        Applies to album thumbnails on desktop and mobile.
                      </p>
                    </div>

                    {mediaError && <p className="text-xs" style={{ color: '#C0392B' }}>{mediaError}</p>}
                  </div>
                )}
              </section>

              {/* Slideshow settings */}
              <section style={settingsSectionStyle}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('slideshow')}>
                  <Play className="w-4 h-4" style={{ color: '#7C5C3E' }} />
                  <span style={sectionTitle}>Slideshow settings</span>
                  <ChevronDown
                    className="ml-auto w-4 h-4 transition-transform"
                    style={{ color: '#A89880', transform: openSection === 'slideshow' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'slideshow' && (
                  <div className="px-4 pb-4 space-y-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <label className="text-xs font-medium" style={{ color: '#7C5C3E' }}>Slide speed</label>
                        <span className="text-xs font-mono" style={{ color: '#A89880' }}>{(slideshowIntervalMs / 1000).toFixed(slideshowIntervalMs % 1000 === 0 ? 0 : 1)}s</span>
                      </div>
                      <input
                        type="range"
                        min={MIN_SLIDESHOW_INTERVAL_MS}
                        max={MAX_SLIDESHOW_INTERVAL_MS}
                        step={250}
                        value={slideshowIntervalMs}
                        onChange={(e) => applySlideshowInterval(Number(e.target.value))}
                        className="w-full"
                      />
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          className="hush-press rounded-lg py-2 text-xs font-semibold"
                          style={{ background: slideshowIntervalMs === 3000 ? '#254F22' : '#FDFAF5', color: slideshowIntervalMs === 3000 ? '#FDFAF5' : '#254F22', border: '1px solid #DDD5C5' }}
                          onClick={() => applySlideshowInterval(3000)}
                        >
                          Faster
                        </button>
                        <button
                          type="button"
                          className="hush-press rounded-lg py-2 text-xs font-semibold"
                          style={{ background: slideshowIntervalMs === 6000 ? '#254F22' : '#FDFAF5', color: slideshowIntervalMs === 6000 ? '#FDFAF5' : '#254F22', border: '1px solid #DDD5C5' }}
                          onClick={() => applySlideshowInterval(6000)}
                        >
                          Slower
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-medium" style={{ color: '#7C5C3E' }}>Animation</label>
                      <select
                        value={slideshowAnimation}
                        onChange={(e) => {
                          const nextAnimation = e.target.value as SlideshowAnimation
                          setSlideshowAnimation(nextAnimation)
                          onAlbumUpdated({ slideshow_animation: nextAnimation })
                          void saveMediaSettings(mediaRadius, videoAutoplay, mediaFilter, mediaHover, mobileGridColumns, slideshowIntervalMs, nextAnimation)
                        }}
                        className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                        style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
                      >
                        {SLIDESHOW_ANIMATION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>

                    {mediaError && <p className="text-xs" style={{ color: '#C0392B' }}>{mediaError}</p>}
                  </div>
                )}
              </section>

              {/* Files */}
              <section style={settingsSectionStyle}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('files')}>
                  <Download className="w-4 h-4" style={{ color: '#7C5C3E' }} />
                  <span style={sectionTitle}>Files</span>
                  <ChevronDown
                    className="ml-auto w-4 h-4 transition-transform"
                    style={{ color: '#A89880', transform: openSection === 'files' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'files' && (
                  <div className="px-4 pb-4 space-y-3">
                    <button
                      className="w-full flex items-center justify-center gap-2 font-semibold rounded-xl py-3 text-sm transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: '#254F22', color: '#FDFAF5' }}
                      disabled={zipping || photos.length === 0}
                      onClick={downloadZip}
                    >
                      {zipping ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {zipProgress < 100 ? `Downloading ${zipProgress}%…` : 'Creating zip…'}
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4" />
                          Download all ({photos.length})
                        </>
                      )}
                    </button>

                    <label className="flex items-center justify-between gap-4 rounded-xl px-3 py-3" style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', cursor: 'pointer' }}>
                      <span>
                        <span className="block text-sm font-semibold" style={{ color: '#254F22' }}>Allow guest downloads</span>
                        <span className="block text-xs" style={{ color: '#7C5C3E' }}>Guests can download all photos as a zip file.</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={allowGuestDownloads}
                        onChange={async (e) => {
                          const next = e.target.checked
                          setAllowGuestDownloads(next)
                          onAlbumUpdated({ allow_guest_downloads: next })
                          try {
                            const result = await saveGuestDownloadsRequest(album.slug, next)
                            if (!result.ok) {
                              showAppToast(result.error, 'error')
                              setAllowGuestDownloads(!next)
                              onAlbumUpdated({ allow_guest_downloads: !next })
                            }
                          } catch (e) {
                            const message = e instanceof Error ? e.message : 'Network error'
                            showAppToast(message, 'error')
                            setAllowGuestDownloads(!next)
                            onAlbumUpdated({ allow_guest_downloads: !next })
                          }
                        }}
                        className="h-4 w-4"
                      />
                    </label>

                    <label
                      className="flex items-center justify-between gap-4 rounded-xl px-3 py-3"
                      style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', cursor: canUseCollections ? 'pointer' : 'not-allowed', opacity: canUseCollections ? 1 : 0.6 }}
                    >
                      <span>
                        <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#254F22' }}>
                          <ScanFace className="w-4 h-4" />
                          AI Face Finder
                          {!canUseCollections && <span className="text-[10px] font-semibold uppercase" style={{ color: '#7C4A2D', letterSpacing: '0.06em' }}>Studio</span>}
                        </span>
                        <span className="block text-xs" style={{ color: '#7C5C3E' }}>Guests can upload a selfie to find every photo they appear in.</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={faceFinderEnabled}
                        disabled={!canUseCollections}
                        onChange={async (e) => {
                          const next = e.target.checked
                          setFaceFinderEnabled(next)
                          onAlbumUpdated({ face_finder_enabled: next })
                          try {
                            const res = await fetch('/api/album/face-finder', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ slug: album.slug, enabled: next }),
                            })
                            if (!res.ok) {
                              const body = await res.json().catch(() => ({})) as { error?: string }
                              throw new Error(body.error ?? `Save failed (${res.status})`)
                            }
                          } catch (err) {
                            const message = err instanceof Error ? err.message : 'Network error'
                            showAppToast(message, 'error')
                            setFaceFinderEnabled(!next)
                            onAlbumUpdated({ face_finder_enabled: !next })
                          }
                        }}
                        className="h-4 w-4"
                      />
                    </label>
                  </div>
                )}
              </section>

              {/* Custom URL */}
              <section style={settingsSectionStyle}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('customUrl')}>
                  <Link2 className="w-4 h-4" style={{ color: canCustomize ? '#7C5C3E' : '#A89880' }} />
                  <span style={sectionTitle}>Custom URL</span>
                  {!canCustomize && <span className="ml-auto text-[10px] font-semibold uppercase" style={{ color: '#7C4A2D', letterSpacing: '0.06em' }}>Pro</span>}
                  <ChevronDown
                    className={canCustomize ? 'ml-auto w-4 h-4 transition-transform' : 'w-4 h-4 transition-transform'}
                    style={{ color: '#A89880', transform: openSection === 'customUrl' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'customUrl' && (
                  <div className="px-4 pb-4">
                    <p className="text-xs mb-3" style={{ color: '#7C5C3E' }}>
                      Pick a friendly path for this album. Letters, numbers, and hyphens, 3 to 40 characters.
                    </p>
                    <div className="flex items-stretch rounded-lg overflow-hidden" style={{ border: '1px solid #DDD5C5', background: '#FDFAF5', opacity: canCustomize ? 1 : 0.55 }}>
                      <span className="text-xs flex items-center px-2 select-none" style={{ color: '#A89880' }}>hushare.space/</span>
                      <input
                        type="text"
                        value={customUrlInput}
                        onChange={(e) => setCustomUrlInput(e.target.value)}
                        placeholder="anna-and-david"
                        maxLength={40}
                        disabled={!canCustomize}
                        className="flex-1 text-sm px-2 py-2 focus:outline-none disabled:cursor-not-allowed"
                        style={{ background: 'transparent', color: '#254F22' }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && canCustomize && !customUrlSaving && customUrlInput.trim()) void saveCustomUrl('set')
                        }}
                      />
                    </div>
                    {customUrlError && <p className="text-xs mt-2" style={{ color: '#C0392B' }}>{customUrlError}</p>}
                    {customUrlSaved && !customUrlError && <p className="text-xs mt-2" style={{ color: '#254F22' }}>Saved.</p>}
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        onClick={() => void saveCustomUrl('set')}
                        disabled={!canCustomize || customUrlSaving || !customUrlInput.trim()}
                        className="hush-press flex-1 text-sm font-semibold rounded-lg py-2 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: '#254F22', color: '#FDFAF5' }}
                      >
                        {customUrlSaving ? 'Saving...' : 'Save'}
                      </button>
                      {album.custom_slug && (
                        <button
                          onClick={() => void saveCustomUrl('clear')}
                          disabled={!canCustomize || customUrlSaving}
                          className="hush-press text-sm rounded-lg py-2 px-3 transition hover:opacity-90 disabled:opacity-50"
                          style={{ background: '#F5F0E8', color: '#7C5C3E', border: '1px solid #DDD5C5' }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </section>

              {/* Password */}
              <section style={settingsSectionStyle}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('password')}>
                  {album.password_protected ? (
                    <Lock className="w-4 h-4" style={{ color: canCustomize ? '#254F22' : '#A89880' }} />
                  ) : (
                    <LockOpen className="w-4 h-4" style={{ color: canCustomize ? '#7C5C3E' : '#A89880' }} />
                  )}
                  <span style={sectionTitle}>Password</span>
                  {!canCustomize && <span className="ml-auto text-[10px] font-semibold uppercase" style={{ color: '#7C4A2D', letterSpacing: '0.06em' }}>Pro</span>}
                  <ChevronDown
                    className={canCustomize ? 'ml-auto w-4 h-4 transition-transform' : 'w-4 h-4 transition-transform'}
                    style={{ color: '#A89880', transform: openSection === 'password' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'password' && (
                  <div className="px-4 pb-4">
                    <p className="text-xs mb-3" style={{ color: '#7C5C3E' }}>
                      Visitors will need this password to view the album. 4-128 characters.
                    </p>
                    <input type="text" name="username" autoComplete="username" value={ownerUrl ?? ''} readOnly hidden />
                    <input
                      key={passwordInputKey}
                      type={passwordInput ? 'password' : 'text'}
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      placeholder={album.password_protected ? 'New password' : 'Password'}
                      maxLength={128}
                      disabled={!canCustomize}
                      autoComplete="new-password"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      name={`hush-album-password-${album.id}`}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                      style={inputStyle}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && canCustomize && !passwordSaving && passwordInput) void savePassword('set')
                      }}
                    />
                    {passwordError && <p className="text-xs mt-2" style={{ color: '#C0392B' }}>{passwordError}</p>}
                    {passwordSaved && !passwordError && <p className="text-xs mt-2" style={{ color: '#254F22' }}>Saved.</p>}
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        onClick={() => void savePassword('set')}
                        disabled={!canCustomize || passwordSaving || !passwordInput}
                        className="hush-press flex-1 text-sm font-semibold rounded-lg py-2 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: '#254F22', color: '#FDFAF5' }}
                      >
                        {passwordSaving ? 'Saving...' : 'Save'}
                      </button>
                      {album.password_protected && (
                        <button
                          onClick={() => void savePassword('clear')}
                          disabled={!canCustomize || passwordSaving}
                          className="hush-press text-sm rounded-lg py-2 px-3 transition hover:opacity-90 disabled:opacity-50"
                          style={{ background: '#F5F0E8', color: '#7C5C3E', border: '1px solid #DDD5C5' }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </section>

              {/* Collections */}
              <section style={settingsSectionStyle}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('collection')}>
                  <FolderPlus className="w-4 h-4" style={{ color: canUseCollections ? '#7C5C3E' : '#A89880' }} />
                  <span style={sectionTitle}>Collections</span>
                  {!canUseCollections && <span className="ml-auto text-[10px] font-semibold uppercase" style={{ color: '#7C4A2D', letterSpacing: '0.06em' }}>Max</span>}
                  <ChevronDown
                    className={canUseCollections ? 'ml-auto w-4 h-4 transition-transform' : 'w-4 h-4 transition-transform'}
                    style={{ color: '#A89880', transform: openSection === 'collection' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'collection' && (
                  <div className="px-4 pb-4">
                    <p className="text-xs mb-3" style={{ color: '#7C5C3E' }}>
                      Add this album to a collection. Create new collections in your account.
                    </p>

                    {canUseCollections && (
                      <div className="mb-4 rounded-xl p-3" style={{ background: '#FDFAF5', border: '1px solid #E8E0D2' }}>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: '#8B6F4E' }}>Your collections</span>
                          {collectionsLoading && <span className="text-xs" style={{ color: '#A89880' }}>Loading...</span>}
                        </div>
                        <div className="space-y-2">
                          {collections.map((collection) => (
                            <button
                              key={collection.id}
                              type="button"
                              onClick={() => void addAlbumToCollection(collection.id)}
                              disabled={collectionSaving || collection.contains_album}
                              className="hush-press flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
                              style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', color: '#254F22' }}
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-semibold">{collection.name}</span>
                                <span className="block truncate" style={{ color: '#8B6F4E' }}>
                                  /c/{collection.slug} - {collection.album_count} album{collection.album_count === 1 ? '' : 's'}
                                </span>
                              </span>
                              <span className="shrink-0 font-semibold" style={{ color: collection.contains_album ? '#254F22' : '#7C5C3E' }}>
                                {collection.contains_album ? 'Added' : 'Add'}
                              </span>
                            </button>
                          ))}
                          {!collectionsLoading && collections.length === 0 && (
                            <p className="text-xs" style={{ color: '#8B6F4E' }}>No collections yet. Create one in your account.</p>
                          )}
                        </div>
                      </div>
                    )}

                    {collectionError && <p className="text-xs mt-2" style={{ color: '#C0392B' }}>{collectionError}</p>}
                    {collectionUrl && (
                      <p className="text-xs mt-2 break-all" style={{ color: '#254F22' }}>
                        Added: <a href={collectionUrl} className="underline">{collectionUrl}</a>
                      </p>
                    )}
                  </div>
                )}
              </section>

              {/* Delayed reveal */}
              <section style={settingsSectionStyle}>
                {(() => {
                  const now = new Date()
                  const revealIsFuture = !!(album.reveal_at && new Date(album.reveal_at) > now)
                  return (
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('reveal')}>
                  <Clock className="w-4 h-4" style={{ color: revealIsFuture ? '#254F22' : '#7C5C3E' }} />
                  <span style={sectionTitle}>Delayed reveal</span>
                  {revealIsFuture && (
                    <span
                      className="ml-auto text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                      style={{ background: 'rgba(37,79,34,0.10)', color: '#254F22' }}
                    >
                      Active
                    </span>
                  )}
                  <ChevronDown
                    className={`${revealIsFuture ? '' : 'ml-auto'} w-4 h-4 transition-transform`}
                    style={{ color: '#A89880', transform: openSection === 'reveal' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                  )
                })()}
                {openSection === 'reveal' && (() => {
                  const nowForPanel = new Date()
                  return (
                  <div className="px-4 pb-4 space-y-3">
                    {album.reveal_at && (() => {
                      const revealDate = new Date(album.reveal_at)
                      const isFuture = revealDate > nowForPanel
                      return (
                        <div
                          className="flex items-start gap-2.5 rounded-xl px-3 py-2.5"
                          style={{
                            background: isFuture ? 'rgba(37,79,34,0.07)' : 'rgba(139,111,78,0.09)',
                            border: `1px solid ${isFuture ? 'rgba(37,79,34,0.18)' : 'rgba(139,111,78,0.22)'}`,
                          }}
                        >
                          <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: isFuture ? '#254F22' : '#8B6F4E' }} />
                          <div>
                            <p className="text-[11px] font-semibold leading-none mb-1" style={{ color: isFuture ? '#254F22' : '#8B6F4E' }}>
                              {isFuture ? 'Unlocks on' : 'Already revealed'}
                            </p>
                            <p className="text-xs" style={{ color: '#5C4A3C' }}>
                              {revealDate.toLocaleString([], {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                        </div>
                      )
                    })()}

                    <div>
                      <p className="text-[11px] font-medium mb-1.5" style={{ color: '#8B6F4E' }}>
                        {album.reveal_at ? 'Change time' : 'Photos unlock for guests at'}
                      </p>
                      <RevealDatePicker
                        value={revealInput}
                        onChange={(v) => { setRevealInput(v); setRevealSaved(false) }}
                      />
                    </div>

                    {revealError && <p className="text-xs" style={{ color: '#C0392B' }}>{revealError}</p>}

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void saveReveal('set')}
                        disabled={revealSaving || !revealInput}
                        className="hush-press flex-1 text-sm font-semibold rounded-lg py-2 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: '#254F22', color: '#FDFAF5' }}
                      >
                        {revealSaving ? 'Saving…' : revealSaved ? '✓ Saved' : 'Save'}
                      </button>
                      {album.reveal_at && (
                        <button
                          onClick={() => void saveReveal('clear')}
                          disabled={revealSaving}
                          className="hush-press text-sm rounded-lg py-2 px-3 transition hover:opacity-80 disabled:opacity-50"
                          style={{ background: 'transparent', color: '#8B6F4E', border: '1px solid #DDD5C5' }}
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    {!album.reveal_at && (
                      <p className="text-[11px] leading-relaxed" style={{ color: '#A89880' }}>
                        You can always view the album with your owner link.
                      </p>
                    )}
                  </div>
                  )
                })()}
              </section>

              {/* Delete album */}
              <section style={{ ...settingsSectionStyle, marginBottom: 0 }}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('danger')}>
                  <Trash2 className="w-4 h-4" style={{ color: '#C0392B' }} />
                  <span style={sectionTitle}>Delete album</span>
                  <ChevronDown
                    className="ml-auto w-4 h-4 transition-transform"
                    style={{ color: '#A89880', transform: openSection === 'danger' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'danger' && (
                  <div className="px-4 pb-4">
                    <div className={`hush-delete-dialog hush-delete-panel rounded-xl p-3 ${deleteConfirm ? 'hush-delete-dialog-open' : ''}`} style={{ background: '#FFF7F4', border: '1px solid rgba(192,57,43,0.25)' }}>
                      <p className="text-xs leading-relaxed mb-3" style={{ color: '#7A2A1F' }}>
                        Delete this album, its photos and videos, and remove it from collections.
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={() => void deleteAlbum()}
                          disabled={deletingAlbum}
                          className="hush-press flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                          style={{ background: deleteConfirm ? '#C0392B' : '#FFFFFF', border: '1px solid #C0392B', color: deleteConfirm ? '#FFFFFF' : '#C0392B' }}
                        >
                          <Trash2 className="w-4 h-4" />
                          {deletingAlbum ? 'Deleting...' : deleteConfirm ? 'Delete permanently' : 'Delete album'}
                        </button>
                        {deleteConfirm && (
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteConfirm(false)
                              setDeleteError('')
                            }}
                            className="hush-press rounded-lg px-3 py-2 text-sm font-semibold transition hover:opacity-90"
                            style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', color: '#7C5C3E' }}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                      {deleteConfirm && !deleteError && (
                        <p className="mt-2 text-xs" style={{ color: '#7A2A1F' }}>
                          Click again to confirm. This cannot be undone.
                        </p>
                      )}
                      {deleteError && <p className="mt-2 text-xs" style={{ color: '#C0392B' }}>{deleteError}</p>}
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>

      {showBackgroundLibrary && (
        <BackgroundLibraryModal
          backgroundSaving={backgroundSaving}
          bgChoice={bgChoice}
          onChoose={chooseBackground}
          onClose={() => setShowBackgroundLibrary(false)}
        />
      )}
    </div>
    </>
  )
}
