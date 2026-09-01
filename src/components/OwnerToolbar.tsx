'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '@/i18n/LocaleProvider'
import { tierAllows, showsAsLocked } from '@/lib/plan-gates'
import { useZipDownload } from '@/components/photo-grid/useZipDownload'
import { Search, ChevronDown, Clock, Copy, Download, FolderPlus, Images, Link2, Loader2, Lock, LockOpen, MonitorPlay, Move, Play, ScanFace, Settings, ShieldCheck, Trash2, X } from 'lucide-react'
import type { Album, Photo, Tier } from '@/types'
import {
  DEFAULT_SLIDESHOW_INTERVAL_MS,
  MAX_SLIDESHOW_INTERVAL_MS,
  MIN_SLIDESHOW_INTERVAL_MS,
  MEDIA_DISPLAY_FILTER_OPTIONS,
  MOBILE_GRID_COLUMN_OPTIONS,
  type MediaDisplayFilter,
  type MobileGridColumns,
  type SlideshowAnimation,
} from '@/lib/media-display'
import { DESKTOP_COLUMN_CHOICES, resolveGridColumns } from '@/lib/grid-columns'
import { confirmedMediaSettings, diffMediaSettings } from '@/lib/media-settings-diff'
import {
  DEFAULT_SLIDESHOW_MOTION,
  MAX_SLIDESHOW_DURATION_MS,
  MIN_SLIDESHOW_DURATION_MS,
  SLIDESHOW_DIRECTIONS,
  SLIDESHOW_EASINGS,
  SLIDESHOW_MOVES,
  resolveSlideshowMotion,
  slideshowMotionIsStill,
  slideshowMotionVars,
} from '@/lib/slideshow-motion'
import type { SlideshowMotion } from '@/types'
import { showAppToast, storeAppToast } from '@/components/AppToast'
import RevealDatePicker from '@/components/RevealDatePicker'
import ShareMenu from '@/components/owner-toolbar/ShareMenu'
import {
  addAlbumToCollectionRequest,
  deleteAlbumRequest,
  fetchCollections,
  saveCustomUrlRequest,
  saveGuestDownloadsRequest,
  saveGuestUploadsRequest,
  saveRequireApprovalRequest,
  savePhotoLayoutRequest,
  saveMediaSettingsRequest,
  type MediaSettingsChanges,
  saveDesktopGridColumns,
  savePasswordRequest,
  saveSlideshowMotionRequest,
} from '@/components/owner-toolbar/api'
import { accordionButton, btnBase, inputStyle, sectionTitle, settingsSectionStyle } from '@/components/owner-toolbar/styles'
import type { CollectionSummary, SettingsSection } from '@/components/owner-toolbar/types'
import PlanBadge, { gatedRowStyle } from '@/components/PlanBadge'

type Props = {
  album: Album
  photos: Photo[]
  // The album's TRUE size. `photos` is only the loaded window (500, then a page per scroll), so
  // the button read "Download all (500)" on a 4,566-photo album — while the download itself
  // correctly fetched every row. A wrong number on the owner's primary action.
  albumPhotoCount?: number
  ownerToken: string | null
  // null while the tier is still resolving — see the note in AlbumPageClient. Rendering a paid
  // feature as locked before the answer arrives is a lie the owner sees and remembers.
  userTier: Tier | null
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
  onOpenDesigner?: () => void
}

// ownerToken is kept in props only to build the owner share URL (the #owner=… link
// that recipients use to log in on a new device). It is NOT passed to any API call —
// all owner mutations use the HttpOnly hushare_owner_* cookie set by /api/album/owner-login.

// One labelled slider. Six of them make up the slideshow transition, and repeating the markup six
// times is how they drift apart.
function MotionSlider({ label, value, display, min, max, step, onChange }: {
  label: string; value: number; display: string; min: number; max: number; step: number
  onChange: (value: number) => void
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label className="text-xs font-medium" style={{ color: '#7C5C3E' }}>{label}</label>
        <span className="text-xs font-mono" style={{ color: '#A89880' }}>{display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  )
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function OwnerToolbar({ album, photos, albumPhotoCount, ownerToken, userTier, mediaRadiusMax, onAlbumUpdated, onOpenSlideshow, arrangeMode, onToggleArrangeMode, onOpenDesigner }: Props) {
  const { t } = useT()
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

  const [mediaRadius, setMediaRadius] = useState(album.media_radius ?? 16)
  const [mediaRadiusDraft, setMediaRadiusDraft] = useState(String(album.media_radius ?? 16))
  const [mediaRadiusEditing, setMediaRadiusEditing] = useState(false)
  const [savedMediaRadius, setSavedMediaRadius] = useState(album.media_radius ?? 16)
  const [videoAutoplay, setVideoAutoplay] = useState(!!album.video_autoplay)
  const [photoLayout, setPhotoLayout] = useState<'grid' | 'justified'>(album.photo_layout === 'justified' ? 'justified' : 'grid')
  const [mediaFilter, setMediaFilter] = useState<MediaDisplayFilter>(album.media_filter ?? 'none')
  const [savedMediaFilter, setSavedMediaFilter] = useState<MediaDisplayFilter>(album.media_filter ?? 'none')
  const [mobileGridColumns, setMobileGridColumns] = useState<MobileGridColumns>((resolveGridColumns(album).mobile) as MobileGridColumns)
  const [desktopGridColumns, setDesktopGridColumns] = useState<number>(resolveGridColumns(album).desktop)
  const [slideshowIntervalMs, setSlideshowIntervalMs] = useState(album.slideshow_interval_ms ?? DEFAULT_SLIDESHOW_INTERVAL_MS)
  const [slideshowAnimation, setSlideshowAnimation] = useState<SlideshowAnimation>(album.slideshow_animation ?? 'fade')
  // The composed transition. Seeded from the album's own motion, or derived from the legacy preset
  // for an album that has never been touched — either way there is one value to edit from here on.
  const [slideshowMotion, setSlideshowMotion] = useState<SlideshowMotion>(() => resolveSlideshowMotion(album))
  const [motionPreviewKey, setMotionPreviewKey] = useState(0)
  const motionSaveTimerRef = useRef<number | null>(null)
  const [mediaError, setMediaError] = useState('')
  // True from the moment a slider edit is scheduled until its save settles. The resync effect
  // below must not stomp local state in that window — that stomp is how an unsaved phone-grid
  // value got replaced by the album prop and then persisted by the next unrelated save.
  const mediaEditPendingRef = useRef(false)

  const [revealInput, setRevealInput] = useState(() => toDatetimeLocal(album.reveal_at ?? null))
  const [revealSaving, setRevealSaving] = useState(false)
  const [revealError, setRevealError] = useState('')
  const [revealSaved, setRevealSaved] = useState(false)

  const { zipping, zipProgress, zipStatus, downloadZip } = useZipDownload(photos, album)

  const [allowGuestDownloads, setAllowGuestDownloads] = useState(album.allow_guest_downloads !== false)
  const [guestUploadsEnabled, setGuestUploadsEnabled] = useState(album.guest_uploads_enabled !== false)
  const [hideBranding, setHideBranding] = useState(!!album.hide_branding)
  const [requireApproval, setRequireApproval] = useState(!!album.require_approval)
  const [faceFinderEnabled, setFaceFinderEnabled] = useState(!!album.face_finder_enabled)
  // Switching face search ON is the one control here that creates biometric data, so it is the one
  // control that asks first. Turning it OFF stays a single tap — nobody should have to read a
  // dialog to stop processing.
  const [faceConsentOpen, setFaceConsentOpen] = useState(false)
  const [consentCopied, setConsentCopied] = useState(false)

  const applyFaceFinder = async (next: boolean) => {
    setFaceFinderEnabled(next)
    onAlbumUpdated({ face_finder_enabled: next })
    try {
      const res = await fetch('/api/album/face-finder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The server refuses an enable without this, so the dialog cannot be skipped by anyone
        // calling the endpoint directly.
        body: JSON.stringify({ slug: album.slug, enabled: next, consent: next ? true : undefined }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `Save failed (${res.status})`)
      }
    } catch (err) {
      showAppToast(err instanceof Error ? err.message : t('common.networkError'), 'error')
      setFaceFinderEnabled(!next)
      onAlbumUpdated({ face_finder_enabled: !next })
    }
  }

  const [bibSearchEnabled, setBibSearchEnabled] = useState(!!album.bib_search_enabled)

  const shareRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)

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
  // custom_slug first: it is the album's canonical address, so the management link the owner keeps
  // (and re-opens for months) should already be the URL the album actually lives at.
  const ownerUrl = effectiveOwnerToken && origin ? `${origin}/${album.custom_slug ?? album.slug}#owner=${effectiveOwnerToken}` : null
  // A real photo from the album in the transition preview, so the owner judges the motion against
  // what they will actually be watching rather than a grey rectangle.
  const motionPreviewThumb = photos.find((p) => p.media_type !== 'video')?.thumb_url
    ?? photos[0]?.poster_url ?? photos[0]?.thumb_url ?? ''
  // EACH CONTROL ASKS ABOUT ITS OWN FEATURE, by name, against lib/plan-gates.ts — the same table
  // every server route is held to in tests/plan-gates.test.ts.
  //
  // These used to be two booleans, canCustomize and canUseCollections, shared across unrelated
  // controls because those controls happen to sit at the same tier TODAY. That is fine right up
  // until one of them moves: repackaging the album logo as Max would silently take photo
  // moderation and the custom URL with it, and the only signal would be a customer saying that
  // something they pay for stopped working. Naming the feature lets each row move alone.
  //
  // showsAsLocked rather than plain "not allowed": while the tier is still being looked up the row
  // renders PLAIN and inert. A PRO badge appearing on something the owner pays for and then
  // vanishing is worse than a few hundred milliseconds of a control that does nothing.
  const canSetCustomUrl = tierAllows(userTier, 'customUrl')
  const canModeratePhotos = tierAllows(userTier, 'photoModeration')
  const canUseCollections = tierAllows(userTier, 'collections')
  const showLockedCustomUrl = showsAsLocked(userTier, 'customUrl')
  const showLockedModeration = showsAsLocked(userTier, 'photoModeration')
  // APPROVAL ONLY MEANS SOMETHING WHILE GUESTS CAN ADD PHOTOS.
  //
  // With uploads off, nothing can ever arrive to be approved, so the switch below governs an empty
  // set — it looks live, it saves, and it changes nothing anybody will ever see. Greying it out
  // says that in the only way a control can: by not pretending to work.
  //
  // It is only DISABLED, never switched off. The stored value is left exactly as it was, so
  // turning guest uploads back on restores the album's real moderation setting rather than
  // silently publishing the next guest photo straight into a wedding album.
  const moderationIsMoot = !guestUploadsEnabled
  const moderationDisabled = !canModeratePhotos || moderationIsMoot
  const showLockedCollections = showsAsLocked(userTier, 'collections')
  // Branding removal is gated by api/album/branding, and it had NO badge and NO dimming — a free
  // owner saw an ordinary switch, flipped it, and learned it was paid from the error that came
  // back. The row simply never asked.
  const showLockedBranding = showsAsLocked(userTier, 'hideBranding')
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
      // MID-EDIT, THE PROP LOSES. This resync exists so another device's changes appear, but
      // while an edit is pending here the album prop is by definition older than the owner's
      // intent — resetting from it clobbered the value they just chose, and the next save of
      // any OTHER setting then persisted the clobber (the phone/desktop grid "merge").
      if (mediaEditPendingRef.current) return
      setMediaRadius(album.media_radius ?? 16)
      setMediaRadiusDraft(String(album.media_radius ?? 16))
      setMediaRadiusEditing(false)
      setSavedMediaRadius(album.media_radius ?? 16)
      setVideoAutoplay(!!album.video_autoplay)
      setPhotoLayout(album.photo_layout === 'justified' ? 'justified' : 'grid')
      setAllowGuestDownloads(album.allow_guest_downloads !== false)
      setGuestUploadsEnabled(album.guest_uploads_enabled !== false)
      setHideBranding(!!album.hide_branding)
      setRequireApproval(!!album.require_approval)
      setFaceFinderEnabled(!!album.face_finder_enabled)
      setMediaFilter(album.media_filter ?? 'none')
      setSavedMediaFilter(album.media_filter ?? 'none')
      setMobileGridColumns(resolveGridColumns(album).mobile as MobileGridColumns)
      setDesktopGridColumns(resolveGridColumns(album).desktop)
      setSlideshowIntervalMs(album.slideshow_interval_ms ?? DEFAULT_SLIDESHOW_INTERVAL_MS)
      setSlideshowAnimation(album.slideshow_animation ?? 'fade')
      setSlideshowMotion(resolveSlideshowMotion({
        slideshow_motion: album.slideshow_motion,
        slideshow_animation: album.slideshow_animation,
      }))
      setMediaError('')
      setRevealInput(toDatetimeLocal(album.reveal_at ?? null))
      setRevealError('')
      setRevealSaved(false)
      setOpenSection(null)
      setDeleteConfirm(false)
      setDeleteError('')
    }
  }, [album.allow_guest_downloads, album.guest_uploads_enabled, album.custom_slug, album.media_filter, album.media_radius, album.mobile_grid_columns, album.desktop_grid_columns, album.reveal_at, album.slideshow_animation, album.slideshow_motion, album.slideshow_interval_ms, album.video_autoplay, showSettings])

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
      showAppToast(type === 'share' ? t('ot.shareLinkCopied') : t('ot.ownerLinkCopied'))
      setTimeout(() => setCopied(null), 2000)
    } catch {
      showAppToast(t('ot.copyFail'), 'error')
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
      showAppToast(action === 'clear' ? t('ot.customUrlCleared') : t('ot.customUrlSaved'))
      if (action === 'clear') setCustomUrlInput('')
    } catch (e) {
      const message = e instanceof Error ? e.message : t('common.networkError')
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
      const message = e instanceof Error ? e.message : t('common.networkError')
      setPasswordError(message)
      showAppToast(message, 'error')
    } finally {
      setPasswordSaving(false)
    }
  }

  async function saveMediaSettings(
    nextRadius = mediaRadius,
    nextAutoplay = videoAutoplay,
    nextFilter = mediaFilter,
    nextMobileGridColumns = mobileGridColumns,
    nextSlideshowIntervalMs = slideshowIntervalMs,
    nextSlideshowAnimation = slideshowAnimation,
  ) {
    setMediaError('')
    mediaEditPendingRef.current = true
    try {
      // Only what differs from the album's CONFIRMED values goes on the wire — the decision
      // lives in lib/media-settings-diff, where its tests hold the grid "merge" bug shut.
      const changes = diffMediaSettings(
        confirmedMediaSettings(album, DEFAULT_SLIDESHOW_INTERVAL_MS),
        {
          media_radius: nextRadius,
          video_autoplay: nextAutoplay,
          media_filter: nextFilter,
          mobile_grid_columns: nextMobileGridColumns,
          slideshow_interval_ms: nextSlideshowIntervalMs,
          slideshow_animation: nextSlideshowAnimation,
        },
      ) as MediaSettingsChanges

      const resetRadiusOverrides = nextRadius !== savedMediaRadius
      const resetFilterOverrides = nextFilter !== savedMediaFilter
      if (Object.keys(changes).length === 0 && !resetRadiusOverrides && !resetFilterOverrides) {
        return
      }

      const result = await saveMediaSettingsRequest(album.slug, changes, resetRadiusOverrides, resetFilterOverrides)
      if (!result.ok) {
        setMediaError(result.error)
        showAppToast(result.error, 'error')
        return
      }
      const a = result.applied
      if (a.media_radius !== undefined) { setMediaRadius(a.media_radius); setSavedMediaRadius(a.media_radius) }
      if (a.video_autoplay !== undefined) setVideoAutoplay(a.video_autoplay)
      if (a.media_filter !== undefined) { setMediaFilter(a.media_filter); setSavedMediaFilter(a.media_filter) }
      if (a.mobile_grid_columns !== undefined) setMobileGridColumns(a.mobile_grid_columns)
      if (a.slideshow_interval_ms !== undefined) setSlideshowIntervalMs(a.slideshow_interval_ms)
      if (a.slideshow_animation !== undefined) setSlideshowAnimation(a.slideshow_animation)
      // The album prop learns only the applied fields, so an untouched setting can never be
      // "updated" to a stale copy of itself.
      if (Object.keys(a).length > 0) {
        onAlbumUpdated(a, { forceGlobalRadius: false, resetRadiusOverrides, resetFilterOverrides })
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : t('common.networkError')
      setMediaError(message)
      showAppToast(message, 'error')
    } finally {
      // Settled either way: the album prop now carries the truth (or the edit failed and the
      // owner was told), so the resync effect may speak again.
      mediaEditPendingRef.current = false
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
    nextMobileGridColumns: MobileGridColumns,
    nextSlideshowIntervalMs: number,
    nextSlideshowAnimation: SlideshowAnimation,
  ) {
    mediaEditPendingRef.current = true
    if (debouncedSaveRef.current !== null) {
      window.clearTimeout(debouncedSaveRef.current)
    }
    debouncedSaveRef.current = window.setTimeout(() => {
      debouncedSaveRef.current = null
      void saveMediaSettings(
        nextRadius,
        nextAutoplay,
        nextFilter,
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
    scheduleAutoSave(nextRadius, videoAutoplay, mediaFilter, mobileGridColumns, slideshowIntervalMs, slideshowAnimation)
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

  // Change one axis of the transition. Applies instantly (and replays the preview so the change is
  // felt, not just read), saves debounced — a slider drag is dozens of values a second and every
  // one of them would otherwise be its own rate-limited write.
  function applySlideshowMotion(patch: Partial<SlideshowMotion>) {
    const next = { ...slideshowMotion, ...patch }
    setSlideshowMotion(next)
    setMotionPreviewKey((k) => k + 1)
    onAlbumUpdated({ slideshow_motion: next })
    if (motionSaveTimerRef.current !== null) window.clearTimeout(motionSaveTimerRef.current)
    motionSaveTimerRef.current = window.setTimeout(() => {
      motionSaveTimerRef.current = null
      void saveSlideshowMotionRequest(album.slug, next).then((r) => {
        if (!r.ok) showAppToast(r.error, 'error')
      })
    }, 500)
  }
  useEffect(() => () => {
    if (motionSaveTimerRef.current !== null) window.clearTimeout(motionSaveTimerRef.current)
  }, [])

  function applySlideshowInterval(value: number) {
    const nextInterval = Math.max(MIN_SLIDESHOW_INTERVAL_MS, Math.min(MAX_SLIDESHOW_INTERVAL_MS, Math.round(value)))
    setSlideshowIntervalMs(nextInterval)
    onAlbumUpdated({ slideshow_interval_ms: nextInterval })
    scheduleAutoSave(mediaRadius, videoAutoplay, mediaFilter, mobileGridColumns, nextInterval, slideshowAnimation)
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
      showAppToast(t('ot.addedToCollection'))
    } catch (e) {
      const message = e instanceof Error ? e.message : t('common.networkError')
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
      storeAppToast(t('ot.albumDeleted'))
      window.location.href = '/'
    } catch (e) {
      const message = e instanceof Error ? e.message : t('common.networkError')
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
        const message = result.error ?? t('ot.revealSaveFail')
        setRevealError(message)
        showAppToast(message, 'error')
        return
      }
      onAlbumUpdated({ reveal_at: result.reveal_at ?? null })
      setRevealInput(toDatetimeLocal(result.reveal_at ?? null))
      setRevealSaved(true)
      showAppToast(action === 'clear' ? t('ot.revealCleared') : t('ot.revealSaved'))
    } catch (e) {
      const message = e instanceof Error ? e.message : t('common.networkError')
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
            {t('ot.share')}
          </button>

          {showShare && (
            <ShareMenu
              copied={copied}
              ownerUrl={ownerUrl}
              shareUrl={shareUrl}
              albumTitle={album.title ?? 'Album'}
              accentColor={album.accent_color}
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
              showAppToast(t('ot.slideshowNeedsPhotos'), 'error')
              return
            }
            setShowShare(false)
            setShowSettings(false)
            onOpenSlideshow()
          }}
          title={t('ot.createSlideshow')}
        >
          <Play className="w-4 h-4" style={{ color: '#7C5C3E' }} />
          {t('ot.slideshow')}
        </button>

        <button
          className="hush-press hush-owner-action"
          style={btnBase}
          onClick={() => {
            setShowShare(false)
            setShowSettings(false)
            window.open(`/wall/${album.custom_slug ?? album.slug}`, '_blank', 'noopener')
          }}
          title={t('ot.liveWallTitle')}
        >
          <MonitorPlay className="w-4 h-4" style={{ color: '#7C5C3E' }} />
          {t('ot.liveWall')} <PlanBadge need="studio" tier={userTier} />
        </button>

        <button
          className="hush-press hush-owner-action hush-owner-arrange-action"
          style={{ ...btnBase, background: arrangeMode ? '#630826' : btnBase.background, color: arrangeMode ? '#FDFAF5' : btnBase.color }}
          onClick={() => {
            setShowShare(false)
            setShowSettings(false)
            onToggleArrangeMode()
          }}
          title={t('ot.arrangeMedia')}
        >
          <Move className="w-4 h-4" style={{ color: arrangeMode ? '#FDFAF5' : '#7C5C3E' }} />
          {arrangeMode ? t('ot.done') : t('ot.arrange')}
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
            title={t('ot.settingsTitle')}
          >
            <Settings className="w-4 h-4" style={{ color: '#7C5C3E' }} />
            Settings
          </button>

          {showSettings && (
            <div
              className="hush-menu-pop hush-owner-sheet absolute right-0 top-full mt-2 z-50 rounded-2xl shadow-xl max-h-[78vh] overflow-y-auto"
              style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', width: 'min(94vw, 480px)', padding: 12 }}
            >
              <div className="flex items-start justify-between gap-4 rounded-xl px-3 py-3 mb-3" style={{ background: '#FFFFFF', border: '1px solid #E8E0D2' }}>
                <div>
                  <span className="block font-semibold text-sm" style={{ color: '#630826' }}>{t('ot.settings')}</span>
                  <span className="block text-xs mt-1" style={{ color: '#8B6F4E' }}>
                    {t('ot.settingsSub')}
                  </span>
                </div>
                <button onClick={() => setShowSettings(false)} className="shrink-0 rounded-full p-1 transition hover:opacity-80" style={{ color: '#A89880', cursor: 'pointer', background: '#F5F0E8' }} aria-label={t('ot.closeSettings')}>
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Customization */}
              <section style={settingsSectionStyle}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => onOpenDesigner?.()}>
                  <Images className="w-4 h-4" style={{ color: '#7C5C3E' }} />
                  <span style={sectionTitle}>{t('ot.customization')}</span>
                </button>

              </section>

              {/* Media display */}
              <section style={settingsSectionStyle}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('media')}>
                  <Settings className="w-4 h-4" style={{ color: '#7C5C3E' }} />
                  <span style={sectionTitle}>{t('ot.mediaDisplay')}</span>
                  <ChevronDown
                    className="ml-auto w-4 h-4 transition-transform"
                    style={{ color: '#A89880', transform: openSection === 'media' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'media' && (
                  <div className="px-4 pb-4 space-y-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <label className="text-xs font-medium" style={{ color: '#7C5C3E' }}>{t('ot.cornerRadius')}</label>
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
                        style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#630826' }}
                      />
                    </div>

                    <label className="flex items-center justify-between gap-4 rounded-xl px-3 py-3" style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', cursor: 'pointer' }}>
                      <span>
                        <span className="block text-sm font-semibold" style={{ color: '#630826' }}>{t('ot.videoAutoplay')}</span>
                        <span className="block text-xs" style={{ color: '#7C5C3E' }}>{t('ot.videoAutoplaySub')}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={videoAutoplay}
                        onChange={(e) => {
                          const nextAutoplay = e.target.checked
                          setVideoAutoplay(nextAutoplay)
                          onAlbumUpdated({ video_autoplay: nextAutoplay })
                          if (debouncedSaveRef.current !== null) { window.clearTimeout(debouncedSaveRef.current); debouncedSaveRef.current = null }
                          void saveMediaSettings(mediaRadius, nextAutoplay, mediaFilter, mobileGridColumns, slideshowIntervalMs, slideshowAnimation)
                        }}
                        className="h-4 w-4"
                      />
                    </label>

                    <div>
                      <label className="mb-2 block text-xs font-medium" style={{ color: '#7C5C3E' }}>{t('ot.globalFilter')}</label>
                      <select
                        value={mediaFilter}
                        onChange={(e) => {
                          const nextFilter = e.target.value as MediaDisplayFilter
                          setMediaFilter(nextFilter)
                          onAlbumUpdated({ media_filter: nextFilter })
                          if (debouncedSaveRef.current !== null) { window.clearTimeout(debouncedSaveRef.current); debouncedSaveRef.current = null }
                          void saveMediaSettings(mediaRadius, videoAutoplay, nextFilter, mobileGridColumns, slideshowIntervalMs, slideshowAnimation)
                        }}
                        className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                        style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#630826' }}
                      >
                        {MEDIA_DISPLAY_FILTER_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-medium" style={{ color: '#7C5C3E' }}>{t('ot.gridPhone')}</label>
                      <div className="grid grid-cols-5 gap-2">
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
                                void saveMediaSettings(mediaRadius, videoAutoplay, mediaFilter, option.value, slideshowIntervalMs, slideshowAnimation)
                              }}
                              className="hush-press rounded-lg py-2 text-sm font-semibold"
                              style={{
                                background: selected ? '#630826' : '#FDFAF5',
                                border: '1px solid #DDD5C5',
                                color: selected ? '#FDFAF5' : '#630826',
                              }}
                            >
                              {option.value}
                            </button>
                          )
                        })}
                      </div>
                      <label className="mb-2 mt-4 block text-xs font-medium" style={{ color: '#7C5C3E' }}>{t('ot.gridDesktop')}</label>
                      <div className="grid grid-cols-3 gap-2">
                        {DESKTOP_COLUMN_CHOICES.map((value) => {
                          const selected = desktopGridColumns === value
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => {
                                // Saved on its own (see saveDesktopGridColumns): this value is
                                // independent of the seven the debounced media save carries.
                                setDesktopGridColumns(value)
                                onAlbumUpdated({ desktop_grid_columns: value })
                                void saveDesktopGridColumns(album.slug, value).then((r) => {
                                  if (!r.ok) {
                                    setMediaError(r.error)
                                    showAppToast(r.error, 'error')
                                    // Put the buttons back where the SERVER still is, rather than
                                    // leaving a selected column the album does not actually have.
                                    setDesktopGridColumns(resolveGridColumns(album).desktop)
                                    onAlbumUpdated({ desktop_grid_columns: album.desktop_grid_columns ?? null })
                                  }
                                })
                              }}
                              className="hush-press rounded-lg py-2 text-sm font-semibold"
                              style={{
                                background: selected ? '#630826' : '#FDFAF5',
                                border: '1px solid #DDD5C5',
                                color: selected ? '#FDFAF5' : '#630826',
                              }}
                            >
                              {value}
                            </button>
                          )
                        })}
                      </div>
                      <p className="mt-2 text-xs" style={{ color: '#8B6F4E' }}>
                        {t('ot.gridSub')}
                      </p>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-medium" style={{ color: '#7C5C3E' }}>{t('ot.layout')}</label>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          { value: 'grid' as const, label: t('ot.square') },
                          { value: 'justified' as const, label: t('ot.masonry') },
                        ]).map((option) => {
                          const selected = photoLayout === option.value
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => {
                                setPhotoLayout(option.value)
                                onAlbumUpdated({ photo_layout: option.value })
                                void savePhotoLayoutRequest(album.slug, option.value).then((r) => {
                                  if (!r.ok) showAppToast(r.error, 'error')
                                })
                              }}
                              className="hush-press rounded-lg py-2 text-sm font-semibold"
                              style={{
                                background: selected ? '#630826' : '#FDFAF5',
                                border: '1px solid #DDD5C5',
                                color: selected ? '#FDFAF5' : '#630826',
                              }}
                            >
                              {option.label}
                            </button>
                          )
                        })}
                      </div>
                      <p className="mt-2 text-xs" style={{ color: '#8B6F4E' }}>
                        {t('ot.layoutSub')}
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
                  <span style={sectionTitle}>{t('ot.slideshowSettings')}</span>
                  <ChevronDown
                    className="ml-auto w-4 h-4 transition-transform"
                    style={{ color: '#A89880', transform: openSection === 'slideshow' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'slideshow' && (
                  <div className="px-4 pb-4 space-y-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <label className="text-xs font-medium" style={{ color: '#7C5C3E' }}>{t('ot.slideSpeed')}</label>
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
                          style={{ background: slideshowIntervalMs === 3000 ? '#630826' : '#FDFAF5', color: slideshowIntervalMs === 3000 ? '#FDFAF5' : '#630826', border: '1px solid #DDD5C5' }}
                          onClick={() => applySlideshowInterval(3000)}
                        >
                          {t('ot.faster')}
                        </button>
                        <button
                          type="button"
                          className="hush-press rounded-lg py-2 text-xs font-semibold"
                          style={{ background: slideshowIntervalMs === 6000 ? '#630826' : '#FDFAF5', color: slideshowIntervalMs === 6000 ? '#FDFAF5' : '#630826', border: '1px solid #DDD5C5' }}
                          onClick={() => applySlideshowInterval(6000)}
                        >
                          {t('ot.slower')}
                        </button>
                      </div>
                    </div>

                    {/* Transition — composed, not chosen. Six axes instead of a list of four
                        presets, so an album's slideshow can look like this album's slideshow. */}
                    <div className="space-y-3">
                      <label className="block text-xs font-medium" style={{ color: '#7C5C3E' }}>{t('ot.animation')}</label>

                      <div className="grid grid-cols-4 gap-2">
                        {SLIDESHOW_MOVES.map((option) => {
                          const selected = slideshowMotion.move === option.value
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => applySlideshowMotion({ move: option.value })}
                              className="hush-press rounded-lg py-2 text-xs font-semibold"
                              style={{
                                background: selected ? '#630826' : '#FDFAF5',
                                border: '1px solid #DDD5C5',
                                color: selected ? '#FDFAF5' : '#630826',
                              }}
                            >
                              {option.label}
                            </button>
                          )
                        })}
                      </div>

                      {slideshowMotion.move === 'slide' && (
                        <div className="grid grid-cols-4 gap-2">
                          {SLIDESHOW_DIRECTIONS.map((option) => {
                            const selected = slideshowMotion.direction === option.value
                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => applySlideshowMotion({ direction: option.value })}
                                title={option.label}
                                className="hush-press rounded-lg py-2 text-xs font-semibold"
                                style={{
                                  background: selected ? '#630826' : '#FDFAF5',
                                  border: '1px solid #DDD5C5',
                                  color: selected ? '#FDFAF5' : '#630826',
                                }}
                              >
                                {option.value === 'up' ? '↑' : option.value === 'down' ? '↓' : option.value === 'left' ? '←' : '→'}
                              </button>
                            )
                          })}
                        </div>
                      )}

                      {slideshowMotion.move !== 'none' && (
                        <MotionSlider
                          label={t('ot.motionDistance')}
                          value={slideshowMotion.distance}
                          display={`${slideshowMotion.distance}%`}
                          min={0} max={100} step={1}
                          onChange={(v) => applySlideshowMotion({ distance: v })}
                        />
                      )}

                      <MotionSlider
                        label={t('ot.motionFade')}
                        value={slideshowMotion.fade}
                        display={`${slideshowMotion.fade}%`}
                        min={0} max={100} step={1}
                        onChange={(v) => applySlideshowMotion({ fade: v })}
                      />

                      <MotionSlider
                        label={t('ot.motionBlur')}
                        value={slideshowMotion.blur}
                        display={`${slideshowMotion.blur}%`}
                        min={0} max={100} step={1}
                        onChange={(v) => applySlideshowMotion({ blur: v })}
                      />

                      <MotionSlider
                        label={t('ot.motionDuration')}
                        value={slideshowMotion.durationMs}
                        display={`${(slideshowMotion.durationMs / 1000).toFixed(2)}s`}
                        min={MIN_SLIDESHOW_DURATION_MS} max={MAX_SLIDESHOW_DURATION_MS} step={10}
                        onChange={(v) => applySlideshowMotion({ durationMs: v })}
                      />

                      <div>
                        <label className="mb-2 block text-xs font-medium" style={{ color: '#7C5C3E' }}>{t('ot.motionCurve')}</label>
                        <div className="grid grid-cols-5 gap-1.5">
                          {SLIDESHOW_EASINGS.map((option) => {
                            const selected = slideshowMotion.easing === option.value
                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => applySlideshowMotion({ easing: option.value })}
                                className="hush-press rounded-lg py-2 text-[11px] font-semibold"
                                style={{
                                  background: selected ? '#630826' : '#FDFAF5',
                                  border: '1px solid #DDD5C5',
                                  color: selected ? '#FDFAF5' : '#630826',
                                }}
                              >
                                {option.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {/* Replays the composed transition on a small tile, so the owner can feel the
                          difference without starting a slideshow to find out. */}
                      <div className="flex items-center gap-3 rounded-xl px-3 py-3" style={{ background: '#FDFAF5', border: '1px solid #DDD5C5' }}>
                        <div style={{ width: 68, height: 46, borderRadius: 8, overflow: 'hidden', flex: '0 0 auto', background: '#EDE7DB' }}>
                          <div
                            key={motionPreviewKey}
                            className={slideshowMotionIsStill(slideshowMotion) ? '' : 'hush-slideshow-frame'}
                            style={{
                              width: '100%', height: '100%',
                              background: motionPreviewThumb ? `center/cover no-repeat url("${motionPreviewThumb}")` : '#C9B79E',
                              ...slideshowMotionVars(slideshowMotion),
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setMotionPreviewKey((k) => k + 1)}
                          className="hush-press rounded-lg px-3 py-2 text-xs font-semibold"
                          style={{ background: '#F5F0E8', border: '1px solid #DDD5C5', color: '#630826' }}
                        >
                          {t('ot.motionReplay')}
                        </button>
                        <button
                          type="button"
                          onClick={() => applySlideshowMotion(DEFAULT_SLIDESHOW_MOTION)}
                          className="ml-auto text-xs"
                          style={{ background: 'none', border: 'none', color: '#8B6F4E', cursor: 'pointer' }}
                        >
                          {t('ot.reset')}
                        </button>
                      </div>
                    </div>

                    {mediaError && <p className="text-xs" style={{ color: '#C0392B' }}>{mediaError}</p>}
                  </div>
                )}
              </section>

              {/* Files */}
              <section style={settingsSectionStyle}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('guests')}>
                  <ShieldCheck className="w-4 h-4" style={{ color: '#7C5C3E' }} />
                  <span style={sectionTitle}>{t('ot.guests')}</span>
                  <ChevronDown
                    className="ml-auto w-4 h-4 transition-transform"
                    style={{ color: '#A89880', transform: openSection === 'guests' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'guests' && (
                  <div className="px-4 pb-4 space-y-3">
                    {/* WHO MAY ADD PHOTOS. The server has always enforced this — photos/create,
                        presign, stream and image-relay all refuse when it is off — but nothing
                        could SET it, so the only way to close an album to guests was an UPDATE
                        against the database by hand. It sits first because it is the biggest
                        switch here: everything else shapes what guests see, this decides whether
                        they contribute at all. */}
                    <label className="flex items-center justify-between gap-4 rounded-xl px-3 py-3" style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', cursor: 'pointer' }}>
                      <span>
                        <span className="block text-sm font-semibold" style={{ color: '#630826' }}>{t('ot.allowUploads')}</span>
                        <span className="block text-xs" style={{ color: '#7C5C3E' }}>{t('ot.allowUploadsSub')}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={guestUploadsEnabled}
                        onChange={async (e) => {
                          const next = e.target.checked
                          setGuestUploadsEnabled(next)
                          onAlbumUpdated({ guest_uploads_enabled: next })
                          try {
                            const result = await saveGuestUploadsRequest(album.slug, next)
                            if (!result.ok) {
                              showAppToast(result.error, 'error')
                              setGuestUploadsEnabled(!next)
                              onAlbumUpdated({ guest_uploads_enabled: !next })
                            }
                          } catch (e) {
                            const message = e instanceof Error ? e.message : t('common.networkError')
                            showAppToast(message, 'error')
                            setGuestUploadsEnabled(!next)
                            onAlbumUpdated({ guest_uploads_enabled: !next })
                          }
                        }}
                        className="h-4 w-4"
                      />
                    </label>

<label className="flex items-center justify-between gap-4 rounded-xl px-3 py-3" style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', cursor: 'pointer' }}>
                      <span>
                        <span className="block text-sm font-semibold" style={{ color: '#630826' }}>{t('ot.allowDownloads')}</span>
                        <span className="block text-xs" style={{ color: '#7C5C3E' }}>{t('ot.allowDownloadsSub')}</span>
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
                            const message = e instanceof Error ? e.message : t('common.networkError')
                            showAppToast(message, 'error')
                            setAllowGuestDownloads(!next)
                            onAlbumUpdated({ allow_guest_downloads: !next })
                          }
                        }}
                        className="h-4 w-4"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-4 rounded-xl px-3 py-3" style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', ...gatedRowStyle(showLockedModeration || moderationIsMoot) }}>
                      <span>
                        <span className="block text-sm font-semibold" style={{ color: '#630826' }}>
                          {t('ot.requireApproval')} <PlanBadge need="pro" tier={userTier} />
                        </span>
                        <span className="block text-xs" style={{ color: '#7C5C3E' }}>
                          {moderationIsMoot ? t('ot.requireApprovalMoot') : t('ot.requireApprovalSub')}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={requireApproval}
                        onChange={async (e) => {
                          const next = e.target.checked
                          setRequireApproval(next)
                          onAlbumUpdated({ require_approval: next })
                          try {
                            const result = await saveRequireApprovalRequest(album.slug, next)
                            if (!result.ok) {
                              showAppToast(result.error, 'error')
                              setRequireApproval(!next)
                              onAlbumUpdated({ require_approval: !next })
                            }
                          } catch (err) {
                            showAppToast(err instanceof Error ? err.message : t('common.networkError'), 'error')
                            setRequireApproval(!next)
                            onAlbumUpdated({ require_approval: !next })
                          }
                        }}
                        className="h-4 w-4"
                        disabled={moderationDisabled}
                      />
                    </label>
                  </div>
                )}
              </section>

              <section style={settingsSectionStyle}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('files')}>
                  <Download className="w-4 h-4" style={{ color: '#7C5C3E' }} />
                  <span style={sectionTitle}>{t('ot.files')}</span>
                  <ChevronDown
                    className="ml-auto w-4 h-4 transition-transform"
                    style={{ color: '#A89880', transform: openSection === 'files' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'files' && (
                  <div className="px-4 pb-4 space-y-3">
                    <button
                      className="w-full flex items-center justify-center gap-2 font-semibold rounded-xl py-3 text-sm transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: '#630826', color: '#FDFAF5' }}
                      disabled={zipping || photos.length === 0}
                      onClick={downloadZip}
                    >
                      {zipping ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {zipStatus ? `${zipStatus} · ${zipProgress}%` : (zipProgress < 100 ? t('ot.downloading', { n: zipProgress }) : t('ot.creatingZip'))}
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4" />
                          {t('ot.downloadAll', { n: Math.max(albumPhotoCount ?? 0, photos.length) })}
                        </>
                      )}
                    </button>


                    {/* Pro+. The server is the authority — this only decides what the owner is
                        shown, and a free owner toggling it gets the plan message back rather than a
                        silent failure.

                        A COLLABORATION ALBUM shows it fixed instead of letting the owner flip a
                        switch that snaps back. The refusal would be handled correctly either way
                        (the catch below reverts and toasts), but a control that undoes itself reads
                        as a bug — and this owner is a partner, not someone to trip up. Same
                        not-allowed/dimmed treatment the locked Collections row already uses. */}
                    <label
                      className="flex items-center justify-between gap-4 rounded-xl px-3 py-3"
                      style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', ...gatedRowStyle(album.branding_locked || showLockedBranding) }}
                    >
                      <span>
                        <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#630826' }}>
                          Remove Hushare branding <PlanBadge need="pro" tier={userTier} />
                        </span>
                        <span className="block text-xs" style={{ color: '#7C5C3E' }}>
                          {album.branding_locked
                            ? 'Kept on for this album as part of our collaboration.'
                            : 'Hides our logo from this album’s header. Pro and Max.'}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={hideBranding}
                        // The plan check as well as the lock: this row was dimmed and badged but
                        // still clickable, so a free owner flipped it and learned it was paid from
                        // the error — the experience the badge was added to replace.
                        disabled={album.branding_locked || !tierAllows(userTier, 'hideBranding')}
                        onChange={async (e) => {
                          const next = e.target.checked
                          setHideBranding(next)
                          onAlbumUpdated({ hide_branding: next })
                          try {
                            const res = await fetch('/api/album/branding', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ slug: album.slug, hide_branding: next }),
                            })
                            if (!res.ok) {
                              const body = await res.json().catch(() => ({})) as { error?: string }
                              showAppToast(body.error ?? 'Could not save', 'error')
                              setHideBranding(!next)
                              onAlbumUpdated({ hide_branding: !next })
                            }
                          } catch (err) {
                            showAppToast(err instanceof Error ? err.message : t('common.networkError'), 'error')
                            setHideBranding(!next)
                            onAlbumUpdated({ hide_branding: !next })
                          }
                        }}
                        className="h-4 w-4"
                      />
                    </label>

                    <label
                      className="flex items-center justify-between gap-4 rounded-xl px-3 py-3"
                      style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', ...gatedRowStyle(showsAsLocked(userTier, 'faceFinder')) }}
                    >
                      <span>
                        <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#630826' }}>
                          <ScanFace className="w-4 h-4" />
                          {t('ot.faceFinder')}
                          <PlanBadge need="studio" tier={userTier} />
                        </span>
                        <span className="block text-xs" style={{ color: '#7C5C3E' }}>{t('ot.faceFinderSub')}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={faceFinderEnabled}
                        disabled={!tierAllows(userTier, 'faceFinder')}
                        onChange={(e) => {
                          if (e.target.checked) { setConsentCopied(false); setFaceConsentOpen(true); return }
                          void applyFaceFinder(false)
                        }}
                        className="h-4 w-4"
                      />
                    </label>

                    {/* Bib search — the "this is a race" switch. Turning it on is what makes photos
                        get read for bib numbers; leaving it off means this album never sends a
                        single photo out for OCR. Free for everyone. */}
                    <label
                      className="mt-3 flex items-start justify-between gap-3 rounded-xl px-3 py-3 cursor-pointer"
                      style={{ background: '#FFFFFF', border: '1px solid #E8E0D2' }}
                    >
                      <span>
                        <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#630826' }}>
                          <Search className="w-4 h-4" />
                          {t('ot.bibSearch')} <PlanBadge need="studio" tier={userTier} />
                        </span>
                        <span className="block text-xs" style={{ color: '#7C5C3E' }}>{t('ot.bibSearchSub')}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={bibSearchEnabled}
                        onChange={async (e) => {
                          const next = e.target.checked
                          setBibSearchEnabled(next)
                          onAlbumUpdated({ bib_search_enabled: next })
                          try {
                            const res = await fetch('/api/album/bib-search', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ slug: album.slug, enabled: next }),
                            })
                            if (!res.ok) {
                              const body = await res.json().catch(() => ({})) as { error?: string }
                              throw new Error(body.error ?? `Save failed (${res.status})`)
                            }
                          } catch (err) {
                            const message = err instanceof Error ? err.message : t('common.networkError')
                            showAppToast(message, 'error')
                            setBibSearchEnabled(!next)
                            onAlbumUpdated({ bib_search_enabled: !next })
                          }
                        }}
                        className="h-4 w-4"
                        disabled={!tierAllows(userTier, 'bibSearch')}
                      />
                    </label>
                  </div>
                )}
              </section>

              {/* Password */}
              <section style={settingsSectionStyle}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('password')}>
                  {album.password_protected ? (
                    <Lock className="w-4 h-4" style={{ color: '#630826' }} />
                  ) : (
                    <LockOpen className="w-4 h-4" style={{ color: '#7C5C3E' }} />
                  )}
                  <span style={sectionTitle}>{t('ot.password')}</span>
                  {/* No badge and no lock: password protection is free, and always has been —
                      api/album/password has never carried a tier check. Charging for it in the UI
                      while the server gave it away was the same contradiction the pricing page had. */}
                  <ChevronDown
                    className="ml-auto w-4 h-4 transition-transform" 
                    style={{ color: '#A89880', transform: openSection === 'password' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'password' && (
                  <div className="px-4 pb-4">
                    <p className="text-xs mb-3" style={{ color: '#7C5C3E' }}>
                      {t('ot.passwordSub')}
                    </p>
                    <input type="text" name="username" autoComplete="username" value={ownerUrl ?? ''} readOnly hidden />
                    <input
                      key={passwordInputKey}
                      type={passwordInput ? 'password' : 'text'}
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      placeholder={album.password_protected ? t('ot.newPassword') : t('ot.passwordPlaceholder')}
                      maxLength={128}
                      disabled={false}
                      autoComplete="new-password"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      name={`hush-album-password-${album.id}`}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                      style={inputStyle}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !passwordSaving && passwordInput) void savePassword('set')
                      }}
                    />
                    {passwordError && <p className="text-xs mt-2" style={{ color: '#C0392B' }}>{passwordError}</p>}
                    {passwordSaved && !passwordError && <p className="text-xs mt-2" style={{ color: '#630826' }}>{t('ot.saved')}</p>}
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        onClick={() => void savePassword('set')}
                        disabled={passwordSaving || !passwordInput}
                        className="hush-press flex-1 text-sm font-semibold rounded-lg py-2 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: '#630826', color: '#FDFAF5' }}
                      >
                        {passwordSaving ? t('ot.saving') : t('ot.save')}
                      </button>
                      {album.password_protected && (
                        <button
                          onClick={() => void savePassword('clear')}
                          disabled={passwordSaving}
                          className="hush-press text-sm rounded-lg py-2 px-3 transition hover:opacity-90 disabled:opacity-50"
                          style={{ background: '#F5F0E8', color: '#7C5C3E', border: '1px solid #DDD5C5' }}
                        >
                          {t('ot.remove')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </section>

              {/* Custom URL */}
              <section style={settingsSectionStyle}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('customUrl')}>
                  <Link2 className="w-4 h-4" style={{ color: '#7C5C3E' }} />
                  <span style={sectionTitle}>{t('ot.customUrl')}</span>
                  <PlanBadge need="pro" tier={userTier} />
                  <ChevronDown
                    className="ml-auto w-4 h-4 transition-transform"
                    style={{ color: '#A89880', transform: openSection === 'customUrl' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'customUrl' && (
                  <div className="px-4 pb-4">
                    <p className="text-xs mb-3" style={{ color: '#7C5C3E' }}>
                      {t('ot.customUrlSub')}
                    </p>
                    <div className="flex items-stretch rounded-lg overflow-hidden" style={{ border: '1px solid #DDD5C5', background: '#FDFAF5', ...gatedRowStyle(showLockedCustomUrl) }}>
                      <span className="text-xs flex items-center px-2 select-none" style={{ color: '#A89880' }}>hushare.space/</span>
                      <input
                        type="text"
                        value={customUrlInput}
                        onChange={(e) => setCustomUrlInput(e.target.value)}
                        placeholder="anna-and-david"
                        maxLength={40}
                        disabled={!canSetCustomUrl}
                        className="flex-1 text-sm px-2 py-2 focus:outline-none disabled:cursor-not-allowed"
                        style={{ background: 'transparent', color: '#630826' }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && canSetCustomUrl && !customUrlSaving && customUrlInput.trim()) void saveCustomUrl('set')
                        }}
                      />
                    </div>
                    {customUrlError && <p className="text-xs mt-2" style={{ color: '#C0392B' }}>{customUrlError}</p>}
                    {customUrlSaved && !customUrlError && <p className="text-xs mt-2" style={{ color: '#630826' }}>{t('ot.saved')}</p>}
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        onClick={() => void saveCustomUrl('set')}
                        disabled={!canSetCustomUrl || customUrlSaving || !customUrlInput.trim()}
                        className="hush-press flex-1 text-sm font-semibold rounded-lg py-2 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: '#630826', color: '#FDFAF5' }}
                      >
                        {customUrlSaving ? t('ot.saving') : t('ot.save')}
                      </button>
                      {album.custom_slug && (
                        <button
                          onClick={() => void saveCustomUrl('clear')}
                          disabled={!canSetCustomUrl || customUrlSaving}
                          className="hush-press text-sm rounded-lg py-2 px-3 transition hover:opacity-90 disabled:opacity-50"
                          style={{ background: '#F5F0E8', color: '#7C5C3E', border: '1px solid #DDD5C5' }}
                        >
                          {t('ot.clear')}
                        </button>
                      )}
                    </div>
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
                  <Clock className="w-4 h-4" style={{ color: revealIsFuture ? '#630826' : '#7C5C3E' }} />
                  <span style={sectionTitle}>{t('ot.delayedReveal')}</span>
                  <PlanBadge need="pro" tier={userTier} />
                  {revealIsFuture && (
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                      style={{ background: 'rgba(99,8,38,0.10)', color: '#630826' }}
                    >
                      {t('ot.active')}
                    </span>
                  )}
                  <ChevronDown
                    className="ml-auto w-4 h-4 transition-transform"
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
                            background: isFuture ? 'rgba(99,8,38,0.07)' : 'rgba(139,111,78,0.09)',
                            border: `1px solid ${isFuture ? 'rgba(99,8,38,0.18)' : 'rgba(139,111,78,0.22)'}`,
                          }}
                        >
                          <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: isFuture ? '#630826' : '#8B6F4E' }} />
                          <div>
                            <p className="text-[11px] font-semibold leading-none mb-1" style={{ color: isFuture ? '#630826' : '#8B6F4E' }}>
                              {isFuture ? t('ot.unlocksOn') : t('ot.alreadyRevealed')}
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
                        {album.reveal_at ? t('ot.changeTime') : t('ot.unlockAt')}
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
                        style={{ background: '#630826', color: '#FDFAF5' }}
                      >
                        {revealSaving ? t('ot.saving') : revealSaved ? `✓ ${t('ot.saved')}` : t('ot.save')}
                      </button>
                      {album.reveal_at && (
                        <button
                          onClick={() => void saveReveal('clear')}
                          disabled={revealSaving}
                          className="hush-press text-sm rounded-lg py-2 px-3 transition hover:opacity-80 disabled:opacity-50"
                          style={{ background: 'transparent', color: '#8B6F4E', border: '1px solid #DDD5C5' }}
                        >
                          {t('ot.remove')}
                        </button>
                      )}
                    </div>

                    {!album.reveal_at && (
                      <p className="text-[11px] leading-relaxed" style={{ color: '#A89880' }}>
                        {t('ot.revealNote')}
                      </p>
                    )}
                  </div>
                  )
                })()}
              </section>

              {/* Collections */}
              <section style={settingsSectionStyle}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('collection')}>
                  <FolderPlus className="w-4 h-4" style={{ color: showLockedCollections ? '#A89880' : '#7C5C3E' }} />
                  <span style={sectionTitle}>{t('ot.collections')}</span>
                  <PlanBadge need="studio" tier={userTier} />
                  <ChevronDown
                    className="ml-auto w-4 h-4 transition-transform"
                    style={{ color: '#A89880', transform: openSection === 'collection' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'collection' && (
                  <div className="px-4 pb-4">
                    <p className="text-xs mb-3" style={{ color: '#7C5C3E' }}>
                      {t('ot.collectionsSub')}
                    </p>

                    {canUseCollections && (
                      <div className="mb-4 rounded-xl p-3" style={{ background: '#FDFAF5', border: '1px solid #E8E0D2' }}>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: '#8B6F4E' }}>{t('ot.yourCollections')}</span>
                          {collectionsLoading && <span className="text-xs" style={{ color: '#A89880' }}>{t('ot.loading')}</span>}
                        </div>
                        <div className="space-y-2">
                          {collections.map((collection) => (
                            <button
                              key={collection.id}
                              type="button"
                              onClick={() => void addAlbumToCollection(collection.id)}
                              disabled={collectionSaving || collection.contains_album}
                              className="hush-press flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
                              style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', color: '#630826' }}
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-semibold">{collection.name}</span>
                                <span className="block truncate" style={{ color: '#8B6F4E' }}>
                                  /c/{collection.slug} - {collection.album_count} album{collection.album_count === 1 ? '' : 's'}
                                </span>
                              </span>
                              <span className="shrink-0 font-semibold" style={{ color: collection.contains_album ? '#630826' : '#7C5C3E' }}>
                                {collection.contains_album ? t('ot.added') : t('ot.add')}
                              </span>
                            </button>
                          ))}
                          {!collectionsLoading && collections.length === 0 && (
                            <p className="text-xs" style={{ color: '#8B6F4E' }}>{t('ot.noCollections')}</p>
                          )}
                        </div>
                      </div>
                    )}

                    {collectionError && <p className="text-xs mt-2" style={{ color: '#C0392B' }}>{collectionError}</p>}
                    {collectionUrl && (
                      <p className="text-xs mt-2 break-all" style={{ color: '#630826' }}>
                        Added: <a href={collectionUrl} className="underline">{collectionUrl}</a>
                      </p>
                    )}
                  </div>
                )}
              </section>

              {/* Delete album */}
              <section style={{ ...settingsSectionStyle, marginBottom: 0 }}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('danger')}>
                  <Trash2 className="w-4 h-4" style={{ color: '#C0392B' }} />
                  <span style={sectionTitle}>{t('ot.deleteAlbum')}</span>
                  <ChevronDown
                    className="ml-auto w-4 h-4 transition-transform"
                    style={{ color: '#A89880', transform: openSection === 'danger' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'danger' && (
                  <div className="px-4 pb-4">
                    <div className={`hush-delete-dialog hush-delete-panel rounded-xl p-3 ${deleteConfirm ? 'hush-delete-dialog-open' : ''}`} style={{ background: '#FFF7F4', border: '1px solid rgba(192,57,43,0.25)' }}>
                      <p className="text-xs leading-relaxed mb-3" style={{ color: '#7A2A1F' }}>
                        {t('ot.deleteSub')}
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
                          {deletingAlbum ? t('ot.deleting') : deleteConfirm ? t('ot.deletePermanently') : t('ot.deleteAlbum')}
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
    </div>

    {/* Article 9 consent gate. The privacy policy and the terms both stated the owner confirms they
        hold explicit consent, and until now the product never asked, so the confirmation those
        documents relied on did not exist. This is that confirmation, at the only moment it means
        anything: before a single face template is computed. */}
    {faceConsentOpen && (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="face-consent-title"
        onClick={() => setFaceConsentOpen(false)}
        style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(30,18,12,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', borderRadius: 18, maxWidth: 520, width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: 22, boxShadow: '0 18px 50px rgba(40,20,10,0.28)' }}
        >
          <h3 id="face-consent-title" className="text-lg font-semibold" style={{ color: '#630826' }}>
            {t('ot.faceConsent.title')}
          </h3>
          <p className="mt-3 text-sm" style={{ color: '#5C4632', lineHeight: 1.6 }}>{t('ot.faceConsent.b1')}</p>
          <p className="mt-3 text-sm" style={{ color: '#5C4632', lineHeight: 1.6 }}>{t('ot.faceConsent.b2')}</p>
          <blockquote className="mt-3 text-sm italic" style={{ color: '#4A3626', background: '#F6F1E8', border: '1px solid #E8E0D0', borderRadius: 12, padding: '12px 14px', margin: 0, lineHeight: 1.6 }}>
            {t('ot.faceConsent.wording')}
          </blockquote>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(t('ot.faceConsent.wording'))
                setConsentCopied(true)
              } catch { showAppToast(t('common.networkError'), 'error') }
            }}
            className="mt-2 text-xs font-semibold"
            style={{ color: '#630826', background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', textDecoration: 'underline' }}
          >
            {consentCopied ? t('ot.faceConsent.copied') : t('ot.faceConsent.copy')}
          </button>
          <p className="mt-3 text-sm" style={{ color: '#5C4632', lineHeight: 1.6 }}>{t('ot.faceConsent.b3')}</p>
          <p className="mt-3 text-sm font-semibold" style={{ color: '#7A2A1F', lineHeight: 1.6 }}>{t('ot.faceConsent.b4')}</p>
          <a href="/privacy#face-search" target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs" style={{ color: '#630826' }}>
            {t('ot.faceConsent.learn')}
          </a>
          <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => setFaceConsentOpen(false)}
              className="text-sm font-semibold rounded-xl px-4 py-2.5"
              style={{ color: '#5C4632', background: '#F1EADD', border: '1px solid #DDD5C5', cursor: 'pointer' }}
            >
              {t('ot.faceConsent.cancel')}
            </button>
            <button
              type="button"
              onClick={() => { setFaceConsentOpen(false); void applyFaceFinder(true) }}
              className="text-sm font-semibold rounded-xl px-4 py-2.5"
              style={{ color: '#FDFAF5', background: '#630826', border: '1px solid #630826', cursor: 'pointer' }}
            >
              {t('ot.faceConsent.confirm')}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
