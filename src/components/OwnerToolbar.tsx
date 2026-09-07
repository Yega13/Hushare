'use client'

import { useEffect, useRef, useState } from 'react'
import { useT } from '@/i18n/LocaleProvider'
import { ownerRows } from '@/lib/owner-rows'
import { FEATURE_TIER } from '@/lib/plan-gates'
import { packageExpired } from '@/lib/album-entitlements'
import PackageSection from '@/components/owner-toolbar/PackageSection'
import { ChevronDown, Copy, Images, MonitorPlay, Move, Play, Settings, X } from 'lucide-react'
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
import { showAppToast } from '@/components/AppToast'
import RevealSection from '@/components/owner-toolbar/RevealSection'
import CustomUrlSection from '@/components/owner-toolbar/CustomUrlSection'
import PasswordSection from '@/components/owner-toolbar/PasswordSection'
import CollectionsSection from '@/components/owner-toolbar/CollectionsSection'
import DangerSection from '@/components/owner-toolbar/DangerSection'
import GuestsSection from '@/components/owner-toolbar/GuestsSection'
import FilesSection from '@/components/owner-toolbar/FilesSection'
import ShareMenu from '@/components/owner-toolbar/ShareMenu'
import {
  savePhotoLayoutRequest,
  saveMediaSettingsRequest,
  type MediaSettingsChanges,
  saveDesktopGridColumns,
  saveSlideshowMotionRequest,
} from '@/components/owner-toolbar/api'
import { accordionButton, btnBase, sectionTitle, settingsSectionStyle } from '@/components/owner-toolbar/styles'
import type { SettingsSection } from '@/components/owner-toolbar/types'
import PlanBadge from '@/components/PlanBadge'

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
  /** A package payment is in flight (Polar just redirected back). Blocks a second purchase. */
  purchasePending?: boolean
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

export default function OwnerToolbar({ album, photos, albumPhotoCount, ownerToken, userTier, purchasePending, mediaRadiusMax, onAlbumUpdated, onOpenSlideshow, arrangeMode, onToggleArrangeMode, onOpenDesigner }: Props) {
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


  // Bumped whenever the password panel opens or Settings opens: PasswordSection is keyed on it,
  // so a partially-typed password is cleared at exactly those moments and nowhere else.
  const [passwordEpoch, setPasswordEpoch] = useState(0)


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
  // every server route is held to in tests/plan-gates.test.ts. WHAT EACH ROW LOOKS LIKE for this
  // owner -- shown, dimmed, enabled -- is decided in lib/owner-rows, where "what does a free owner
  // on a packaged album see?" is a test rather than a re-read of four booleans per row.
  // A LIVE PACKAGE flips the toolbar into pure-hide: rows the album is not entitled to render
  // not at all, instead of greyed with an upsell badge. The owner's rule, verbatim: "in packages
  // don't show anything that is unaccessible." They bought a finished product; a purchased
  // product that nags about the tier above is noise. Free and subscription albums keep the
  // grey-and-badge upsell exactly as before.
  const packagedLive = !packageExpired({
    tier: album.package_tier ?? null,
    expiresAt: album.package_expires_at ?? null,
  })
  // Collections are the one ACCOUNT-scoped feature: userTier here is the ALBUM'S plan (package
  // included), but the collections API gates on the signed-in account — so the row reads the
  // account-level answer the server sent, or it unlocks on packaged albums and 403s on use.
  const rows = ownerRows({
    tier: userTier,
    packagedLive,
    collectionsEnabled: album.collections_enabled === true,
    brandingLocked: !!album.branding_locked,
    guestUploadsEnabled: album.guest_uploads_enabled !== false,
  })
  // The renewal email lands on /album?renew=1 — open straight onto the package section so the
  // person who clicked "Renew" in an email is one tap from paying, not spelunking a settings menu.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (new URLSearchParams(window.location.search).get('renew') !== '1') return
    setShowSettings(true)
    setOpenSection('package')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      //
      // AND CLEAR THE PENDING FLAG WITH IT. mediaEditPendingRef is set when an edit is scheduled and
      // cleared only in saveMediaSettings' finally — so cancelling the timer here meant the save
      // never ran, the finally never ran, and the flag stayed true for the rest of the page session.
      // Every later close then hit the `if (mediaEditPendingRef.current) return` below and skipped
      // the resync entirely, which is what the resync exists to prevent: the laptop keeps showing a
      // stale phone-grid value, and the owner's next edit of ANY setting writes that stale value
      // back over the phone's choice — the grid "merge", reached through the side door.
      //
      // Reproduced by: open Settings, drag corner roundness, tap outside within the debounce window.
      if (debouncedSaveRef.current !== null) {
        window.clearTimeout(debouncedSaveRef.current)
        debouncedSaveRef.current = null
        // The cancelled save is the only thing that would have cleared this. Nothing is in flight
        // now, so nothing is pending.
        mediaEditPendingRef.current = false
      }
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
      setOpenSection(null)
    }
  }, [album.allow_guest_downloads, album.guest_uploads_enabled, album.custom_slug, album.media_filter, album.media_radius, album.mobile_grid_columns, album.desktop_grid_columns, album.reveal_at, album.slideshow_animation, album.slideshow_motion, album.slideshow_interval_ms, album.video_autoplay, showSettings])

  function toggleSection(section: SettingsSection) {
    setOpenSection((current) => {
      const next = current === section ? null : section
      // Only clear password state when OPENING — not when closing — so the user doesn't
      // lose a partially-typed password if they accidentally close and reopen.
      if (section === 'password' && next === 'password') setPasswordEpoch((n) => n + 1)
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

        {rows.liveWall.show && <button
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
          {t('ot.liveWall')} <PlanBadge need={FEATURE_TIER.liveWall} tier={userTier} />
        </button>}

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
                if (next) setPasswordEpoch((n) => n + 1)
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
              <PackageSection
                album={album}
                packagedLive={packagedLive}
                purchasePending={purchasePending === true}
                open={openSection === 'package'}
                onToggle={() => toggleSection('package')}
                t={t}
              />

              {/* Guests -- three switches with no state of their own; the album is the optimistic store */}
              <GuestsSection
                album={album}
                userTier={userTier}
                moderation={rows.moderation}
                open={openSection === 'guests'}
                onToggle={() => toggleSection('guests')}
                onAlbumUpdated={onAlbumUpdated}
              />

              {/* Files -- download, and the three switches that shape what is done with the files */}
              <FilesSection
                album={album}
                photos={photos}
                albumPhotoCount={albumPhotoCount}
                userTier={userTier}
                rows={rows}
                open={openSection === 'files'}
                onToggle={() => toggleSection('files')}
                onAlbumUpdated={onAlbumUpdated}
              />

              {/* Password -- its state is its own; the epoch key clears it when the panel or Settings opens */}
              <PasswordSection
                key={passwordEpoch}
                album={album}
                ownerUrl={ownerUrl}
                open={openSection === 'password'}
                onToggle={() => toggleSection('password')}
                onAlbumUpdated={onAlbumUpdated}
              />

              {/* Custom URL -- keyed on the stored value so another device's change remounts it */}
              <CustomUrlSection
                key={album.custom_slug ?? ''}
                album={album}
                userTier={userTier}
                row={rows.customUrl}
                open={openSection === 'customUrl'}
                onToggle={() => toggleSection('customUrl')}
                onAlbumUpdated={onAlbumUpdated}
              />

              {/* Delayed reveal -- its rules are lib/reveal-input, its state its own */}
              <RevealSection
                // Keyed on the stored value: when another device changes the reveal, the panel
                // remounts and reinitialises from the prop -- the resync the effect above used to do
                // for it, without a setState in an effect.
                key={album.reveal_at ?? ''}
                album={album}
                userTier={userTier}
                open={openSection === 'reveal'}
                onToggle={() => toggleSection('reveal')}
                onAlbumUpdated={onAlbumUpdated}
              />

              {/* Collections -- hidden outright on a packaged album that is not entitled; its state is its own */}
              {rows.collections.show && (
                <CollectionsSection
                  album={album}
                  userTier={userTier}
                  row={rows.collections}
                  open={openSection === 'collection'}
                  onToggle={() => toggleSection('collection')}
                />
              )}

              {/* Delete album -- the two-tap flow is lib/delete-flow; the panel body owns it */}
              <DangerSection album={album} open={openSection === 'danger'} onToggle={() => toggleSection('danger')} />
            </div>
          )}
        </div>
      </div>
    </div>

    </>
  )
}
