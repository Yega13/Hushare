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
} from '@/lib/media-display'
import { DESKTOP_COLUMN_CHOICES, resolveGridColumns } from '@/lib/grid-columns'
import { clampMediaRadius, clampSlideshowInterval, parseMediaRadiusDraft } from '@/lib/media-input'
import {
  adoptIncomingMedia,
  confirmMediaSaved,
  confirmedMediaSettings,
  editMediaDraft,
  initialMediaDraft,
  beginMediaSave,
  revertMediaSave,
  type MediaDraftState,
  type MediaSettingsSnapshot,
} from '@/lib/media-settings-diff'
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
// album prop. Another device's change lands the same way. There is no flag to get stuck. A request
// in flight at unmount finishes on the ref and settles the draft it left behind -- and holds the
// wire for this album (api.ts postMediaSettings, lib/inflight-gate) until it lands, so the request
// a reopened panel sends goes out after it: a reviewer closed and reopened Settings inside one
// round trip and the second request overtook the first. Two residuals, written down rather than
// fixed: as each closed panel's request lands, its value shows for one round trip on the grid AND
// on the open panel's controls (the open panel reads it as a change from elsewhere; with two
// closed panels queued the slider steps through each of their values once); and if EVERY request
// fails the open panel's baseline is the optimistic value until the next refetch or edit -- one
// toast per failure, erring toward showing what the owner last chose.

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

  // THE SIX DEBOUNCED SETTINGS live in one confirmed/draft pair (lib/media-settings-diff). `confirmed`
  // is what the server last acknowledged; `draft` is what the owner sees. A save sends the diff of
  // the two. They used to be six useStates diffed against the album prop -- which this component
  // patches OPTIMISTICALLY the moment a slider moves, so the baseline moved before the save did,
  // and a radius drag followed by an autoplay flip inside the debounce window dropped the radius.
  const incoming = confirmedMediaSettings(album, DEFAULT_SLIDESHOW_INTERVAL_MS)
  const [media, setMedia] = useState<MediaDraftState>(() => initialMediaDraft(incoming))
  // WHEN THE ALBUM CHANGES UNDER US. Our own optimistic patch echoes back through the prop and is
  // NOT a confirmation; a value from elsewhere (another device, a refetch) becomes confirmed and
  // shows on a control the owner has not touched. Reconciled during render, the React shape for
  // state derived from a prop; adoptIncomingMedia returns the same object when nothing moved.
  const adopted = adoptIncomingMedia(media, incoming)
  if (adopted !== media) setMedia(adopted)
  // Which desktop-columns click is the latest. A failed answer reverts the album only if its click
  // still is: comparing VALUES could not tell "my click is still the latest" from "a later click
  // chose the same number again", and reverted the owner's re-chosen value.
  const desktopClickRef = useRef(0)
  // The debounced save fires later and must read the draft as it is THEN, not as it was when the
  // timer was set; and two edits in one tick must compose. So edits advance this ref themselves.
  const mediaRef = useRef(adopted)
  useEffect(() => { mediaRef.current = media }, [media])

  const [mediaRadiusDraft, setMediaRadiusDraft] = useState(String(adopted.draft.media_radius))
  const [mediaRadiusEditing, setMediaRadiusEditing] = useState(false)
  const [photoLayout, setPhotoLayout] = useState<'grid' | 'justified'>(album.photo_layout === 'justified' ? 'justified' : 'grid')
  // Read off the album, not copied into state: the click patches the album optimistically anyway,
  // and a copy seeded once at mount kept showing the old number after the route pinned the
  // desktop grid on a phone-grid change, or after another device chose one.
  const desktopGridColumns = resolveGridColumns(album).desktop
  // The composed transition. Seeded from the album's own motion, or derived from the legacy preset
  // for an album that has never been touched — either way there is one value to edit from here on.
  const [slideshowMotion, setSlideshowMotion] = useState<SlideshowMotion>(() => resolveSlideshowMotion(album))
  const [motionPreviewKey, setMotionPreviewKey] = useState(0)
  const motionSaveTimerRef = useRef<number | null>(null)
  /** The motion the pending timer would send, so closing Settings can send it instead of dropping it. */
  const pendingMotionRef = useRef<SlideshowMotion | null>(null)
  const [mediaError, setMediaError] = useState('')

  const { media_radius: mediaRadius, video_autoplay: videoAutoplay, media_filter: mediaFilter,
    mobile_grid_columns: mobileGridColumns, slideshow_interval_ms: slideshowIntervalMs } = adopted.draft

  // A real photo from the album in the transition preview, so the owner judges the motion against
  // what they will actually be watching rather than a grey rectangle.
  const motionPreviewThumb = photos.find((p) => p.media_type !== 'video')?.thumb_url
    ?? photos[0]?.poster_url ?? photos[0]?.thumb_url ?? ''

  // The largest radius the grid can honour. A stored radius above it is clamped on the ALBUM by the
  // toolbar (the honest subject), and arrives here through the prop like any other change.
  const radiusMax = Math.max(1, Math.round(mediaRadiusMax))

  // The typed box mirrors the slider unless the owner is typing in it. Reconciled during render
  // like the draft above (an effect here re-rendered once per slider step for nothing).
  const [seenRadius, setSeenRadius] = useState(mediaRadius)
  if (mediaRadius !== seenRadius) {
    setSeenRadius(mediaRadius)
    if (!mediaRadiusEditing) setMediaRadiusDraft(String(mediaRadius))
  }

  // ONE REQUEST AT A TIME, from the ref -- per instance here, per album in api.ts (lib/inflight-gate).
  // beginMediaSave marks the plan in flight; while it is out
  // every edit lands in the draft only (editMedia's save call and the debounce both find nothing to
  // plan). When the answer lands -- applied or failed -- the state is reconciled against what THAT
  // request carried, and the settle step sends whatever the owner did meanwhile. Two requests used
  // to race: ON then OFF inside one round trip left the server ON with the switch saying OFF.
  async function saveMediaSettings() {
    const begun = beginMediaSave(mediaRef.current)
    if (!begun) return
    mediaRef.current = begun.state
    setMedia(begun.state)
    setMediaError('')
    const { plan } = begun
    try {
      // The body is what beginMediaSave recorded, not re-planned when the album's wire frees up
      // (api.ts holds it, one request per album): the answer is reconciled against inFlight, so
      // the two must be the same object.
      const result = await saveMediaSettingsRequest(album.slug, plan.changes, plan.resetRadiusOverrides, plan.resetFilterOverrides)
      if (!result.ok) throw new Error(result.error)
      const landed = confirmMediaSaved(mediaRef.current, result.applied)
      mediaRef.current = landed.state
      setMedia(landed.state)
      // The album learns the draft of each applied field (the server's value unless the owner has
      // moved on), and the parent is told which per-photo overrides the server has just cleared.
      // A phone-grid change also pins the desktop grid on an album that never chose one (the
      // route decides, and echoes it): the album must learn that too, or the desktop grid here
      // follows the new phone number until the next refetch.
      const patch: Partial<Album> = { ...landed.patch }
      if (result.applied.desktop_grid_columns !== undefined) patch.desktop_grid_columns = result.applied.desktop_grid_columns
      if (Object.keys(patch).length > 0 || plan.resetRadiusOverrides || plan.resetFilterOverrides) {
        onAlbumUpdated(patch, {
          forceGlobalRadius: false,
          resetRadiusOverrides: plan.resetRadiusOverrides,
          resetFilterOverrides: plan.resetFilterOverrides,
        })
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : t('common.networkError')
      setMediaError(message)
      showAppToast(message, 'error')
      // The grid goes back to the truth: a failed save used to leave the optimistic value in the
      // album with the baseline already moved, so it was never sent again.
      const reverted = revertMediaSave(mediaRef.current)
      mediaRef.current = reverted.state
      setMedia(reverted.state)
      if (Object.keys(reverted.patch).length > 0) onAlbumUpdated(reverted.patch)
    }
    // SETTLE. An edit made while the request was out was not sent; it goes now -- unless a drag is
    // still debouncing, in which case the timer sends the final value itself.
    if (debouncedSaveRef.current === null) void saveMediaSettings()
  }

  // Debounced auto-save for slider controls. 500ms lets the user settle on a value. A pending save
  // is FLUSHED on unmount, not dropped: closing Settings inside the window used to lose the edit
  // while the album kept showing it.
  const debouncedSaveRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (debouncedSaveRef.current !== null) {
      window.clearTimeout(debouncedSaveRef.current)
      debouncedSaveRef.current = null
      void saveMediaSettings()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount only; the save reads the ref
  }, [])

  /**
   * Every control goes through here: the draft moves, the album is patched so the grid redraws
   * now, and the save is either scheduled (a slider: dozens of values a second) or sent at once
   * (a switch). The two cannot race: one request is out at a time, and whichever of the timer and
   * the immediate call finds it out does nothing -- the settle step sends what is left. So a
   * pending debounce is left alone by an immediate save; it is only ever replaced by a new one.
   */
  function editMedia(
    patch: Partial<MediaSettingsSnapshot>,
    when: 'debounce' | 'now',
    options?: { forceGlobalRadius?: boolean },
  ) {
    const next = editMediaDraft(mediaRef.current, patch)
    mediaRef.current = next
    setMedia(next)
    onAlbumUpdated(patch, options)
    if (when === 'now') { void saveMediaSettings(); return }
    if (debouncedSaveRef.current !== null) window.clearTimeout(debouncedSaveRef.current)
    debouncedSaveRef.current = window.setTimeout(() => {
      debouncedSaveRef.current = null
      void saveMediaSettings()
    }, 500)
  }

  function applyMediaRadius(value: number) {
    editMedia({ media_radius: clampMediaRadius(value, radiusMax) }, 'debounce', { forceGlobalRadius: true })
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
    pendingMotionRef.current = next
    motionSaveTimerRef.current = window.setTimeout(() => {
      motionSaveTimerRef.current = null
      pendingMotionRef.current = null
      void saveSlideshowMotionRequest(album.slug, next).then((r) => {
        if (!r.ok) showAppToast(r.error, 'error')
      })
    }, 500)
  }
  // FLUSHED on unmount like the media save: closing Settings inside the window used to drop the
  // motion the slideshow was already playing, until a reload put the old one back.
  useEffect(() => () => {
    if (motionSaveTimerRef.current === null) return
    window.clearTimeout(motionSaveTimerRef.current)
    motionSaveTimerRef.current = null
    const pending = pendingMotionRef.current
    pendingMotionRef.current = null
    if (pending) void saveSlideshowMotionRequest(album.slug, pending).then((r) => {
      if (!r.ok) showAppToast(r.error, 'error')
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount only; the slug never changes while mounted
  }, [])

  function applySlideshowInterval(value: number) {
    editMedia({ slideshow_interval_ms: clampSlideshowInterval(value) }, 'debounce')
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
                onChange={(e) => editMedia({ video_autoplay: e.target.checked }, 'now')}
                className="h-4 w-4"
              />
            </label>

            <div>
              <label className="mb-2 block text-xs font-medium" style={{ color: '#7C5C3E' }}>{t('ot.globalFilter')}</label>
              <select
                value={mediaFilter}
                onChange={(e) => editMedia({ media_filter: e.target.value as MediaDisplayFilter }, 'now')}
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
                      onClick={() => editMedia({ mobile_grid_columns: option.value }, 'now')}
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
                        const before = album.desktop_grid_columns ?? null
                        const click = ++desktopClickRef.current
                        onAlbumUpdated({ desktop_grid_columns: value })
                        void saveDesktopGridColumns(album.slug, value).then((r) => {
                          if (!r.ok) {
                            setMediaError(r.error)
                            showAppToast(r.error, 'error')
                            // Put the album (and so the buttons) back where the SERVER still
                            // is, rather than leaving a selected column it does not have --
                            // unless a later click has already moved on, in which case that
                            // click's own answer decides (a slow failure used to write the
                            // old value over a newer, accepted one).
                            if (desktopClickRef.current === click) {
                              onAlbumUpdated({ desktop_grid_columns: before })
                            }
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
