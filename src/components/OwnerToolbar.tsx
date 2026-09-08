'use client'

import { useEffect, useRef, useState } from 'react'
import { useT } from '@/i18n/LocaleProvider'
import { ownerRows } from '@/lib/owner-rows'
import { FEATURE_TIER } from '@/lib/plan-gates'
import { packageExpired } from '@/lib/album-entitlements'
import PackageSection from '@/components/owner-toolbar/PackageSection'
import { Copy, Images, MonitorPlay, Move, Play, Settings, X } from 'lucide-react'
import type { Album, Photo, Tier } from '@/types'
import { showAppToast } from '@/components/AppToast'
import RevealSection from '@/components/owner-toolbar/RevealSection'
import CustomUrlSection from '@/components/owner-toolbar/CustomUrlSection'
import PasswordSection from '@/components/owner-toolbar/PasswordSection'
import CollectionsSection from '@/components/owner-toolbar/CollectionsSection'
import DangerSection from '@/components/owner-toolbar/DangerSection'
import GuestsSection from '@/components/owner-toolbar/GuestsSection'
import FilesSection from '@/components/owner-toolbar/FilesSection'
import MediaSettingsPanels from '@/components/owner-toolbar/MediaSettingsPanels'
import { useZipDownload } from '@/components/photo-grid/useZipDownload'
import ShareMenu from '@/components/owner-toolbar/ShareMenu'
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
  // AFTER A DELETE, BEFORE LEAVING. Deleting no longer destroys anything for a week, and an undo the
  // owner cannot reach is not an undo -- so the redirect waits, and this lives HERE, in the one
  // component that stays mounted whether or not Settings or the accordion is open. The panel body
  // reports a landed deletion up; this reopens Settings on it and hands the days back down.
  const [deletedFor, setDeletedFor] = useState<number | null>(null)
  // THE ZIP DOWNLOAD LIVES HERE, not in the Files panel that shows it. The panel unmounts when
  // Settings closes; a download in progress does not stop for that, but its progress and its
  // "already running" state would have -- a review traced it: tap outside at "Part 2 of 9", reopen,
  // see an enabled "Download all", press it, and two full-album downloads run at once. This
  // component never unmounts while the album is open.
  const zip = useZipDownload(photos, album)




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
  // The grid measures the largest radius it can honour; a stored radius above it is clamped on the
  // ALBUM IN THIS TAB ONLY -- never written to the server, on purpose: the limit is this device's
  // tile width, and a phone must not shrink the radius every desktop shows. This ran off the
  // panel's local slider state; the album is the honest subject.
  const radiusMax = Math.max(1, Math.round(mediaRadiusMax))
  useEffect(() => {
    if ((album.media_radius ?? 16) > radiusMax) onAlbumUpdated({ media_radius: radiusMax }, { forceGlobalRadius: true })
  }, [album.media_radius, onAlbumUpdated, radiusMax])

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
  }, [])

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
              const next = !showSettings
              if (next) {
                setPasswordEpoch((n) => n + 1)
                // A fresh open shows no section expanded; the resync effect used to do this on
                // close, alongside fourteen media resets that live in MediaSettingsPanels now.
                setOpenSection(null)
              }
              setShowSettings(next)
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
              {/* Media and slideshow -- one save pipeline behind both, owned by the panels; closing
                  Settings unmounts them, which is the resync the toolbar used to do by hand */}
              <MediaSettingsPanels
                album={album}
                photos={photos}
                mediaRadiusMax={mediaRadiusMax}
                open={openSection === 'media' || openSection === 'slideshow' ? openSection : null}
                onToggle={toggleSection}
                onAlbumUpdated={onAlbumUpdated}
              />
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
                zip={zip}
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

              {/* Custom URL -- its state is its own; it follows the stored value only while pristine */}
              <CustomUrlSection
                album={album}
                userTier={userTier}
                row={rows.customUrl}
                open={openSection === 'customUrl'}
                onToggle={() => toggleSection('customUrl')}
                onAlbumUpdated={onAlbumUpdated}
              />

              {/* Delayed reveal -- its rules are lib/reveal-input, its state its own */}
              <RevealSection
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
              <DangerSection
                album={album}
                open={openSection === 'danger'}
                onToggle={() => toggleSection('danger')}
                deletedFor={deletedFor}
                onDeleted={(days) => {
                  setDeletedFor(days)
                  // Wherever the owner went while the request was in flight, the undo is in front
                  // of them now.
                  setShowSettings(true)
                  setShowShare(false)
                  setOpenSection('danger')
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>

    </>
  )
}
