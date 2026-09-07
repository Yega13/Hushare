'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Play, Settings } from 'lucide-react'
import type { Album, Photo, SlideshowMotion } from '@/types'
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
import { clampMediaRadius, clampSlideshowInterval, parseMediaRadiusDraft } from '@/lib/media-input'
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
import { showAppToast } from '@/components/AppToast'
import {
  saveDesktopGridColumns,
  saveMediaSettingsRequest,
  savePhotoLayoutRequest,
  saveSlideshowMotionRequest,
  type MediaSettingsChanges,
} from '@/components/owner-toolbar/api'
import { accordionButton, sectionTitle, settingsSectionStyle } from '@/components/owner-toolbar/styles'
import { useT } from '@/i18n/LocaleProvider'

// THE MEDIA AND SLIDESHOW PANELS, and the one save pipeline behind them.
//
// Moved out of OwnerToolbar as a unit because the two panels share it: corner radius, autoplay,
// filter, columns, layout, slideshow interval and animation all go through saveMediaSettings, which
// sends only what differs from the album's CONFIRMED values (lib/media-settings-diff -- the decision
// whose tests hold the phone/desktop grid "merge" bug shut), and slider edits are debounced so a
// drag is one write rather than dozens.
//
// RESYNC IS UNMOUNT. This component is rendered only while Settings is open. The toolbar used to
// carry a resync effect that, when Settings closed, cancelled a pending debounced save, cleared the
// pending-edit flag, and reset every one of these from the album prop -- unless an edit was still
// in flight, in which case it had to stand aside (the "mid-edit, the prop loses" rule, learned the
// hard way). Closing Settings now unmounts this: the unmount cleanup cancels the pending timers
// (as the effect did), the state simply ceases to exist, and reopening reinitialises from the
// album prop. Another device's change lands the same way. There is no flag to get stuck.

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

type Props = {
  album: Album
  photos: Photo[]
  /** The largest corner radius the grid can currently honour; measured by PhotoGrid. */
  mediaRadiusMax: number
  open: 'media' | 'slideshow' | null
  onToggle: (section: 'media' | 'slideshow') => void
  onAlbumUpdated: (
    patch: Partial<Album>,
    options?: { forceGlobalRadius?: boolean; resetRadiusOverrides?: boolean; resetFilterOverrides?: boolean },
  ) => void
}

export default function MediaSettingsPanels({ album, photos, mediaRadiusMax, open, onToggle, onAlbumUpdated }: Props) {
  const { t } = useT()
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

  // A real photo from the album in the transition preview, so the owner judges the motion against
  // what they will actually be watching rather than a grey rectangle.
  const motionPreviewThumb = photos.find((p) => p.media_type !== 'video')?.thumb_url
    ?? photos[0]?.poster_url ?? photos[0]?.thumb_url ?? ''

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

  async function saveMediaSettings(
    nextRadius = mediaRadius,
    nextAutoplay = videoAutoplay,
    nextFilter = mediaFilter,
    nextMobileGridColumns = mobileGridColumns,
    nextSlideshowIntervalMs = slideshowIntervalMs,
    nextSlideshowAnimation = slideshowAnimation,
  ) {
    setMediaError('')
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
    const nextRadius = clampMediaRadius(value, radiusMax)
    setMediaRadius(nextRadius)
    onAlbumUpdated({ media_radius: nextRadius }, { forceGlobalRadius: true })
    scheduleAutoSave(nextRadius, videoAutoplay, mediaFilter, mobileGridColumns, slideshowIntervalMs, slideshowAnimation)
  }

  function commitMediaRadiusDraft() {
    const nextRadius = parseMediaRadiusDraft(mediaRadiusDraft, radiusMax)
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
    const nextRadius = parseMediaRadiusDraft(digitsOnly, radiusMax)
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
    const nextInterval = clampSlideshowInterval(value)
    setSlideshowIntervalMs(nextInterval)
    onAlbumUpdated({ slideshow_interval_ms: nextInterval })
    scheduleAutoSave(mediaRadius, videoAutoplay, mediaFilter, mobileGridColumns, nextInterval, slideshowAnimation)
  }
  return (
    <>
      <section style={settingsSectionStyle}>
        <button type="button" className="hush-motion" style={accordionButton} onClick={() => onToggle('media')}>
          <Settings className="w-4 h-4" style={{ color: '#7C5C3E' }} />
          <span style={sectionTitle}>{t('ot.mediaDisplay')}</span>
          <ChevronDown
            className="ml-auto w-4 h-4 transition-transform"
            style={{ color: '#A89880', transform: open === 'media' ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </button>
        {open === 'media' && (
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
        <button type="button" className="hush-motion" style={accordionButton} onClick={() => onToggle('slideshow')}>
          <Play className="w-4 h-4" style={{ color: '#7C5C3E' }} />
          <span style={sectionTitle}>{t('ot.slideshowSettings')}</span>
          <ChevronDown
            className="ml-auto w-4 h-4 transition-transform"
            style={{ color: '#A89880', transform: open === 'slideshow' ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </button>
        {open === 'slideshow' && (
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
    </>
  )
}
